import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';
import { getUid } from 'ol/util.js';

/**
 * Sistema de snapping profesional — inspirado en Object Snap (OSNAP) de AutoCAD.
 *
 * Tipos soportados (prioridad de mayor a menor):
 *  1. endpoint            — vértice existente de una entidad
 *  2. intersection         — intersección real entre dos segmentos (dentro de ambos)
 *  3. apparentIntersection — intersección de la extensión infinita de dos segmentos
 *  4. extension            — extensión de un segmento más allá de su endpoint
 *  5. midpoint              — punto medio de un segmento
 *  6. perpendicular         — pie perpendicular desde un punto ancla (último vértice dibujado)
 *  7. parallel              — proyección paralela desde un ancla, según dirección de un segmento de referencia
 *  8. nearest               — punto más cercano sobre cualquier segmento (fallback)
 *
 * La zona de snap se define en PÍXELES de pantalla (no en metros), para que
 * el comportamiento sea consistente en cualquier nivel de zoom.
 */

// ─── Tipos ──────────────────────────────────────────────────────────

export type SnapType =
  | 'endpoint'
  | 'midpoint'
  | 'nearest'
  | 'perpendicular'
  | 'extension'
  | 'intersection'
  | 'apparentIntersection'
  | 'parallel';

export interface SnapGuideVisual {
  dashedLine?: [number[], number[]];
  rightAngleSquare?: { point: number[]; size: number };
  highlightSegment?: [number[], number[]];
  distanceLabel?: { point: number[]; text: string };
}

export interface SnapResult {
  point: number[];
  type: SnapType;
  /** Distancia (unidades de mapa) del cursor al punto de snap. */
  dist: number;
  /** Feature de origen, si aplica (no aplica a intersecciones sintéticas). */
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
  apparentIntersection: true,
  parallel: true,
};

interface SnapCandidate {
  point: number[];
  type: SnapType;
  feature?: Feature;
  dist: number;
  guide?: SnapGuideVisual;
}

export interface FindSnapOptions {
  /** Resolución actual del mapa (map units / px). Requerida para tolerancia consistente. */
  resolution: number;
  /** Radio de snap en píxeles de pantalla (default 10). */
  pixelTolerance?: number;
  /** Punto ancla activo (ej. último vértice del sketch en curso) para perpendicular/parallel. */
  anchor?: number[];
  /** Segmento de referencia activo para 'parallel' (lado ya dibujado que se quiere replicar). */
  parallelRefSegment?: [number[], number[]];
  /** Índice espacial opcional para acotar features cercanas (O(log n) en vez de O(n)). */
  spatialIndex?: { searchPoint: (x: number, y: number, tol: number) => unknown[] };
  /** Tipos de snap habilitados; por defecto todos. */
  enabled?: Partial<SnapSettings>;
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

/** Punto más cercano sobre el segmento [a,b] (clamped a t∈[0,1]) — osnap "Nearest". */
function nearestPointOnSegment(p: number[], a: number[], b: number[]): number[] | null {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const ap = [p[0] - a[0], p[1] - a[1]];
  const ab2 = ab[0] * ab[0] + ab[1] * ab[1];
  if (ab2 === 0) return null;
  let t = (ap[0] * ab[0] + ap[1] * ab[1]) / ab2;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + t * ab[0], a[1] + t * ab[1]];
}

/**
 * Pie perpendicular desde `anchor` sobre el segmento a-b (clamped al segmento).
 * A diferencia de nearestPointOnSegment, esto representa el osnap
 * PERPENDICULAR real de AutoCAD: exige un punto de referencia activo
 * (típicamente el último vértice dibujado).
 */
function perpendicularFromAnchor(anchor: number[], a: number[], b: number[]): number[] | null {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const ab2 = ab[0] * ab[0] + ab[1] * ab[1];
  if (ab2 < 1e-10) return null;
  const tRaw = ((anchor[0] - a[0]) * ab[0] + (anchor[1] - a[1]) * ab[1]) / ab2;
  if (tRaw < -0.001 || tRaw > 1.001) return null; // el pie debe caer dentro del segmento
  const t = Math.max(0, Math.min(1, tRaw));
  return [a[0] + t * ab[0], a[1] + t * ab[1]];
}

/**
 * Snap "parallel": dado un segmento de referencia (a,b) y un ancla (último
 * vértice del sketch en curso), construye la recta que pasa por `anchor`
 * con la misma dirección que a→b, y proyecta el cursor sobre ella.
 */
