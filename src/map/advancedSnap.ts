import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';

/**
 * Sistema de snapping avanzado — port de LOTES_SAI snapToVertex + extensiones.
 *
 * Tipos (prioridad de mayor a menor):
 *  1. vertex       — vértice existente
 *  2. segExtend    — extensión de segmento más allá de su endpoint (ray snap)
 *  3. midpoint     — punto medio de segmento
 *  4. perpendicular— pie perpendicular sobre un segmento
 *  5. parallel     — proyección paralela sobre un segmento
 *  6. intersection — intersección entre dos segmentos
 *
 * Cada snap puede incluir datos de guía visual (líneas punteadas,
 * cuadrados de ángulo recto, etiquetas de distancia) para renderizar
 * indicadores profesionales como LOTES_SAI.
 */

const TOLERANCE_M = 5;

// ─── Tipos ──────────────────────────────────────────────────────────

export type SnapType = 'vertex' | 'segExtend' | 'midpoint' | 'perpendicular' | 'parallel' | 'intersection';

export interface SnapGuideVisual {
  /** Línea guía punteada [from, to] */
  dashedLine?: [number[], number[]];
  /** Cuadrado de ángulo recto en el snap point (tamaño en map units) */
  rightAngleSquare?: { point: number[]; size: number };
  /** Segmento de referencia resaltado [a, b] */
  highlightSegment?: [number[], number[]];
  /** Etiqueta de distancia */
  distanceLabel?: { point: number[]; text: string };
}

export interface SnapResult {
  point: number[];
  type: SnapType;
  feature: Feature;
  /** Datos para renderizar guía visual (estilo LOTES_SAI) */
  guide?: SnapGuideVisual;
}

type SnapCandidate = { point: number[]; type: SnapType; feature: Feature; dist: number; guide?: SnapGuideVisual };

// ─── Helpers geométricos ────────────────────────────────────────────

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
  a1: number[], a2: number[], b1: number[], b2: number[]
): number[] | null {
  const x1 = a1[0], y1 = a1[1], x2 = a2[0], y2 = a2[1];
  const x3 = b1[0], y3 = b1[1], x4 = b2[0], y4 = b2[1];
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-12) return null;
  const px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denom;
  const py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denom;
  const onSegment = (x: number, y: number, sx1: number, sy1: number, sx2: number, sy2: number) =>
    x >= Math.min(sx1, sx2) - 1e-6 && x <= Math.max(sx1, sx2) + 1e-6 &&
    y >= Math.min(sy1, sy2) - 1e-6 && y <= Math.max(sy1, sy2) + 1e-6;
  if (onSegment(px, py, x1, y1, x2, y2) && onSegment(px, py, x3, y3, x4, y4)) {
    return [px, py];
  }
  return null;
}

// ─── Segment extension snap (LOTES_SAI segExtend) ──────────────────
// Snap a la extensión de un segmento más allá de su endpoint.
// Si el cursor está "detrás" del endpoint (dot < 0), proyecta sobre
// la línea del segmento extendida.

function segExtendSnap(
  cursor: number[],
  a: number[],
  b: number[],
): { point: number[]; anchor: number[]; dirX: number; dirY: number } | null {
  const sdx = b[0] - a[0], sdy = b[1] - a[1];
  const slen = Math.sqrt(sdx * sdx + sdy * sdy);
  if (slen < 1e-10) return null;

  // Probar extensión desde cada endpoint
  for (const [anchor, other] of [[a, b], [b, a]]) {
    const adx = other[0] - anchor[0], ady = other[1] - anchor[1];
    const alen = Math.sqrt(adx * adx + ady * ady);
    if (alen < 1e-10) continue;
    const aux = adx / alen, auy = ady / alen;
    const dotVal = (cursor[0] - anchor[0]) * aux + (cursor[1] - anchor[1]) * auy;
    if (dotVal <= 0) {
      // Cursor está "detrás" del endpoint → proyectar sobre la extensión
      const projX = anchor[0] + dotVal * aux;
      const projY = anchor[1] + dotVal * auy;
      const distToLine = Math.hypot(cursor[0] - projX, cursor[1] - projY);
      if (distToLine < TOLERANCE_M * 2) {
        return { point: [projX, projY], anchor, dirX: aux, dirY: auy };
      }
    }
  }
  return null;
}

// ─── Perpendicular from anchor snap (LOTES_SAI perp) ────────────────
// Snap al pie perpendicular desde un punto ancla (ej: inicio de calle)
// sobre un segmento del polígono. Útil para trazar calles perpendiculares.

function perpAnchorSnap(
  anchor: number[],
  cursor: number[],
  a: number[],
  b: number[],
): { point: number[]; guide: SnapGuideVisual } | null {
  const sdx = b[0] - a[0], sdy = b[1] - a[1];
  const slen2 = sdx * sdx + sdy * sdy;
  if (slen2 < 1e-10) return null;
  const slen = Math.sqrt(slen2);
  const sux = sdx / slen, suy = sdy / slen;
  const nx = -suy, ny = sux;

  // Intersección entre la perpendicular desde anchor y el segmento a-b
  const denom = nx * (-sdy) - ny * (-sdx);
  if (Math.abs(denom) < 1e-10) return null;
  const rhs_x = a[0] - anchor[0];
  const rhs_y = a[1] - anchor[1];
  const tLine = (rhs_x * (-sdy) - rhs_y * (-sdx)) / denom;
  const ix = anchor[0] + tLine * nx;
  const iy = anchor[1] + tLine * ny;
  const tSeg = ((ix - a[0]) * sdx + (iy - a[1]) * sdy) / slen2;

  if (tSeg < -0.01 || tSeg > 1.01) return null;

  const distToIntersect = Math.hypot(cursor[0] - ix, cursor[1] - iy);
  if (distToIntersect > TOLERANCE_M * 3) return null;

  return {
    point: [ix, iy],
    guide: {
      dashedLine: [anchor, [ix, iy]],
      highlightSegment: [a, b],
      rightAngleSquare: { point: [ix, iy], size: 2 },
    },
  };
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
    const rings = getSegmentCoords(geom);
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        segments.push([ring[i], ring[i + 1]]);
      }
    }
  });
  return segments;
}

