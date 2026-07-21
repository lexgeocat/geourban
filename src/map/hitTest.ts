import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import type VectorSource from 'ol/source/Vector.js';
import type { SpatialIndex } from './spatialIndex';
import { pointInPoly } from '../geo/polygonEngine';

/**
 * Hit-testing propio (RBush broad-phase + test exacto de geometría) —
 * reemplaza el uso de una capa Canvas2D invisible (`measurementLayer`)
 * como único mecanismo para que `ol/interaction/Select` /
 * `map.forEachFeatureAtPixel` supieran qué feature había bajo el cursor
 * (ver diagnóstico H2). Acá no se renderiza nada: es matemática pura
 * sobre las coordenadas de cada geometría.
 */

export interface HitTestOptions {
  /** Tolerancia en unidades de mapa (pixelTolerance * resolución). */
  tolerance: number;
  exclude?: Feature<Geometry> | null;
  filter?: (feature: Feature<Geometry>) => boolean;
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
        return { hit: false, area: Infinity }; // cayó en un hueco (ring interno)
      }
    }
    return { hit: true, area: ringArea(outer) };
  }

  // Tolerancia de borde: útil para polígonos muy angostos o clics justo
  // en el límite (mismo margen que antes daba el stroke de 6px de la
  // measurementLayer invisible).
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

/** Test directo contra una feature conocida (sin pasar por el índice
 *  espacial) — lo usa SafeTranslate, donde el conjunto a testear ya es
 *  la selección actual (típicamente unas pocas features). */
export function hitTestFeature(coordinate: number[], feature: Feature<Geometry>, tolerance: number): boolean {
  const geom = feature.getGeometry();
  if (!geom) return false;
  return geometryHit(coordinate, geom, tolerance).hit;
}

/**
 * Encuentra la feature "de encima" en `coordinate`. Para polígonos
 * solapados (p.ej. un lote dentro de un manzano) gana el de MENOR área
 * — heurística estándar en CAD/GIS: el elemento más específico/chico
 * suele ser el que el usuario quiere tocar. Una línea/punto muy cercano
 * al cursor gana sobre un polígono que también matchee (p.ej. una cota
 * dibujada encima de un lote).
 */
export function hitTestAtCoordinate(
  coordinate: number[],
  spatialIndex: SpatialIndex,
  source: VectorSource,
  options: HitTestOptions,
): Feature<Geometry> | null {
  const { tolerance, exclude, filter } = options;
  const candidates = spatialIndex.searchPoint(coordinate[0], coordinate[1], tolerance) as unknown as Array<Feature<Geometry>>;
  // Fallback: si el índice no devuelve nada (vacío/desactualizado),
  // recorremos el source completo — más lento pero correcto; no debería
  // dispararse en uso normal porque el índice se mantiene sincronizado
  // (ver H13, ya resuelto en Map.tsx con 'changefeature').
  const pool = candidates.length > 0 ? candidates : (source.getFeatures() as unknown as Array<Feature<Geometry>>);

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

/** Candidatos por bbox — usado por selección rect/lazo para acotar el
 *  set antes del test exacto, en vez de recorrer TODO el drawSource. */
export function hitTestCandidatesInExtent(
  extent: [number, number, number, number],
  spatialIndex: SpatialIndex,
): Array<Feature<Geometry>> {
  return spatialIndex.search(extent[0], extent[1], extent[2], extent[3]) as unknown as Array<Feature<Geometry>>;
}