function parallelFromAnchor(cursor: number[], anchor: number[], a: number[], b: number[]): number[] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-10) return null;
  const ux = dx / len, uy = dy / len;
  const t = (cursor[0] - anchor[0]) * ux + (cursor[1] - anchor[1]) * uy;
  return [anchor[0] + t * ux, anchor[1] + t * uy];
}

function lineLineIntersection(a1: number[], a2: number[], b1: number[], b2: number[]): number[] | null {
  const x1 = a1[0], y1 = a1[1], x2 = a2[0], y2 = a2[1];
  const x3 = b1[0], y3 = b1[1], x4 = b2[0], y4 = b2[1];
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-12) return null; // paralelas o coincidentes
  const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
  const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;
  return [px, py];
}

/** Extensión de un segmento más allá de alguno de sus endpoints (osnap EXTENSION). */
function segExtendSnap(
  cursor: number[],
  a: number[],
  b: number[],
  tolerance: number
): { point: number[]; anchor: number[] } | null {
  const slen = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (slen < 1e-10) return null;

  let best: { point: number[]; anchor: number[]; d: number } | null = null;
  for (const [anchor, other] of [[a, b], [b, a]] as [number[], number[]][]) {
    const adx = other[0] - anchor[0], ady = other[1] - anchor[1];
    const alen = Math.hypot(adx, ady);
    if (alen < 1e-10) continue;
    const aux = adx / alen, auy = ady / alen;
    const dotVal = (cursor[0] - anchor[0]) * aux + (cursor[1] - anchor[1]) * auy;
    if (dotVal > 0) continue; // el cursor debe estar "detrás" del endpoint (extensión real)
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

function collectSegments(src: VectorSource): Array<[number[], number[]]> {
  const segments: Array<[number[], number[]]> = [];
  src.forEachFeature((feat) => {
    const geom = feat.getGeometry();
    if (!geom) return;
    for (const ring of getSegmentCoords(geom)) {
      for (let i = 0; i < ring.length - 1; i++) segments.push([ring[i], ring[i + 1]]);
    }
  });
  return segments;
}

// ─── findSnap principal ─────────────────────────────────────────────

const DEFAULT_PIXEL_TOLERANCE = 10;

export function findSnap(cursor: number[], src: VectorSource, options: FindSnapOptions): SnapResult | null {
  const {
    resolution,
    pixelTolerance = DEFAULT_PIXEL_TOLERANCE,
    anchor,
    parallelRefSegment,
    spatialIndex,
    enabled,
  } = options;

  const settings: SnapSettings = { ...DEFAULT_SNAP_SETTINGS, ...enabled };
  // Tolerancia en unidades de mapa, consistente en pantalla a cualquier zoom.
  const tolerance = pixelTolerance * resolution;
  const extendTolerance = tolerance * 2;

  const candidates: SnapCandidate[] = [];
  const segmentEntries: Array<{ a: number[]; b: number[]; ringId: string; idx: number }> = [];

  const nearbyFeatures = spatialIndex
    ? (spatialIndex.searchPoint(cursor[0], cursor[1], tolerance * 3) as Feature[])
    : null;

  const processFeature = (feat: Feature) => {
    const geom = feat.getGeometry();
    if (!geom) return;
    const fid = feat.getId() != null ? String(feat.getId()) : getUid(feat);

    getSegmentCoords(geom).forEach((ring, ringIdx) => {
      const ringId = `${fid}:${ringIdx}`;
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const b = ring[i + 1];
        segmentEntries.push({ a, b, ringId, idx: i });

        // 1. Endpoint
        if (settings.endpoint) {
          for (const coord of [a, b]) {
            const d = dist(cursor, coord);
            if (d < tolerance) candidates.push({ point: coord, type: 'endpoint', feature: feat, dist: d });
          }
        }

        // 2. Extension
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

        // 3. Midpoint
        if (settings.midpoint) {
          const mp = midpoint(a, b);
          const dM = dist(cursor, mp);
          if (dM < tolerance) candidates.push({ point: mp, type: 'midpoint', feature: feat, dist: dM });
        }

        // 4. Perpendicular (requiere anchor activo: último vértice del sketch en curso)
        if (settings.perpendicular && anchor) {
          const pp = perpendicularFromAnchor(anchor, a, b);
          if (pp) {
            const d = dist(cursor, pp);
            if (d < tolerance) {
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

        // 5. Parallel (requiere anchor + segmento de referencia acquired)
        if (settings.parallel && anchor && parallelRefSegment) {
          const par = parallelFromAnchor(cursor, anchor, parallelRefSegment[0], parallelRefSegment[1]);
          if (par) {
            const d = dist(cursor, par);
            if (d < tolerance) {
              candidates.push({
                point: par,
                type: 'parallel',
                dist: d,
                guide: { dashedLine: [anchor, par], highlightSegment: parallelRefSegment },
              });
            }
          }
        }

        // 6. Nearest (fallback siempre disponible)
        if (settings.nearest) {
          const np = nearestPointOnSegment(cursor, a, b);
          if (np) {
            const d = dist(cursor, np);
            if (d < tolerance) candidates.push({ point: np, type: 'nearest', feature: feat, dist: d });
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

  // 7 & 8: Intersección real / aparente — una sola pasada por par de segmentos,
  // excluyendo pares del mismo anillo que comparten vértice (adyacentes),
  // que de otro modo generarían una "intersección" espuria en cada esquina.
  if (settings.intersection || settings.apparentIntersection) {
    for (let i = 0; i < segmentEntries.length; i++) {
      for (let j = i + 1; j < segmentEntries.length; j++) {
        const s1 = segmentEntries[i];
        const s2 = segmentEntries[j];
        if (s1.ringId === s2.ringId && Math.abs(s1.idx - s2.idx) <= 1) continue;

        const hit = lineLineIntersection(s1.a, s1.b, s2.a, s2.b);
        if (!hit) continue;
        const d = dist(cursor, hit);
        if (d >= tolerance) continue;

        const onA = isOnSegment(hit, s1.a, s1.b);
        const onB = isOnSegment(hit, s2.a, s2.b);

        if (onA && onB) {
          if (settings.intersection) {
            candidates.push({ point: hit, type: 'intersection', dist: d });
          }
        } else if (settings.apparentIntersection) {
          candidates.push({
            point: hit,
            type: 'apparentIntersection',
            dist: d,
            guide: {
              dashedLine: [onA ? s2.b : s1.b, hit],
              highlightSegment: onA ? [s2.a, s2.b] : [s1.a, s1.b],
            },
          });
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  const TYPE_PRIORITY: Record<SnapType, number> = {
    endpoint: 0,
    intersection: 1,
    apparentIntersection: 2,
    extension: 3,
    midpoint: 4,
    perpendicular: 5,
    parallel: 6,
    nearest: 7,
  };

  candidates.sort((a, b) => {
    const pa = TYPE_PRIORITY[a.type], pb = TYPE_PRIORITY[b.type];
    return pa !== pb ? pa - pb : a.dist - b.dist;
  });

  const best = candidates[0];
  return { point: best.point, type: best.type, dist: best.dist, feature: best.feature, guide: best.guide };
}

// ─── createSnapPoints (para OL native Snap interaction) ─────────────

export function createSnapPoints(src: VectorSource): VectorSource {
  const snapSrc = new VectorSource();
  const seen = new Set<string>();
  for (const [a, b] of collectSegments(src)) {
    const mp = midpoint(a, b);
    const key = `${mp[0].toFixed(4)},${mp[1].toFixed(4)}`;
    if (!seen.has(key)) {
      seen.add(key);
      snapSrc.addFeature(new Feature({ geometry: new Point(mp) }));
    }
  }
  return snapSrc;
}

// ─── Colores y etiquetas por tipo de snap ───────────────────────────

export const SNAP_COLORS: Record<SnapType, string> = {
  endpoint: '#00d4ff',
  midpoint: '#10b981',
  nearest: '#94a3b8',
  perpendicular: '#f59e0b',
  extension: '#ffa657',
  intersection: '#ef4444',
  apparentIntersection: '#c026d3',
  parallel: '#7c3aed',
};

export const SNAP_LABELS: Record<SnapType, string> = {
  endpoint: 'Extremo',
  midpoint: 'Punto medio',
  nearest: 'Más cercano',
  perpendicular: 'Perpendicular',
  extension: 'Extensión',
  intersection: 'Intersección',
  apparentIntersection: 'Intersección aparente',
  parallel: 'Paralelo',
};