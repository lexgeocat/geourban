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

// ─── Handles de rectángulo (esquina/lado) ───────────────────────────────

export interface RectHandleHit {
  feature: Feature<Geometry>;
  kind: 'corner' | 'edge';
  index: number;
  point: [number, number];
}
export function ringCorners(geom: Polygon): [number, number][] | null {
  const ring = geom.getCoordinates()[0];
  if (!ring || ring.length < 4) return null;
  const pts = ring.slice(0, 4).map((c) => [c[0], c[1]] as [number, number]);
  return pts.length === 4 ? pts : null;
}
export function findNearestRectHandle(
  features: Feature<Geometry>[],
  coord: number[],
  toleranceMapUnits: number
): RectHandleHit | null {
  let best: RectHandleHit | null = null;
  let bestDist = toleranceMapUnits;

  for (const feature of features) {
    const geom = feature.getGeometry();
    if (!(geom instanceof Polygon)) continue;
    const corners = ringCorners(geom);
    if (!corners) continue;

    corners.forEach((c, i) => {
      const d = Math.hypot(c[0] - coord[0], c[1] - coord[1]);
      if (d < bestDist) {
        bestDist = d;
        best = { feature, kind: 'corner', index: i, point: c };
      }
    });
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const d = Math.hypot(mid[0] - coord[0], mid[1] - coord[1]);
      if (d < bestDist) {
        bestDist = d;
        best = { feature, kind: 'edge', index: i, point: mid };
      }
    }
  }
  return best;
}
