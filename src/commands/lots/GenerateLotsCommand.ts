import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Command, type CommandContext } from '../core/Command';
import { useManzanoStore } from '../../store/entities/manzanoStore';
import { updateFeatureMetrics } from '../../geo/metrics';
import { ensureKind, getFeatureKind } from '../../core/objectModel';
import { resolveLayerId } from '../features/AddFeatureCommand';
import { subdivideManzanoBatchInWorker } from '../../workers/geoWorkerClient';
import PolygonGeom from 'ol/geom/Polygon.js';
import FeatureOL from 'ol/Feature.js';
import type { ManzanoLoteMethod } from '../../geo/subdivision/subdivisionAlgorithms';
import { polyArea, ringPerimeter, centroid, type LotResult } from '../../geo/math/polygonEngine';
import { checkTopologyInBackground } from '../../geo/recomputeManzanos';
import { useGenerateLotsProgressStore } from '../../store/ui/generateLotsProgressStore';
import { estimateGeometryBytes } from '../core/memoryEstimate';

const geoJsonFormat = new GeoJSON();

/** Manzanos por tanda enviada al worker — balance entre granularidad de
 *  progreso/cancelación y overhead de múltiples round-trips. */
const CHUNK_SIZE = 8;

export interface GenerateLotsOpts {
  targetAreaM2: number;
  frontMinM: number;
}

interface ManzanoBatchInput {
  id: string | number;
  ring: Array<[number, number]>;
  method: ManzanoLoteMethod;
  targetAreaM2: number;
  frontMinM: number;
  dirPref?: { ax: number; ay: number };
}

interface ConsumedManzanoSnapshot {
  id: string | number;
  geometry: Geometry;
  props: Record<string, unknown>;
}

/**
 * Genera lotes automáticos sobre todos los manzanos del drawSource.
 *
 * Fase 6, punto 4: la subdivisión ahora se envía al worker en TANDAS
 * (`CHUNK_SIZE` manzanos por vez) en vez de un único postMessage con
 * todos — esto permite (a) reportar progreso real entre tandas y (b)
 * cancelar de verdad a mitad de camino: lo ya aplicado queda aplicado
 * (y es exactamente lo que undo() revierte), lo no procesado nunca se
 * generó.
 */
export class GenerateLotsCommand extends Command {
  readonly label = 'Generar lotes';
  private readonly opts: GenerateLotsOpts;
  private consumedManzanos: ConsumedManzanoSnapshot[] = [];
  private newLotIds: Array<string | number> = [];

  constructor(opts: GenerateLotsOpts) {
    super();
    this.opts = opts;
  }

  override async execute(ctx: CommandContext): Promise<void> {
    this.consumedManzanos = [];
    this.newLotIds = [];

    const manzanos: Array<{ id: string | number; ring: Array<[number, number]> }> = [];
    ctx.drawSource.forEachFeature((f) => {
      const id = f.getId();
      if (id == null) return;
      if (getFeatureKind(f) !== 'manzana') return;
      const g = f.getGeometry();
      if (!g || g.getType() !== 'Polygon') return;
      const gj = geoJsonFormat.writeGeometryObject(g, {
        featureProjection: 'EPSG:3857',
        dataProjection: 'EPSG:3857',
      });
      if (gj.type !== 'Polygon') return;
      const ring = (gj as unknown as { coordinates: [number, number][][] }).coordinates[0];
      if (!ring || ring.length < 4) return;
      manzanos.push({ id, ring });
    });

    if (manzanos.length === 0) return;

    // Capturamos method/dirPref ANTES del viaje al worker (igual que
    // antes) — si el usuario toca ManzanoPanel mientras esperamos, no
    // queremos etiquetar lotes con un método distinto al calculado.
    const batchInput: ManzanoBatchInput[] = manzanos.map(({ id, ring }) => ({
      id,
      ring,
      method: useManzanoStore.getState().getMethod(id),
      targetAreaM2: this.opts.targetAreaM2,
      frontMinM: this.opts.frontMinM,
      dirPref: useManzanoStore.getState().getRotateDir(id),
    }));
    const methodById = new Map(batchInput.map((b) => [String(b.id), b.method]));

    useGenerateLotsProgressStore.getState().start(batchInput.length);

    try {
      let processedCount = 0;
      for (let start = 0; start < batchInput.length; start += CHUNK_SIZE) {
        if (useGenerateLotsProgressStore.getState().cancelRequested) break;

        const chunk = batchInput.slice(start, start + CHUNK_SIZE);
        const chunkResults = await subdivideManzanoBatchInWorker(chunk);
        this.applyChunkResults(ctx, chunk, chunkResults, methodById);

        processedCount += chunk.length;
        useGenerateLotsProgressStore.getState().setProgress(processedCount);
      }
    } finally {
      useGenerateLotsProgressStore.getState().finish();
    }

    ctx.drawSource.changed();
    checkTopologyInBackground();
  }

