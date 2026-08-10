import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Command, type CommandContext } from '@kernel/command/Command';
import { useManzanoStore } from '../store/manzanoLotConfigStore';
import { getFeatureKind, getLotStatus, setLotStatus, type LotStatus } from '@kernel/domain-model/featureModel';
import { subdivideManzanoBatchInWorker } from '@kernel/native/geoWorkerClient';
import type { ManzanoLoteMethod } from '../model/types';
import {
  polyArea,
  ringPerimeter,
  polygonCentroid,
  type LotResult,
} from '@kernel/geometry/polygonEngine';
import { useGenerateLotsProgressStore } from '../store/generateLotsProgressStore';
import { estimateGeometryBytes } from '@kernel/command/memoryEstimate';
import { computeAreaCorrectionFactor, computeLinearCorrectionFactor } from '../geometry/areaCorrection';
import type { LabelStyleConfig } from '@label-engine/model/labelModel';
import {
  replaceLotsForManzano,
  type RemovedLotSnapshot,
} from './replaceLotsForManzano';

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

    const manzanos: Array<{
      id: string | number;
      ring: Array<[number, number]>;
      trueAreaM2?: number;
    }> = [];
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
      manzanos.push({ id, ring, trueAreaM2: f.get('areaM2') as number | undefined });
    });

    if (manzanos.length === 0) return;

    const batchInput: ManzanoBatchInput[] = manzanos.map(({ id, ring, trueAreaM2 }) => {
      const rawAreaM2 = polyArea(ring.map((c) => [c[0], c[1]] as [number, number]));
      const areaCorrectionFactor = computeAreaCorrectionFactor(rawAreaM2, trueAreaM2);
      const linearCorrectionFactor = computeLinearCorrectionFactor(areaCorrectionFactor);
      return {
        id,
        ring,
        method: useManzanoStore.getState().getMethod(id),
        targetAreaM2: this.opts.targetAreaM2 * areaCorrectionFactor,
        frontMinM: this.opts.frontMinM * linearCorrectionFactor,
        dirPref: useManzanoStore.getState().getRotateDir(id),
      };
    });
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
    methodById: Map<string, ManzanoLoteMethod>
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
        centroid: polygonCentroid(ringPts),
      });
      const { newLotIds, removedLotSnapshots } = replaceLotsForManzano(ctx, {
        manzanoId: id,
        manzanoFeature: mznFeat,
        lots,
        method,
        preferredLayerId: this.opts.layerId,
      });
      this.removedLotSnapshots.push(...removedLotSnapshots);
      this.newLotIds.push(...newLotIds);

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
      const f = new Feature({ geometry: snap.geometry });
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
