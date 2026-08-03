import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Command, type CommandContext } from '../core/Command';
import { useManzanoStore } from '../../store/entities/manzanoStore';
import { updateFeatureMetrics } from '../../geo/metrics';
import { ensureKind, getFeatureKind, getLotStatus, setLotStatus, type LotStatus } from '../../core/objectModel';
import { resolveLayerId } from '../features/AddFeatureCommand';
import { subdivideManzanoBatchInWorker } from '../../workers/geoWorkerClient';
import PolygonGeom from 'ol/geom/Polygon.js';
import FeatureOL from 'ol/Feature.js';
import type { ManzanoLoteMethod } from '../../geo/subdivision/types';
import { polyArea, ringPerimeter, centroid, type LotResult } from '../../geo/math/polygonEngine';
import { useGenerateLotsProgressStore } from '../../store/ui/generateLotsProgressStore';
import { estimateGeometryBytes } from '../core/memoryEstimate';
import { newId } from '../../lib/id';

const geoJsonFormat = new GeoJSON();

const CHUNK_SIZE = 8;

export interface GenerateLotsOpts {
  targetAreaM2: number;
  frontMinM: number;
  layerId: string;
}

interface ManzanoBatchInput {
  id: string | number;
  ring: Array<[number, number]>;
  method: ManzanoLoteMethod;
  targetAreaM2: number;
  frontMinM: number;
  dirPref?: { ax: number; ay: number };
}

interface RemovedLotSnapshot {
  id: string | number;
  geometry: Geometry;
  props: Record<string, unknown>;
}

export class GenerateLotsCommand extends Command {
  readonly label = 'Generar lotes';
  private readonly opts: GenerateLotsOpts;
  private removedLotSnapshots: RemovedLotSnapshot[] = [];
  private newLotIds: Array<string | number> = [];
  private prevLotStatus: Array<{ id: string | number; status: LotStatus }> = [];
  private prevLotStatusSeen = new Set<string>();

  constructor(opts: GenerateLotsOpts) {
    super();
    this.opts = opts;
  }

  override async execute(ctx: CommandContext): Promise<void> {
    this.removedLotSnapshots = [];
    this.newLotIds = [];
    this.prevLotStatus = [];
    this.prevLotStatusSeen = new Set();

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
  }

  private applyChunkResults(
    ctx: CommandContext,
    chunk: ManzanoBatchInput[],
    chunkResults: Array<{ id: string | number; lots: LotResult[] }>,
    methodById: Map<string, ManzanoLoteMethod>,
  ): void {
    const lotsById = new Map(chunkResults.map((r) => [String(r.id), r.lots]));

    for (const { id, ring } of chunk) {
      const mznFeat = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!mznFeat) continue;

      const statusKey = String(id);
      if (!this.prevLotStatusSeen.has(statusKey)) {
        this.prevLotStatusSeen.add(statusKey);
        this.prevLotStatus.push({ id, status: getLotStatus(mznFeat) });
      }

      const lots = lotsById.get(String(id)) ?? [];
      if (lots.length === 0) continue;
      const method = methodById.get(String(id))!;

      const ringPts = ring.map((c) => [c[0], c[1]] as [number, number]);
      useManzanoStore.getState().setGeomSnapshot(id, {
        area: polyArea(ringPts),
        perimeter: ringPerimeter(ringPts),
        centroid: centroid(ringPts),
      });
      const oldLots: Feature<Geometry>[] = [];
      ctx.drawSource.forEachFeature((f) => {
        if (f.get('lotGroupId') === String(id)) oldLots.push(f as Feature<Geometry>);
      });
      for (const f of oldLots) {
        const g = f.getGeometry();
        if (g) {
          const props = { ...f.getProperties() };
          delete props.geometry;
          this.removedLotSnapshots.push({ id: f.getId() as string | number, geometry: g.clone(), props });
        }
        ctx.drawSource.removeFeature(f);
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
        const lotId = newId(`lot-${id}`);
        newFeat.setId(lotId);
        newFeat.setProperties(
          ensureKind(
            {
              subdivision: method,
              lotGroupId: String(id),
              label: lot.isRemnant ? `Remanente ${i + 1}` : `Lote ${i + 1}`,
              areaM2: lot.areaM2,
              frontM: lot.frontM,
              depthM: lot.depthM,
              isRemnant: lot.isRemnant,
            },
            'lote',
          ),
        );
        ctx.drawSource.addFeature(newFeat);
        const lid = resolveLayerId(this.opts.layerId, 'lote');
        if (lid) newFeat.set('layerId', lid);
        updateFeatureMetrics(newFeat as Feature<Geometry>);
        this.newLotIds.push(lotId);
      }

      setLotStatus(mznFeat, 'subdivided');
      useManzanoStore.getState().setMethod(id, method);
    }
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const id of this.newLotIds) {
      const f = ctx.drawSource.getFeatureById(id);
      if (f) ctx.drawSource.removeFeature(f);
    }
    this.newLotIds = [];
    for (const snap of this.removedLotSnapshots) {
      if (ctx.drawSource.getFeatureById(snap.id) != null) continue;
      const f = new FeatureOL({ geometry: snap.geometry });
      f.setId(snap.id);
      f.setProperties(snap.props);
      ctx.drawSource.addFeature(f);
    }
    for (const { id, status } of this.prevLotStatus) {
      const feat = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (feat) setLotStatus(feat, status);
    }
    ctx.drawSource.changed();
  }

  override async redo(ctx: CommandContext): Promise<void> {
    await this.execute(ctx);
  }

  override approxMemoryBytes(): number {
    return this.removedLotSnapshots.reduce((sum, s) => sum + estimateGeometryBytes(s.geometry), 0);
  }
}
