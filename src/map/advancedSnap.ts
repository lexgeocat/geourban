import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';
import Circle from 'ol/geom/Circle.js';
import { getUid } from 'ol/util.js';
import { polygonCentroid } from '../geo/math/polygonEngine';

export type SnapType =
  'endpoint' | 'midpoint' | 'nearest' | 'perpendicular' | 'extension' | 'intersection' | 'center';

export interface SnapGuideVisual {
  dashedLine?: [number[], number[]];
  rightAngleSquare?: { point: number[]; size: number };
  highlightSegment?: [number[], number[]];
  distanceLabel?: { point: number[]; text: string };
}

export interface SnapResult {
  point: number[];
  type: SnapType;
  dist: number;
  feature?: Feature;
  guide?: SnapGuideVisual;
}

export type SnapSettings = Record<SnapType, boolean>;

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  endpoint: true,
  midpoint: true,
  nearest: true,
  perpendicular: true,
  extension: true,
  intersection: true,
  center: true,
};

export const SNAP_GROUPS: { label: string; types: SnapType[] }[] = [
  { label: 'Geométricos', types: ['endpoint', 'midpoint', 'intersection', 'center'] },
  { label: 'Construcción', types: ['perpendicular', 'extension', 'nearest'] },
];

export const SNAP_TYPE_PRIORITY: Record<SnapType, number> = {
  endpoint: 0,
  intersection: 1,
  extension: 3,
  midpoint: 4,
  center: 4,
  perpendicular: 5,
  nearest: 7,
};

/** Radio de captura por tipo, como multiplicador del pixelTolerance base. */
const TYPE_TOLERANCE_FACTOR: Record<SnapType, number> = {
  endpoint: 1.15,
  intersection: 1.0,
  extension: 1.6,
  midpoint: 1.0,
  center: 1.2,
  perpendicular: 1.0,
  nearest: 0.85,
};

/** Radio (px) del broad-phase para descartar segmentos irrelevantes. */
const BROAD_PHASE_RADIUS_PX = 260;
const STICKY_BAND_PX = 3;

export interface SpatialIndexLike {
  searchPoint(x: number, y: number, tolerance: number): unknown[];
}

export interface FindSnapOptions {
  resolution: number;
  pixelTolerance?: number;
  anchor?: number[];
  spatialIndex?: SpatialIndexLike;
  enabled?: Partial<SnapSettings>;
  previous?: SnapResult | null;
  excludeFeature?: Feature | null;
  extraFeatures?: Feature[];
  filter?: (feature: Feature) => boolean;
}

interface SnapCandidate {
  point: number[];
  type: SnapType;
  feature?: Feature;
  dist: number;
  guide?: SnapGuideVisual;
}

// ─── Helpers geométricos ────────────────────────────────────────────

function midpoint(a: number[], b: number[]): number[] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function dist(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function isOnSegment(p: number[], a: number[], b: number[], eps = 1e-6): boolean {
  return (
    p[0] >= Math.min(a[0], b[0]) - eps &&
    p[0] <= Math.max(a[0], b[0]) + eps &&
    p[1] >= Math.min(a[1], b[1]) - eps &&
    p[1] <= Math.max(a[1], b[1]) + eps
  );
}

/** Broad-phase: ¿puede este segmento aportar algún candidato cerca del cursor? */
function segmentMayBeNear(cursor: number[], a: number[], b: number[], margin: number): boolean {
  const minX = (a[0] < b[0] ? a[0] : b[0]) - margin;
  if (cursor[0] < minX) return false;
  const maxX = (a[0] > b[0] ? a[0] : b[0]) + margin;
  if (cursor[0] > maxX) return false;
  const minY = (a[1] < b[1] ? a[1] : b[1]) - margin;
  if (cursor[1] < minY) return false;
  const maxY = (a[1] > b[1] ? a[1] : b[1]) + margin;
  if (cursor[1] > maxY) return false;
  return true;
}

function nearestPointOnSegment(p: number[], a: number[], b: number[]): number[] | null {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const ap = [p[0] - a[0], p[1] - a[1]];
  const ab2 = ab[0] * ab[0] + ab[1] * ab[1];
  if (ab2 === 0) return null;
  let t = (ap[0] * ab[0] + ap[1] * ab[1]) / ab2;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + t * ab[0], a[1] + t * ab[1]];
}

function perpendicularFromAnchor(anchor: number[], a: number[], b: number[]): number[] | null {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const ab2 = ab[0] * ab[0] + ab[1] * ab[1];
  if (ab2 < 1e-10) return null;
  const tRaw = ((anchor[0] - a[0]) * ab[0] + (anchor[1] - a[1]) * ab[1]) / ab2;
  if (tRaw < -0.001 || tRaw > 1.001) return null;
  const t = Math.max(0, Math.min(1, tRaw));
  return [a[0] + t * ab[0], a[1] + t * ab[1]];
}

