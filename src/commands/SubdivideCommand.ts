import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Command, type CommandContext } from './Command';
import { updateFeatureMetrics } from '../geo/metrics';
import { subdivideInWorker } from '../workers/geoWorkerClient';
import { ensureKind } from '../core/objectModel';
import { resolveLayerId } from './AddFeatureCommand';
import type { SubdivisionOptions } from '../geo/subdivisionAlgorithms';
import type { Polygon as GeoJsonPolygon } from 'geojson';

const geoJsonFormat = new GeoJSON();

export interface SubdivideCommandOpts {
  targetId: string | number;
  options: SubdivisionOptions;
  /** geometría del target (si no se pasa, se lee del drawSource) */
  targetGeom?: GeoJsonPolygon | null;
}

interface RemovedTargetSnapshot {
  id: string | number;
  geometry: Geometry;
  props: Record<string, unknown>;
}

/**
 * La subdivisión (bisección iterativa, hasta 200 iteraciones) ahora corre
 * en el Web Worker — ver diagnóstico H8 — así que "Aplicar" en
 * SubdivisionDialog ya no bloquea el hilo de UI mientras calcula.
 *
 * También se eliminó el `refreshSourceMetrics` global al final de
 * execute()/undo(): los lotes nuevos ya reciben su métrica una por una
 * (`updateFeatureMetrics`), y el target restaurado en undo() ya trae su
 * métrica correcta guardada en `props` (capturada antes de removerlo) —
 * ver diagnóstico H9.
 */
export class SubdivideCommand extends Command {
  readonly label = 'Subdividir manzano';
  private readonly opts: SubdivideCommandOpts;
  private newFeatureIds: Array<string | number> = [];
  private removedTarget: RemovedTargetSnapshot | null = null;

  constructor(opts: SubdivideCommandOpts) {
    super();
    this.opts = opts;
  }

  private readTargetGeom(ctx: CommandContext): GeoJsonPolygon | null {
    if (this.opts.targetGeom) return this.opts.targetGeom;
    const f = ctx.drawSource.getFeatureById(this.opts.targetId) as Feature<Geometry> | null;
    if (!f) return null;
    const g = f.getGeometry();
    if (!g) return null;
    const gj = geoJsonFormat.writeGeometryObject(g, {
      featureProjection: 'EPSG:3857',
      dataProjection: 'EPSG:3857',
    });
    return gj.type === 'Polygon' ? (gj as GeoJsonPolygon) : null;
  }

  override async execute(ctx: CommandContext): Promise<void> {
    const geom = this.readTargetGeom(ctx);
    if (!geom) return;
    const r = await subdivideInWorker(geom, this.opts.options);
    if (!r.ok) return;

    const target = ctx.drawSource.getFeatureById(this.opts.targetId) as Feature<Geometry> | null;
    if (target) {
      const g = target.getGeometry();
      if (g) {
        const props = { ...target.getProperties() };
        delete props.geometry;
        this.removedTarget = { id: this.opts.targetId, geometry: g.clone(), props };
      }
      ctx.drawSource.removeFeature(target);
    }

    this.newFeatureIds = [];
    r.features.forEach((f) => {
      const g = f.geometry.type === 'Polygon' ? (f.geometry as GeoJsonPolygon) : null;
      if (!g) return;
      const geom3857 = geoJsonFormat.readGeometry(
        { type: 'Polygon', coordinates: g.coordinates },
        { featureProjection: 'EPSG:3857', dataProjection: 'EPSG:3857' },
      );
      const olFeat = new Feature({ geometry: geom3857 as Geometry });
      const newId = `subdiv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      olFeat.setId(newId);
      olFeat.setProperties(
        ensureKind(
          {
            ...(f.properties ?? {}),
            lotGroupId: String(this.opts.targetId),
            method: this.opts.options.method,
          },
          'lote',
        ),
      );
      ctx.drawSource.addFeature(olFeat);
      const lid = resolveLayerId(undefined, 'lote');
      if (lid) olFeat.set('layerId', lid);
      updateFeatureMetrics(olFeat as Feature<Geometry>);
      this.newFeatureIds.push(newId);
    });

    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const id of this.newFeatureIds) {
      const f = ctx.drawSource.getFeatureById(id);
      if (f) ctx.drawSource.removeFeature(f);
    }
    if (this.removedTarget && ctx.drawSource.getFeatureById(this.removedTarget.id) == null) {
      const f = new Feature({ geometry: this.removedTarget.geometry });
      f.setId(this.removedTarget.id);
      f.setProperties(this.removedTarget.props);
      ctx.drawSource.addFeature(f);
    }
    ctx.drawSource.changed();
  }

  override async redo(ctx: CommandContext): Promise<void> {
    // undo() restauró el polígono original con id/geometría intactos.
    await this.execute(ctx);
  }
}