  private applyChunkResults(
    ctx: CommandContext,
    chunk: ManzanoBatchInput[],
    chunkResults: Array<{ id: string | number; lots: LotResult[] }>,
    methodById: Map<string, ManzanoLoteMethod>,
  ): void {
    const lotsById = new Map(chunkResults.map((r) => [String(r.id), r.lots]));

    for (const { id, ring } of chunk) {
      const lots = lotsById.get(String(id)) ?? [];
      if (lots.length === 0) continue;
      const method = methodById.get(String(id))!;

      // H-LOT-9 (Fase 3): snapshot geométrico actualizado siempre que
      // este comando lotiza un manzano.
      const ringPts = ring.map((c) => [c[0], c[1]] as [number, number]);
      useManzanoStore.getState().setGeomSnapshot(id, {
        area: polyArea(ringPts),
        perimeter: ringPerimeter(ringPts),
        centroid: centroid(ringPts),
      });

      const feat = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (feat) {
        const g = feat.getGeometry();
        if (g) {
          const props = { ...feat.getProperties() };
          delete props.geometry;
          this.consumedManzanos.push({ id, geometry: g.clone(), props });
        }
        ctx.drawSource.removeFeature(feat);
      }

      for (let i = 0; i < lots.length; i++) {
        const lot = lots[i];
        if (lot.pts.length < 3) continue;
        const closedRing = [...lot.pts];
        if (
          closedRing[0][0] !== closedRing[closedRing.length - 1][0] ||
          closedRing[0][1] !== closedRing[closedRing.length - 1][1]
        ) {
          closedRing.push([closedRing[0][0], closedRing[0][1]]);
        }
        const newGeom = new PolygonGeom([closedRing]);
        const newFeat = new FeatureOL({ geometry: newGeom });
        const newId = `lot-${Date.now()}-${this.newLotIds.length}-${i}`;
        newFeat.setId(newId);
        newFeat.setProperties(
          ensureKind(
            {
              subdivision: method,
              lotGroupId: String(id),
              label: lot.isRemnant
                ? `Remanente ${this.newLotIds.length + 1}`
                : `Lote ${this.newLotIds.length + 1}`,
              areaM2: lot.areaM2,
              frontM: lot.frontM,
              depthM: lot.depthM,
              isRemnant: lot.isRemnant,
            },
            'lote',
          ),
        );
        ctx.drawSource.addFeature(newFeat);
        const lid = resolveLayerId(undefined, 'lote');
        if (lid) newFeat.set('layerId', lid);
        updateFeatureMetrics(newFeat as Feature<Geometry>);
        this.newLotIds.push(newId);
      }
    }
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const id of this.newLotIds) {
      const f = ctx.drawSource.getFeatureById(id);
      if (f) ctx.drawSource.removeFeature(f);
    }
    for (const snap of this.consumedManzanos) {
      if (ctx.drawSource.getFeatureById(snap.id) != null) continue;
      const f = new FeatureOL({ geometry: snap.geometry });
      f.setId(snap.id);
      f.setProperties(snap.props);
      ctx.drawSource.addFeature(f);
    }
    ctx.drawSource.changed();
  }

  override async redo(ctx: CommandContext): Promise<void> {
    await this.execute(ctx);
  }

  /** Fase 6, punto 5: memoria retenida por este comando en el
   *  historial — la suma de las geometrías clonadas de los manzanos
   *  consumidos (potencialmente muchas en un "Generar todos" grande). */
  override approxMemoryBytes(): number {
    return this.consumedManzanos.reduce((sum, s) => sum + estimateGeometryBytes(s.geometry), 0);
  }
}