// ─── findSnap principal ─────────────────────────────────────────────

export function findSnap(
  cursor: number[],
  src: VectorSource,
  tolerance: number = TOLERANCE_M,
  anchor?: number[],
  spatialIndex?: { searchPoint: (x: number, y: number, tol: number) => any[] },
): SnapResult | null {
  const candidates: SnapCandidate[] = [];

  // Si hay spatial index, pre-filtrar features cercanos (O(log n))
  // en vez de iterar TODOS los features (O(n))
  const nearbyFeatures = spatialIndex
    ? spatialIndex.searchPoint(cursor[0], cursor[1], tolerance * 3)
    : null;

  const segments: Array<[number[], number[]]> = [];

  const processFeature = (feat: Feature) => {
    const geom = feat.getGeometry();
    if (!geom) return;
    const rings = getSegmentCoords(geom);

    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        segments.push([ring[i], ring[i + 1]]);
        const a = ring[i];
        const b = ring[i + 1];

        // 1. Vértices (prioridad máxima)
        for (const coord of [a, b]) {
          const dV = dist(cursor, coord);
          if (dV < tolerance) {
            candidates.push({ point: coord, type: 'vertex', feature: feat, dist: dV });
          }
        }

        // 2. segExtend — extensión de segmento (LOTES_SAI)
        const ext = segExtendSnap(cursor, a, b);
        if (ext) {
          const dE = dist(cursor, ext.point);
          if (dE < tolerance * 2) {
            candidates.push({
              point: ext.point,
              type: 'segExtend',
              feature: feat,
              dist: dE,
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
        const mp = midpoint(a, b);
        const dM = dist(cursor, mp);
        if (dM < tolerance)
          candidates.push({ point: mp, type: 'midpoint', feature: feat, dist: dM });

        // 4. Perpendicular
        const pp = perpendicularProjection(cursor, a, b);
        if (pp) {
          const dP = dist(cursor, pp);
          if (dP < tolerance) {
            candidates.push({
              point: pp,
              type: 'perpendicular',
              feature: feat,
              dist: dP,
              guide: {
                highlightSegment: [a, b],
                rightAngleSquare: { point: pp, size: 1.5 },
              },
            });
          }
        }

        // 5. Parallel
        const par = parallelProjection(cursor, a, b);
        if (par) {
          const dPar = dist(cursor, par);
          if (dPar < tolerance)
            candidates.push({ point: par, type: 'parallel', feature: feat, dist: dPar });
        }

        // 6. PerpAnchor — perpendicular desde un ancla (LOTES_SAI)
        if (anchor) {
          const pa = perpAnchorSnap(anchor, cursor, a, b);
          if (pa) {
            const dPA = dist(cursor, pa.point);
            if (dPA < tolerance * 2) {
              candidates.push({
                point: pa.point,
                type: 'perpendicular',
                feature: feat,
                dist: dPA,
                guide: pa.guide,
              });
            }
          }
        }
      }
    }
  };

  // Usar spatial index para pre-filtrar (O(log n)) o scan completo (O(n))
  if (nearbyFeatures) {
    for (const feat of nearbyFeatures) {
      processFeature(feat as Feature);
    }
  } else {
    src.forEachFeature((feat) => processFeature(feat));
  }

  // 7. Intersecciones entre segmentos
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const hit = segmentIntersection(segments[i][0], segments[i][1], segments[j][0], segments[j][1]);
      if (!hit) continue;
      const dI = dist(cursor, hit);
      if (dI < tolerance) {
        candidates.push({ point: hit, type: 'intersection', feature: new Feature(), dist: dI });
      }
    }
  }

  // Ordenar por prioridad de tipo, luego por distancia
  const TYPE_PRIORITY: Record<SnapType, number> = {
    vertex: 0,
    segExtend: 1,
    midpoint: 2,
    perpendicular: 3,
    parallel: 4,
    intersection: 5,
  };

  candidates.sort((a, b) => {
    const pa = TYPE_PRIORITY[a.type], pb = TYPE_PRIORITY[b.type];
    if (pa !== pb) return pa - pb;
    return a.dist - b.dist;
  });

  if (candidates.length === 0) return null;
  const best = candidates[0];
  return { point: best.point, type: best.type, feature: best.feature, guide: best.guide };
}

// ─── createSnapPoints (para OL native Snap interaction) ─────────────

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

// ─── Colores por tipo de snap ───────────────────────────────────────

export const SNAP_COLORS: Record<SnapType, string> = {
  vertex: '#00d4ff',
  segExtend: '#ffa657',
  midpoint: '#10b981',
  perpendicular: '#f59e0b',
  parallel: '#7c3aed',
  intersection: '#ef4444',
};
