import type { Feature, FeatureCollection, Geometry, Polygon, MultiPolygon } from 'geojson';
import type { Pt } from './math/polygonEngine';
import { sanitizeRing } from './sanitizeRing';

function sanitizePolygonRings(coords: Pt[][], context: string): Pt[][] | null {
  if (!coords || coords.length === 0) return null;
  const outer = sanitizeRing(coords[0] as Pt[], { context: `${context}.outer` });
  if (!outer) return null;
  const rings: Pt[][] = [outer];
  for (let i = 1; i < coords.length; i++) {
    const hole = sanitizeRing(coords[i] as Pt[], { context: `${context}.hole` });
    // Un hueco degenerado se descarta solo — no invalida el contorno
    // exterior, que ya quedó saneado y válido.
    if (hole) rings.push(hole);
  }
  return rings;
}

function sanitizeGeometry(geom: Geometry | null | undefined, context: string): Geometry | null {
  if (!geom) return null;
  if (geom.type === 'Polygon') {
    const rings = sanitizePolygonRings(geom.coordinates as unknown as Pt[][], context);
    if (!rings) return null;
    return { type: 'Polygon', coordinates: rings as unknown as Polygon['coordinates'] };
  }
  if (geom.type === 'MultiPolygon') {
    const polys: Pt[][][] = [];
    (geom.coordinates as unknown as Pt[][][]).forEach((poly, i) => {
      const rings = sanitizePolygonRings(poly, `${context}[${i}]`);
      if (rings) polys.push(rings);
    });
    if (polys.length === 0) return null;
    return { type: 'MultiPolygon', coordinates: polys as unknown as MultiPolygon['coordinates'] };
  }
  return geom;
}

export interface SanitizeFeatureCollectionResult {
  collection: FeatureCollection;
  droppedCount: number;
}

/**
 * Sanea todos los polígonos/multipolígonos de una FeatureCollection antes
 * de que su geometría entre al resto del pipeline (manzanos, vías,
 * subdivisión). Features cuya geometría poligonal quede irrecuperable se
 * descartan; el resto de tipos de geometría (Point, LineString, etc.) pasa
 * sin tocar.
 */
export function sanitizeFeatureCollectionRings(fc: FeatureCollection, context: string): SanitizeFeatureCollectionResult {
  const features: Feature[] = [];
  let dropped = 0;
  for (const f of fc.features) {
    if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) {
      features.push(f);
      continue;
    }
    const cleaned = sanitizeGeometry(f.geometry, context);
    if (!cleaned) {
      dropped++;
      continue;
    }
    features.push({ ...f, geometry: cleaned as never });
  }
  return { collection: { type: 'FeatureCollection', features }, droppedCount: dropped };
}