function lineLineIntersection(
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
  return [px, py];
}

function segExtendSnap(
  cursor: number[],
  a: number[],
  b: number[],
  tolerance: number
): { point: number[]; anchor: number[] } | null {
  const slen = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (slen < 1e-10) return null;

  let best: { point: number[]; anchor: number[]; d: number } | null = null;
  for (const [anchor, other] of [
    [a, b],
    [b, a],
  ] as [number[], number[]][]) {
    const adx = other[0] - anchor[0],
      ady = other[1] - anchor[1];
    const alen = Math.hypot(adx, ady);
    if (alen < 1e-10) continue;
    const aux = adx / alen,
      auy = ady / alen;
    const dotVal = (cursor[0] - anchor[0]) * aux + (cursor[1] - anchor[1]) * auy;
    if (dotVal > 0) continue;
    const projX = anchor[0] + dotVal * aux;
    const projY = anchor[1] + dotVal * auy;
    const d = Math.hypot(cursor[0] - projX, cursor[1] - projY);
    if (d < tolerance && (!best || d < best.d)) {
      best = { point: [projX, projY], anchor, d };
    }
  }
  return best ? { point: best.point, anchor: best.anchor } : null;
}

// ─── Recolección de segmentos ───────────────────────────────────────

function getSegmentCoords(geom: { getType: () => string }): number[][][] {
  const type = geom.getType();
  if (type === 'Polygon') return [(geom as Polygon).getCoordinates()[0]];
  if (type === 'LineString') return [(geom as LineString).getCoordinates()];
  if (type === 'MultiPolygon') return (geom as MultiPolygon).getCoordinates().map((p) => p[0]);
  return [];
}

// ─── Histéresis anti-parpadeo ────────────────────────────────────────

function applySticky(
  best: SnapResult | null,
  previous: SnapResult | null | undefined,
  cursor: number[],
  tolerance: number,
  resolution: number
): SnapResult | null {
  if (!previous) return best;
  const stickyRadius = STICKY_BAND_PX * resolution;
  const prevStillClose = dist(cursor, previous.point) < tolerance + stickyRadius;
  if (!prevStillClose) return best;
  if (!best) return previous;
  if (dist(best.point, previous.point) < stickyRadius * 0.5) return best;
  if (SNAP_TYPE_PRIORITY[previous.type] <= SNAP_TYPE_PRIORITY[best.type]) return previous;
  return best;
}

// ─── findSnap principal ─────────────────────────────────────────────

const DEFAULT_PIXEL_TOLERANCE = 10;

