// src/commands/RecomputeManzanoLotsCommand.ts
//
// Recalcula los lotes de UN solo manzano (a diferencia de GenerateLotsCommand,
// que hace todos), respetando el método/rotación guardados en manzanoStore.
// Con undo, igual que el resto de los comandos.

import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import PolygonGeom from 'ol/geom/Polygon.js';
import FeatureOL from 'ol/Feature.js';
import { Command, type CommandContext } from './Command';
import { subdivideManzano, type ManzanoLoteMethod } from '../geo/subdivisionAlgorithms';
import { refreshSourceMetrics, updateFeatureMetrics } from '../geo/metrics';
import { ensureKind, getFeatureKind } from '../core/objectModel';
import { resolveLayerId } from './AddFeatureCommand';

const geoJsonFormat = new GeoJSON();

export interface RecomputeManzanoLotsOpts {
  manzanoId: string | number;
  targetAreaM2: number;
  frontMinM: number;
  method: ManzanoLoteMethod;
  dirPref?: { ax: number; ay: number };
}

export class RecomputeManzanoLotsCommand extends Command {
  readonly label = 'Recalcular lotes del manzano';
  private readonly opts: RecomputeManzanoLotsOpts;
  private newLotIds: Array<string | number> = [];
  private removedLotSnapshots: Array<{ id: string | number; geometry: Geometry; props: Record<string, unknown> }> = [];

  constructor(opts: RecomputeManzanoLotsOpts) {
    super();
    this.opts = opts;
  }

  execute(ctx: CommandContext): void {
    this.newLotIds = [];
    this.removedLotSnapshots = [];

    const mznFeat = ctx.drawSource.getFeatureById(this.opts.manzanoId) as Feature<Geometry> | null;
    if (!mznFeat || getFeatureKind(mznFeat) !== 'manzana') return;
    const geom = mznFeat.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return;

    // Sacar los lotes previos de este manzano (guardando snapshot para el undo).
    const toRemove: Feature<Geometry>[] = [];
    ctx.drawSource.forEachFeature((f) => {
      if (f.get('lotGroupId') === String(this.opts.manzanoId)) toRemove.push(f as Feature<Geometry>);
    });
    for (const f of toRemove) {
      const g = f.getGeometry();
      if (!g) continue;
      this.removedLotSnapshots.push({
        id: f.getId() as string | number,
        geometry: g.clone(),
        props: (() => {
          const p = { ...f.getProperties() };
          delete p.geometry;
          return p;
        })(),
      });
      ctx.drawSource.removeFeature(f);
    }

    const gj = geoJsonFormat.writeGeometryObject(geom, {
      featureProjection: 'EPSG:3857',
      dataProjection: 'EPSG:3857',
    });
    if (gj.type !== 'Polygon') return;
    const ring = (gj as unknown as { coordinates: [number, number][][] }).coordinates[0];
    if (!ring || ring.length < 4) return;

    const lots = subdivideManzano(ring, this.opts.method, this.opts.targetAreaM2, this.opts.frontMinM, this.opts.dirPref);

    lots.forEach((lot, i) => {
      if (lot.pts.length < 3) return;
      const closedRing = [...lot.pts];
      if (
        closedRing[0][0] !== closedRing[closedRing.length - 1][0] ||
        closedRing[0][1] !== closedRing[closedRing.length - 1][1]
      ) {
        closedRing.push([closedRing[0][0], closedRing[0][1]]);
      }
      const newGeom = new PolygonGeom([closedRing]);
      const newFeat = new FeatureOL({ geometry: newGeom });
      const newId = `lot-${this.opts.manzanoId}-${Date.now()}-${i}`;
      newFeat.setId(newId);
      newFeat.setProperties(
        ensureKind(
          {
            subdivision: this.opts.method,
            lotGroupId: String(this.opts.manzanoId),
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
      const lid = resolveLayerId(undefined, 'lote');
      if (lid) newFeat.set('layerId', lid);
      updateFeatureMetrics(newFeat as Feature<Geometry>);
      this.newLotIds.push(newId);
    });

    refreshSourceMetrics(ctx.drawSource);
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
    ctx.drawSource.changed();
    refreshSourceMetrics(ctx.drawSource);
  }
}