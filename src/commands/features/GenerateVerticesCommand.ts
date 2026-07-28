import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';
import MultiLineString from 'ol/geom/MultiLineString.js';
import { Command, type CommandContext } from '../core/Command';
import { ensureKind } from '../../core/objectModel';

export interface GenerateVerticesOpts {
  sourceFeatureIds: Array<string | number>;
  layerId: string;
}

function pushUnique(coord: number[], out: Array<[number, number]>, seen: Set<string>): void {
  const key = `${coord[0].toFixed(3)},${coord[1].toFixed(3)}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push([coord[0], coord[1]]);
}

function collectVertices(geom: Geometry, out: Array<[number, number]>, seen: Set<string>): void {
  const type = geom.getType();
  if (type === 'Point') {
    pushUnique((geom as Point).getCoordinates(), out, seen);
  } else if (type === 'LineString') {
    for (const c of (geom as LineString).getCoordinates()) pushUnique(c, out, seen);
  } else if (type === 'MultiLineString') {
    for (const line of (geom as MultiLineString).getCoordinates()) for (const c of line) pushUnique(c, out, seen);
  } else if (type === 'Polygon') {
    for (const ring of (geom as Polygon).getCoordinates()) for (const c of ring) pushUnique(c, out, seen);
  } else if (type === 'MultiPolygon') {
    for (const poly of (geom as MultiPolygon).getCoordinates()) for (const ring of poly) for (const c of ring) pushUnique(c, out, seen);
  }
}

export class GenerateVerticesCommand extends Command {
  readonly label = 'Generar vértices';
  private readonly opts: GenerateVerticesOpts;
  private newFeatureIds: Array<string | number> = [];

  constructor(opts: GenerateVerticesOpts) {
    super();
    this.opts = opts;
  }

  execute(ctx: CommandContext): void {
    this.newFeatureIds = [];
    if (!this.opts.layerId) return;

    const seen = new Set<string>();
    const points: Array<[number, number]> = [];

    for (const id of this.opts.sourceFeatureIds) {
      const feat = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      const geom = feat?.getGeometry();
      if (!geom) continue;
      collectVertices(geom, points, seen);
    }

    points.forEach((pt, i) => {
      const newFeat = new Feature({ geometry: new Point(pt) });
      const newId = `vert-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`;
      newFeat.setId(newId);
      newFeat.setProperties(ensureKind({ label: `Vértice ${i + 1}` }, 'vert_geo'));
      newFeat.set('layerId', this.opts.layerId, true);
      ctx.drawSource.addFeature(newFeat);
      this.newFeatureIds.push(newId);
    });

    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const id of this.newFeatureIds) {
      const f = ctx.drawSource.getFeatureById(id);
      if (f) ctx.drawSource.removeFeature(f);
    }
    this.newFeatureIds = [];
    ctx.drawSource.changed();
  }

  override redo(ctx: CommandContext): void {
    this.execute(ctx);
  }
}