export function findSnap(
  cursor: number[],
  src: VectorSource,
  options: FindSnapOptions
): SnapResult | null {
  const {
    resolution,
    pixelTolerance = DEFAULT_PIXEL_TOLERANCE,
    anchor,
    spatialIndex,
    enabled,
    previous,
    excludeFeature,
    extraFeatures,
    filter,
  } = options;

  const settings: SnapSettings = { ...DEFAULT_SNAP_SETTINGS, ...enabled };
  const baseTolerance = pixelTolerance * resolution;
  const extendTolerance = baseTolerance * TYPE_TOLERANCE_FACTOR.extension;
  const broadPhaseMargin = Math.max(BROAD_PHASE_RADIUS_PX * resolution, extendTolerance * 1.25);

  const candidates: SnapCandidate[] = [];
  const segmentEntries: Array<{ a: number[]; b: number[]; ringId: string; idx: number }> = [];

  const nearbyFeatures = spatialIndex
    ? (spatialIndex.searchPoint(cursor[0], cursor[1], broadPhaseMargin * 1.5) as Feature[])
    : null;

  const processFeature = (feat: Feature) => {
    if (excludeFeature && feat === excludeFeature) return;
    if (filter && !filter(feat)) return;
    const geom = feat.getGeometry();
    if (!geom) return;
    const fid = feat.getId() != null ? String(feat.getId()) : getUid(feat);

    if (settings.center) {
      const tol = baseTolerance * TYPE_TOLERANCE_FACTOR.center;
      const pushCenterCandidate = (c: number[]) => {
        const d = dist(cursor, c);
        if (d < tol) {
          candidates.push({
            point: c,
            type: 'center',
            feature: feat,
            dist: d,
            guide: { rightAngleSquare: { point: c, size: 8 * resolution } },
          });
        }
      };

      if (geom instanceof Circle) {
        pushCenterCandidate(geom.getCenter());
      } else if (geom instanceof Polygon) {
        const outer = geom.getCoordinates()[0];
        if (outer && outer.length >= 3) {
          pushCenterCandidate(polygonCentroid(outer as [number, number][]));
        }
      } else if (geom instanceof MultiPolygon) {
        for (const poly of geom.getCoordinates()) {
          const outer = poly[0];
          if (outer && outer.length >= 3) {
            pushCenterCandidate(polygonCentroid(outer as [number, number][]));
          }
        }
      }
    }

    getSegmentCoords(geom).forEach((ring, ringIdx) => {
      const ringId = `${fid}:${ringIdx}`;
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];

        if (!segmentMayBeNear(cursor, a, b, broadPhaseMargin)) continue;

        segmentEntries.push({ a, b, ringId, idx: i });

        if (settings.endpoint) {
          const tol = baseTolerance * TYPE_TOLERANCE_FACTOR.endpoint;
          for (const coord of [a, b]) {
            const d = dist(cursor, coord);
            if (d < tol)
              candidates.push({ point: coord, type: 'endpoint', feature: feat, dist: d });
          }
        }

        if (settings.extension) {
          const ext = segExtendSnap(cursor, a, b, extendTolerance);
          if (ext) {
            candidates.push({
              point: ext.point,
              type: 'extension',
              feature: feat,
              dist: dist(cursor, ext.point),
              guide: {
                dashedLine: [ext.anchor, ext.point],
                distanceLabel: {
                  point: midpoint(ext.anchor, ext.point),
                  text: `${dist(ext.anchor, ext.point).toFixed(2)} m`,
                },
              },
            });
          }
        }

        if (settings.midpoint) {
          const tol = baseTolerance * TYPE_TOLERANCE_FACTOR.midpoint;
          const mp = midpoint(a, b);
          const dM = dist(cursor, mp);
          if (dM < tol) candidates.push({ point: mp, type: 'midpoint', feature: feat, dist: dM });
        }

        if (settings.perpendicular && anchor) {
          const pp = perpendicularFromAnchor(anchor, a, b);
          if (pp) {
            const tol = baseTolerance * TYPE_TOLERANCE_FACTOR.perpendicular;
            const d = dist(cursor, pp);
            if (d < tol) {
              candidates.push({
                point: pp,
                type: 'perpendicular',
                feature: feat,
                dist: d,
                guide: {
                  dashedLine: [anchor, pp],
                  highlightSegment: [a, b],
                  rightAngleSquare: { point: pp, size: 8 * resolution },
                },
              });
            }
          }
        }

        if (settings.nearest) {
          const np = nearestPointOnSegment(cursor, a, b);
          if (np) {
            const tol = baseTolerance * TYPE_TOLERANCE_FACTOR.nearest;
            const d = dist(cursor, np);
            if (d < tol) candidates.push({ point: np, type: 'nearest', feature: feat, dist: d });
          }
        }
      }
    });
  };

  if (nearbyFeatures) {
    for (const feat of nearbyFeatures) processFeature(feat as Feature);
  } else {
    src.forEachFeature((feat) => processFeature(feat));
  }

  if (extraFeatures && extraFeatures.length > 0) {
    for (const feat of extraFeatures) processFeature(feat);
  }

  if (settings.intersection) {
    const n = segmentEntries.length;
    for (let i = 0; i < n; i++) {
      const s1 = segmentEntries[i];
      for (let j = i + 1; j < n; j++) {
        const s2 = segmentEntries[j];
        if (s1.ringId === s2.ringId && Math.abs(s1.idx - s2.idx) <= 1) continue;

        const hit = lineLineIntersection(s1.a, s1.b, s2.a, s2.b);
        if (!hit) continue;
        const d = dist(cursor, hit);
        if (d >= baseTolerance) continue;

        const onA = isOnSegment(hit, s1.a, s1.b);
        const onB = isOnSegment(hit, s2.a, s2.b);

        if (onA && onB) {
          candidates.push({ point: hit, type: 'intersection', dist: d });
        }
      }
    }
  }

  if (candidates.length === 0) {
    return applySticky(null, previous, cursor, baseTolerance, resolution);
  }

  candidates.sort((a, b) => {
    const pa = SNAP_TYPE_PRIORITY[a.type],
      pb = SNAP_TYPE_PRIORITY[b.type];
    return pa !== pb ? pa - pb : a.dist - b.dist;
  });

  const best = candidates[0];
  const result: SnapResult = {
    point: best.point,
    type: best.type,
    dist: best.dist,
    feature: best.feature,
    guide: best.guide,
  };
  return applySticky(result, previous, cursor, baseTolerance, resolution);
}

// ─── Colores y etiquetas por tipo de snap ───────────────────────────

export const SNAP_COLORS: Record<SnapType, string> = {
  endpoint: '#00d4ff',
  midpoint: '#10b981',
  nearest: '#94a3b8',
  perpendicular: '#f59e0b',
  extension: '#ffa657',
  intersection: '#ef4444',
  center: '#06b6d4',
};

export const SNAP_LABELS: Record<SnapType, string> = {
  endpoint: 'Extremo',
  midpoint: 'Punto medio',
  nearest: 'Más cercano',
  perpendicular: 'Perpendicular',
  extension: 'Extensión',
  intersection: 'Intersección',
  center: 'Centro',
};
