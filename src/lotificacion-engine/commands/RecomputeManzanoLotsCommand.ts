import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import FeatureOL from 'ol/Feature.js';
import { Command, type CommandContext } from '@kernel/command/Command';
import type { ManzanoLoteMethod } from '../model/types';
import { getFeatureKind, getLotStatus, setLotStatus, type LotStatus } from '@kernel/domain-model/featureModel';
import { subdivideManzanoInWorker } from '@kernel/native/geoWorkerClient';
import { useManzanoStore } from '../store/manzanoLotConfigStore';
import { polyArea, ringPerimeter, polygonCentroid } from '@kernel/geometry/polygonEngine';
import { estimateGeometryBytes } from '@kernel/command/memoryEstimate';
import { computeAreaCorrectionFactor, computeLinearCorrectionFactor } from '../geometry/areaCorrection';
import { replaceLotsForManzano, type RemovedLotSnapshot } from './replaceLotsForManzano';

const geoJsonFormat = new GeoJSON();

export interface RecomputeManzanoLotsOpts {
  manzanoId: string | number;
  targetAreaM2: number;
  frontMinM: number;
  method: ManzanoLoteMethod;
  dirPref?: { ax: number; ay: number };
  layerId: string;
}

export class RecomputeManzanoLotsCommand extends Command {
  readonly label = 'Recalcular lotes del manzano';
  private readonly opts: RecomputeManzanoLotsOpts;
  private newLotIds: Array<string | number> = [];
  private removedLotSnapshots: RemovedLotSnapshot[] = [];
  private prevLotStatus: LotStatus | null = null;

  constructor(opts: RecomputeManzanoLotsOpts) {
    super();
    this.opts = opts;
  }

  override async execute(ctx: CommandContext): Promise<void> {
    this.newLotIds = [];
    this.removedLotSnapshots = [];

    const mznFeat = ctx.drawSource.getFeatureById(this.opts.manzanoId) as Feature<Geometry> | null;
    if (!mznFeat || getFeatureKind(mznFeat) !== 'manzana') return;

    if (this.prevLotStatus === null) {
      this.prevLotStatus = getLotStatus(mznFeat);
    }

    const geom = mznFeat.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return;

    const gj = geoJsonFormat.writeGeometryObject(geom, {
      featureProjection: 'EPSG:3857',
      dataProjection: 'EPSG:3857',
    });
    if (gj.type !== 'Polygon') return;
    const ring = (gj as unknown as { coordinates: [number, number][][] }).coordinates[0];
    if (!ring || ring.length < 4) return;

    const ringPts = ring.map((c) => [c[0], c[1]] as [number, number]);
    const areaM2 = polyArea(ringPts);
    const perimeterM = ringPerimeter(ringPts);
    const centroidPt = polygonCentroid(ringPts);
    const trueAreaM2 = mznFeat.get('areaM2') as number | undefined;
    const areaCorrectionFactor = computeAreaCorrectionFactor(areaM2, trueAreaM2);
    const linearCorrectionFactor = computeLinearCorrectionFactor(areaCorrectionFactor);

    const lots = await subdivideManzanoInWorker(
      ring,
      this.opts.method,
      this.opts.targetAreaM2 * areaCorrectionFactor,
      this.opts.frontMinM * linearCorrectionFactor,
      this.opts.dirPref
    );

    const { newLotIds, removedLotSnapshots } = replaceLotsForManzano(ctx, {
      manzanoId: this.opts.manzanoId,
      manzanoFeature: mznFeat,
      lots,
      method: this.opts.method,
      preferredLayerId: this.opts.layerId,
    });
    this.newLotIds = newLotIds;
    this.removedLotSnapshots = removedLotSnapshots;

    setLotStatus(mznFeat, this.newLotIds.length > 0 ? 'subdivided' : 'none');
    useManzanoStore.getState().setGeomSnapshot(this.opts.manzanoId, {
      area: areaM2,
      perimeter: perimeterM,
      centroid: centroidPt,
    });

    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const id of this.newLotIds) {
      const f = ctx.drawSource.getFeatureById(id);
      if (f) ctx.drawSource.removeFeature(f);
    }
    this.newLotIds = [];
    for (const snap of this.removedLotSnapshots) {
      const f = new FeatureOL({ geometry: snap.geometry });
      f.setId(snap.id);
      f.setProperties(snap.props);
      ctx.drawSource.addFeature(f);
    }
    if (this.prevLotStatus !== null) {
      const mznFeat = ctx.drawSource.getFeatureById(
        this.opts.manzanoId
      ) as Feature<Geometry> | null;
      setLotStatus(mznFeat, this.prevLotStatus);
    }
    ctx.drawSource.changed();
  }

  override approxMemoryBytes(): number {
    return this.removedLotSnapshots.reduce((sum, s) => sum + estimateGeometryBytes(s.geometry), 0);
  }
}
