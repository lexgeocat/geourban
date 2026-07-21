import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Command, type CommandContext } from './Command';
import { subdivideManzano } from '../geo/subdivisionAlgorithms';
import { useManzanoStore } from '../store/manzanoStore';
import { refreshSourceMetrics, updateFeatureMetrics } from '../geo/metrics';
import { ensureKind, getFeatureKind } from '../core/objectModel';
import { resolveLayerId } from './AddFeatureCommand';
import PolygonGeom from 'ol/geom/Polygon.js';
import FeatureOL from 'ol/Feature.js';

const geoJsonFormat = new GeoJSON();

export interface GenerateLotsOpts {
  targetAreaM2: number;
  frontMinM: number;
}

interface ConsumedManzanoSnapshot {
  id: string | number;
  geometry: Geometry;
  props: Record<string, unknown>;
}

/** Genera lotes automáticos sobre todos los manzanos del drawSource. */
export class GenerateLotsCommand extends Command {
  readonly label = 'Generar lotes';
  private readonly opts: GenerateLotsOpts;
  /** Antes solo se guardaban los IDS consumidos (`consumedManzanoIds`),
   *  nunca su geometría/propiedades — el undo() no tenía forma de
   *  restaurarlos y los manzanos quedaban perdidos para siempre. */
  private consumedManzanos: ConsumedManzanoSnapshot[] = [];
  private newLotIds: Array<string | number> = [];

  constructor(opts: GenerateLotsOpts) {
    super();
    this.opts = opts;
  }

  execute(ctx: CommandContext): void {
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

    for (const { id, ring } of manzanos) {
      const method = useManzanoStore.getState().getMethod(id);
      const dirPref = useManzanoStore.getState().getRotateDir(id);
      const lots = subdivideManzano(ring, method, this.opts.targetAreaM2, this.opts.frontMinM, dirPref);
      if (lots.length === 0) continue;

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

    refreshSourceMetrics(ctx.drawSource);
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
    refreshSourceMetrics(ctx.drawSource);
  }

  override redo(ctx: CommandContext): void {
    // undo() ya restauró los manzanos consumidos con su id/geometría
    // intactos, así que execute() los vuelve a encontrar y a subdividir
    // desde cero. Genera ids nuevos para los lotes — inofensivo, porque el
    // CommandStack limpia la selección en cada undo/redo.
    this.execute(ctx);
  }
}