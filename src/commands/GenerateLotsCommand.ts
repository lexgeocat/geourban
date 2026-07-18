import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Command, type CommandContext } from './Command';
import { subdivideManzanoAuto } from '../geo/subdivisionAlgorithms';
import { refreshSourceMetrics, updateFeatureMetrics } from '../geo/metrics';
import { ensureKind, getFeatureKind } from '../core/objectModel';
import PolygonGeom from 'ol/geom/Polygon.js';
import FeatureOL from 'ol/Feature.js';

const geoJsonFormat = new GeoJSON();

export interface GenerateLotsOpts {
  targetAreaM2: number;
  frontMinM: number;
}

/** Genera lotes automáticos sobre todos los manzanos del drawSource. */
export class GenerateLotsCommand extends Command {
  readonly label = 'Generar lotes';
  private readonly opts: GenerateLotsOpts;
  private consumedManzanoIds: Array<string | number> = [];
  private newLotIds: Array<string | number> = [];

  constructor(opts: GenerateLotsOpts) {
    super();
    this.opts = opts;
  }

  execute(ctx: CommandContext): void {
    this.consumedManzanoIds = [];
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

    for (const { id, ring } of manzanos) {
      const lots = subdivideManzanoAuto(ring, this.opts.targetAreaM2, this.opts.frontMinM);
      if (lots.length === 0) continue;

      const feat = ctx.drawSource.getFeatureById(id);
      if (feat) {
        ctx.drawSource.removeFeature(feat);
        this.consumedManzanoIds.push(id);
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
              subdivision: 'auto',
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
        updateFeatureMetrics(newFeat as Feature<Geometry>);
        this.newLotIds.push(newId);
      }
    }

    refreshSourceMetrics(ctx.drawSource);
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const id of this.newLotIds) {
      const f = ctx.drawSource.getFeatureById(id);
      if (f) ctx.drawSource.removeFeature(f);
    }
    this.newLotIds = [];
    ctx.drawSource.changed();
    refreshSourceMetrics(ctx.drawSource);
  }
}
