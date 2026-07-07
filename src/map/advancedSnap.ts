import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';

const TOLERANCE_M = 5;

function midpoint(a: number[], b: number[]): number[] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function dist(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function perpendicularProjection(p: number[], a: number[], b: number[]): number[] | null {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const ap = [p[0] - a[0], p[1] - a[1]];
  const ab2 = ab[0] * ab[0] + ab[1] * ab[1];
  if (ab2 === 0) return null;
  let t = (ap[0] * ab[0] + ap[1] * ab[1]) / ab2;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + t * ab[0], a[1] + t * ab[1]];
}

function parallelProjection(cursor: number[], a: number[], b: number[]): number[] | null {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const abLen = Math.hypot(ab[0], ab[1]);
  if (abLen === 0) return null;

  const ap = [cursor[0] - a[0], cursor[1] - a[1]];
  const t = (ap[0] * ab[0] + ap[1] * ab[1]) / (abLen * abLen);
  return [a[0] + t * ab[0], a[1] + t * ab[1]];
}

function segmentIntersection(
  a1: number[],
  a2: number[],
  b1: number[],
  b2: number[]
): number[] | null {
  const x1 = a1[0],
    y1 = a1[1],
    x2 = a2[0],
    y2 = a2[1];
  const x3 = b1[0],
    y3 = b1[1],
    x4 = b2[0],
    y4 = b2[1];
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-12) return null;

  const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
  const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;

  const onSegment = (x: number, y: number, sx1: number, sy1: number, sx2: number, sy2: number) =>
    x >= Math.min(sx1, sx2) - 1e-6 &&
    x <= Math.max(sx1, sx2) + 1e-6 &&
    y >= Math.min(sy1, sy2) - 1e-6 &&
    y <= Math.max(sy1, sy2) + 1e-6;

  if (onSegment(px, py, x1, y1, x2, y2) && onSegment(px, py, x3, y3, x4, y4)) {
    return [px, py];
  }
  return null;
}

function getSegmentCoords(geom: { getType: () => string }): number[][][] {
  const type = geom.getType();
  if (type === 'Polygon') return [(geom as Polygon).getCoordinates()[0]];
  if (type === 'LineString') return [(geom as LineString).getCoordinates()];
  if (type === 'MultiPolygon') return (geom as MultiPolygon).getCoordinates().map((p) => p[0]);
  return [];
}

function collectSegments(src: VectorSource): Array<[number[], number[]]> {
  const segments: Array<[number[], number[]]> = [];
  src.forEachFeature((feat) => {
    const geom = feat.getGeometry();
    if (!geom) return;
    const rings = getSegmentCoords(geom);
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        segments.push([ring[i], ring[i + 1]]);
      }
    }
  });
  return segments;
}

type SnapType = 'vertex' | 'midpoint' | 'perpendicular' | 'parallel' | 'intersection';
type SnapCandidate = { point: number[]; type: SnapType; feature: Feature; dist: number };

export interface SnapResult {
  point: number[];
  type: SnapType;
  feature: Feature;
}

export function findSnap(
  cursor: number[],
  src: VectorSource,
  tolerance: number = TOLERANCE_M
): SnapResult | null {
  const candidates: SnapCandidate[] = [];
  const segments = collectSegments(src);

  src.forEachFeature((feat) => {
    const geom = feat.getGeometry();
    if (!geom) return;
    const rings = getSegmentCoords(geom);

    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];

        for (const coord of [a, b]) {
          const dV = dist(cursor, coord);
          if (dV < tolerance) {
            candidates.push({ point: coord, type: 'vertex', feature: feat, dist: dV });
          }
        }

        const mp = midpoint(a, b);
        const dM = dist(cursor, mp);
        if (dM < tolerance)
          candidates.push({ point: mp, type: 'midpoint', feature: feat, dist: dM });

        const pp = perpendicularProjection(cursor, a, b);
        if (pp) {
          const dP = dist(cursor, pp);
          if (dP < tolerance)
            candidates.push({ point: pp, type: 'perpendicular', feature: feat, dist: dP });
        }

        const par = parallelProjection(cursor, a, b);
        if (par) {
          const dPar = dist(cursor, par);
          if (dPar < tolerance)
            candidates.push({ point: par, type: 'parallel', feature: feat, dist: dPar });
        }
      }
    }
  });

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const hit = segmentIntersection(
        segments[i][0],
        segments[i][1],
        segments[j][0],
        segments[j][1]
      );
      if (!hit) continue;
      const dI = dist(cursor, hit);
      if (dI < tolerance) {
        candidates.push({
          point: hit,
          type: 'intersection',
          feature: new Feature(),
          dist: dI,
        });
      }
    }
  }

  candidates.sort((a, b) => a.dist - b.dist);
  if (candidates.length === 0) return null;
  return { point: candidates[0].point, type: candidates[0].type, feature: candidates[0].feature };
}

export function createSnapPoints(src: VectorSource): VectorSource {
  const snapSrc = new VectorSource();
  const seen = new Set<string>();

  for (const [a, b] of collectSegments(src)) {
    const mp = midpoint(a, b);
    const keyM = `${mp[0].toFixed(4)},${mp[1].toFixed(4)}`;
    if (!seen.has(keyM)) {
      seen.add(keyM);
      snapSrc.addFeature(new Feature({ geometry: new Point(mp) }));
    }
  }

  return snapSrc;
}

export const SNAP_COLORS: Record<SnapType, string> = {
  vertex: '#00d4ff',
  midpoint: '#10b981',
  perpendicular: '#f59e0b',
  parallel: '#7c3aed',
  intersection: '#ef4444',
};
