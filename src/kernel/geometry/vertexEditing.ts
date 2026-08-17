import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';

export interface VertexHit {
  feature: Feature<Geometry>;
  ringIndex: number; // -1 para LineString
  vertexIndex: number;
}

export function findNearestVertex(
  features: Feature<Geometry>[],
  coord: number[],
  toleranceMapUnits: number
): VertexHit | null {
  let best: VertexHit | null = null;
  let bestDist = toleranceMapUnits;

  for (const feature of features) {
    const geom = feature.getGeometry();
    if (geom instanceof Polygon) {
      const rings = geom.getCoordinates();
      for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];
        for (let i = 0; i < ring.length - 1; i++) {
          const d = Math.hypot(ring[i][0] - coord[0], ring[i][1] - coord[1]);
          if (d < bestDist) {
            bestDist = d;
            best = { feature, ringIndex: r, vertexIndex: i };
          }
        }
      }
    } else if (geom instanceof LineString) {
      const coords = geom.getCoordinates();
      for (let i = 0; i < coords.length; i++) {
        const d = Math.hypot(coords[i][0] - coord[0], coords[i][1] - coord[1]);
        if (d < bestDist) {
          bestDist = d;
          best = { feature, ringIndex: -1, vertexIndex: i };
        }
      }
    }
  }
  return best;
}

export function removeVertexFromFeature(
  feature: Feature<Geometry>,
  ringIndex: number,
  vertexIndex: number
): boolean {
  const geom = feature.getGeometry();
  if (geom instanceof Polygon) {
    const rings = geom.getCoordinates();
    const ring = rings[ringIndex];
    if (!ring) return false;
    const uniqueCount = ring.length - 1; // sin contar el punto de cierre duplicado
    if (uniqueCount <= 3) return false; // un polígono necesita ≥3 vértices únicos
    const next = ring.slice();
    next.splice(vertexIndex, 1);
    if (vertexIndex === 0) {
      next[next.length - 1] = [next[0][0], next[0][1]]; // re-cierra el anillo
    }
    rings[ringIndex] = next;
    geom.setCoordinates(rings);
    return true;
  }
  if (geom instanceof LineString) {
    const coords = geom.getCoordinates();
    if (coords.length <= 2) return false; // una línea necesita ≥2 puntos
    const next = coords.slice();
    next.splice(vertexIndex, 1);
    geom.setCoordinates(next);
    return true;
  }
  return false;
}
