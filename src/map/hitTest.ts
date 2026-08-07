import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import type VectorSource from 'ol/source/Vector.js';
import { pointInPoly } from '../geo/math/polygonEngine';
import { queryRustSpatialIndex } from './rustSpatialIndex';

export interface HitTestOptions {
  tolerance: number;
  exclude?: Feature<Geometry> | null;
  filter?: (feature: Feature<Geometry>) => boolean;
  extraFeatures?: Array<Feature<Geometry>>;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function polygonHit(coord: number[], geom: Polygon, tolerance: number): { hit: boolean; area: number } {
  const rings = geom.getCoordinates();
  const outer = rings[0];
  if (!outer || outer.length < 3) return { hit: false, area: Infinity };

  if (pointInPoly(coord[0], coord[1], outer as [number, number][])) {
    for (let i = 1; i < rings.length; i++) {
      if (pointInPoly(coord[0], coord[1], rings[i] as [number, number][])) {
        return { hit: false, area: Infinity };
      }
    }
    return { hit: true, area: ringArea(outer) };
  }

  for (let i = 0; i < outer.length - 1; i++) {
    if (distToSegment(coord[0], coord[1], outer[i][0], outer[i][1], outer[i + 1][0], outer[i + 1][1]) <= tolerance) {
      return { hit: true, area: ringArea(outer) };
    }
  }
  return { hit: false, area: Infinity };
}

function lineHit(coord: number[], geom: LineString, tolerance: number): { hit: boolean; dist: number } {
  const coords = geom.getCoordinates();
  let best = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const d = distToSegment(coord[0], coord[1], coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    if (d < best) best = d;
  }
  return { hit: best <= tolerance, dist: best };
}

function pointHit(coord: number[], geom: Point, tolerance: number): { hit: boolean; dist: number } {
  const c = geom.getCoordinates();
  const d = Math.hypot(coord[0] - c[0], coord[1] - c[1]);
  return { hit: d <= tolerance, dist: d };
}

function geometryHit(
  coord: number[],
  geom: Geometry,
  tolerance: number,
): { hit: boolean; area?: number; dist?: number } {
  if (geom instanceof Polygon) return polygonHit(coord, geom, tolerance);
  if (geom instanceof MultiPolygon) {
    let best: { hit: boolean; area: number } = { hit: false, area: Infinity };
    for (const poly of geom.getPolygons()) {
      const r = polygonHit(coord, poly, tolerance);
      if (r.hit && r.area < best.area) best = r;
    }
    return best;
  }
  if (geom instanceof LineString) return lineHit(coord, geom, tolerance);
  if (geom instanceof Point) return pointHit(coord, geom, tolerance);
  return { hit: false };
}

export function hitTestFeature(coordinate: number[], feature: Feature<Geometry>, tolerance: number): boolean {
  const geom = feature.getGeometry();
  if (!geom) return false;
  return geometryHit(coordinate, geom, tolerance).hit;
}

export async function hitTestAtCoordinateAsync(
  coordinate: number[],
  source: VectorSource,
  options: HitTestOptions,
): Promise<Feature<Geometry> | null> {
  const { tolerance, exclude, filter, extraFeatures } = options;

  const ids = await queryRustSpatialIndex(
    coordinate[0] - tolerance,
    coordinate[1] - tolerance,
    coordinate[0] + tolerance,
    coordinate[1] + tolerance,
  );
  const candidates: Array<Feature<Geometry>> = [];
  for (const id of ids) {
    const f = source.getFeatureById(id) as Feature<Geometry> | null;
    if (f) candidates.push(f);
  }
  const basePool = candidates.length > 0 ? candidates : (source.getFeatures() as unknown as Array<Feature<Geometry>>);
  const pool = extraFeatures && extraFeatures.length > 0 ? [...basePool, ...extraFeatures] : basePool;

  let bestPolygon: { feature: Feature<Geometry>; area: number } | null = null;
  let bestLinear: { feature: Feature<Geometry>; dist: number } | null = null;

  for (const feature of pool) {
    if (exclude && feature === exclude) continue;
    if (filter && !filter(feature)) continue;
    const geom = feature.getGeometry();
    if (!geom) continue;

    const r = geometryHit(coordinate, geom, tolerance);
    if (!r.hit) continue;

    if (r.area !== undefined) {
      if (!bestPolygon || r.area < bestPolygon.area) bestPolygon = { feature, area: r.area };
    } else if (r.dist !== undefined) {
      if (!bestLinear || r.dist < bestLinear.dist) bestLinear = { feature, dist: r.dist };
    }
  }

  if (bestLinear && (!bestPolygon || bestLinear.dist <= tolerance * 0.5)) return bestLinear.feature;
  if (bestPolygon) return bestPolygon.feature;
  if (bestLinear) return bestLinear.feature;
  return null;
}

/** Candidatos por bbox (lasso/rect select) respaldado por el índice nativo. */
export async function hitTestCandidatesInExtentAsync(
  extent: [number, number, number, number],
  source: VectorSource,
): Promise<Array<Feature<Geometry>>> {
  const ids = await queryRustSpatialIndex(extent[0], extent[1], extent[2], extent[3]);
  const out: Array<Feature<Geometry>> = [];
  for (const id of ids) {
    const f = source.getFeatureById(id) as Feature<Geometry> | null;
    if (f) out.push(f);
  }
  return out;
}