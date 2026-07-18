// ─── Tipos exportados ───────────────────────────────────────────────
export type Pt = [number, number];

export interface LotResult {
  pts: Pt[];
  isRemnant: boolean;
  frontM: number;
  depthM: number;
  areaM2: number;
}

export interface SliceResult {
  front: Pt[];
  rest: Pt[];
  areaM2: number;
}

export interface CutResult {
  t: number;
  isRemnant: boolean;
}

// ─── Helpers de escala (compatibilidad LOTES_SAI) ───────────────────

const MPP = 1; // metros por unidad → 1 (EPSG:3857 es métrico)

/** De unidades internas a metros (no-op en EPSG:3857) */
function wm(d: number): number {
  return d;
}

/** De metros a unidades internas (no-op en EPSG:3857) */
function mw(m: number): number {
  return m;
}

// ─── Primitivas geométricas ─────────────────────────────────────────

/** Área de un polígono en unidades internas (fórmula de Shoelace) */
export function polyArea(pts: Pt[]): number {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) / 2;
}

/** Área en m² (alias de polyArea en EPSG:3857) */
function polyAreaM2(pts: Pt[]): number {
  return polyArea(pts);
}

/** Centroide de un polígono */
export function centroid(pts: Pt[]): Pt {
  let cx = 0, cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  return [cx / pts.length, cy / pts.length];
}

/** Cross product para determinar de qué lado de la recta lp1→lp2 está pt */
function side(pt: Pt, lp1: Pt, lp2: Pt): number {
  return (lp2[0] - lp1[0]) * (pt[1] - lp1[1]) - (lp2[1] - lp1[1]) * (pt[0] - lp1[0]);
}

/** Clip de polígono contra un semiplano definido por lp1→lp2 */
export function clipHalfPlane(pts: Pt[], lp1: Pt, lp2: Pt, keepSide: number): Pt[] {
  if (pts.length < 3) return [];
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const nxt = pts[(i + 1) % n];
    const sc = side(cur, lp1, lp2);
    const sn = side(nxt, lp1, lp2);
    const curIn = keepSide > 0 ? sc >= -1e-9 : sc <= 1e-9;
    const nxtIn = keepSide > 0 ? sn >= -1e-9 : sn <= 1e-9;
    if (curIn) out.push([cur[0], cur[1]]);
    if ((curIn && !nxtIn) || (!curIn && nxtIn)) {
      const inter = lineLineIntersect(cur, nxt, lp1, lp2);
      if (inter) out.push(inter);
    }
  }
  return out.length >= 3 ? out : [];
}

/** Intersección de dos segmentos (infinitos) */
function lineLineIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const dx1 = b[0] - a[0], dy1 = b[1] - a[1];
  const dx2 = d[0] - c[0], dy2 = d[1] - c[1];
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((c[0] - a[0]) * dy2 - (c[1] - a[1]) * dx2) / denom;
  return [a[0] + t * dx1, a[1] + t * dy1];
}

/** Test SAT de superposición entre dos polígonos convexos */
function polysOverlap(a: Pt[], b: Pt[]): boolean {
  for (const poly of [a, b]) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % n];
      const nx = -(p2[1] - p1[1]), ny = p2[0] - p1[0];
      let minA = Infinity, maxA = -Infinity;
      let minB = Infinity, maxB = -Infinity;
      for (const pt of a) {
        const d = pt[0] * nx + pt[1] * ny;
        if (d < minA) minA = d;
        if (d > maxA) maxA = d;
      }
      for (const pt of b) {
        const d = pt[0] * nx + pt[1] * ny;
        if (d < minB) minB = d;
        if (d > maxB) maxB = d;
      }
      if (maxA < minB - 1e-9 || maxB < minA - 1e-9) return false;
    }
  }
  return true;
}

/** Área aproximada de superposición entre dos polígonos (clip del primero contra el segundo) */
function approxOverlapArea(polyA: Pt[], polyB: Pt[]): number {
  let clipped = polyA.map((p) => [p[0], p[1]]) as Pt[];
  const n = polyB.length;
  for (let i = 0; i < n; i++) {
    if (clipped.length < 3) break;
    const a = polyB[i], b = polyB[(i + 1) % n];
    const cenB = centroid(polyB);
    const s = side(cenB, a, b);
    clipped = clipHalfPlane(clipped, a, b, s >= 0 ? +1 : -1);
  }
  if (!clipped || clipped.length < 3) return 0;
  return polyArea(clipped);
}

/** Punto-en-polígono (ray casting) — exportado para subdivisionAlgorithms.ts */
export function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

export function buildCutPolys(
  wp: Pt[],
  hA: { segIdx: number; u: number; pt: Pt },
  hB: { segIdx: number; u: number; pt: Pt },
): { poly1: Pt[]; poly2: Pt[]; cutA: Pt; cutB: Pt } | null {
  const n = wp.length;
  const ins: Record<number, { u: number; pt: Pt; role: string }[]> = {};

  function addIns(si: number, u: number, pt: Pt, role: string) {
    if (!ins[si]) ins[si] = [];
    ins[si].push({ u, pt: [pt[0], pt[1]], role });
  }

  addIns(hA.segIdx, Math.max(0, Math.min(1, hA.u)), hA.pt, 'A');
  addIns(hB.segIdx, Math.max(0, Math.min(1, hB.u)), hB.pt, 'B');

  for (const k of Object.keys(ins)) {
    ins[Number(k)].sort((a, b) => a.u - b.u);
  }

  const verts: { pt: Pt; role: string }[] = [];
  for (let i = 0; i < n; i++) {
    verts.push({ pt: [wp[i][0], wp[i][1]], role: 'orig' });
    if (ins[i]) {
      for (const x of ins[i]) verts.push({ pt: x.pt, role: x.role });
    }
  }

  let idxA = -1, idxB = -1;
  for (let i = 0; i < verts.length; i++) {
    if (verts[i].role === 'A') idxA = i;
    if (verts[i].role === 'B') idxB = i;
  }
  if (idxA < 0 || idxB < 0) return null;

  const lv = verts.length;
  const p1: Pt[] = [];
  let i = idxA, st = 0;
  do {
    p1.push(verts[i].pt);
    i = (i + 1) % lv;
    st++;
  } while (i !== idxB && st <= lv + 2);
  p1.push(verts[idxB].pt);

  const p2: Pt[] = [];
  i = idxB; st = 0;
  do {
    p2.push(verts[i].pt);
    i = (i + 1) % lv;
    st++;
  } while (i !== idxA && st <= lv + 2);
  p2.push(verts[idxA].pt);

  if (p1.length < 3 || p2.length < 3) return null;

  return {
    poly1: p1,
    poly2: p2,
    cutA: [hA.pt[0], hA.pt[1]] as Pt,
    cutB: [hB.pt[0], hB.pt[1]] as Pt,
  };
}

// ─── Operaciones sobre strips ───────────────────────────────────────

/** Clip de polígono a una franja entre minT y maxT a lo largo del eje (ax, ay) */
export function clipToStrip(pts: Pt[], ax: number, ay: number, minT: number, maxT: number): Pt[] {
  if (pts.length < 3) return [];
  const nx = -ay, ny = ax;
  // Límite inferior
  const minPt: Pt = [minT * ax, minT * ay];
  const p1: Pt = [minPt[0] + nx, minPt[1] + ny];
  const p2: Pt = [minPt[0] - nx, minPt[1] - ny];
  const testMin: Pt = [(minT + 1) * ax, (minT + 1) * ay];
  const sMin = side(testMin, p1, p2);
  let clipped = clipHalfPlane(pts, p1, p2, sMin >= 0 ? +1 : -1);
  if (clipped.length < 3) return [];
  // Límite superior
  const maxPt: Pt = [maxT * ax, maxT * ay];
  const p3: Pt = [maxPt[0] + nx, maxPt[1] + ny];
  const p4: Pt = [maxPt[0] - nx, maxPt[1] - ny];
  const testMax: Pt = [(maxT - 1) * ax, (maxT - 1) * ay];
  const sMax = side(testMax, p3, p4);
  clipped = clipHalfPlane(clipped, p3, p4, sMax >= 0 ? +1 : -1);
  return clipped;
}

// ─── Eje principal (PCA) ────────────────────────────────────────────

/** Eje principal del polígono vía análisis de componentes principales */
export function principalAxis(pts: Pt[]): { ux: number; uy: number } {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;

  let cxx = 0, cxy = 0, cyy = 0;
  for (const p of pts) {
    const dx = p[0] - mx, dy = p[1] - my;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }

  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const l1 = trace / 2 + disc;

  let ex: number, ey: number;
  if (Math.abs(cxy) > 1e-10) {
    ex = l1 - cyy;
    ey = cxy;
  } else {
    ex = cxx >= cyy ? 1 : 0;
    ey = cxx >= cyy ? 0 : 1;
  }

  const len = Math.sqrt(ex * ex + ey * ey) || 1;
  let ux = ex / len, uy = ey / len;
  if (ux < 0 || (Math.abs(ux) < 1e-9 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }

  return { ux, uy };
}

/** Proyecta los vértices sobre el eje (ax, ay) y retorna [min, max] */
export function projectExtents(pts: Pt[], ax: number, ay: number): { min: number; max: number } {
  let mn = Infinity, mx = -Infinity;
  for (const p of pts) {
    const t = p[0] * ax + p[1] * ay;
    if (t < mn) mn = t;
    if (t > mx) mx = t;
  }
  return { min: mn, max: mx };
}

// ─── Intersección de calles vs polígonos ─────────────────────────────

interface StreetRectData {
  start: Pt;
  end: Pt;
  widthM: number;
}

/** Construye el rectángulo de una calle (4 vértices) */
function streetRect(street: StreetRectData): Pt[] | null {
  const { start: S, end: E, widthM: W } = street;
  const dx = E[0] - S[0], dy = E[1] - S[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return null;
  const nx = -dy / len, ny = dx / len;
  const hw = W / 2;
  return [
    [S[0] + nx * hw, S[1] + ny * hw],
    [E[0] + nx * hw, E[1] + ny * hw],
    [E[0] - nx * hw, E[1] - ny * hw],
    [S[0] - nx * hw, S[1] - ny * hw],
  ];
}

function applyStreetToPolys(polysIn: Pt[][], street: StreetRectData): Pt[][] {
  const rect = streetRect(street);
  if (!rect) return polysIn;
  const { start: S, end: E, widthM: W } = street;
  const dx = E[0] - S[0], dy = E[1] - S[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return polysIn;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const hw = W / 2;

  const L1a: Pt = [S[0] + nx * hw, S[1] + ny * hw];
  const L1b: Pt = [E[0] + nx * hw, E[1] + ny * hw];
  const L2a: Pt = [S[0] - nx * hw, S[1] - ny * hw];
  const L2b: Pt = [E[0] - nx * hw, E[1] - ny * hw];
  const C1a: Pt = [S[0] + nx, S[1] + ny];
  const C1b: Pt = [S[0] - nx, S[1] - ny];
  const sideE_C1 = side(E, C1a, C1b);
  const outsideC1 = sideE_C1 > 0 ? -1 : +1;
  const C2a: Pt = [E[0] + nx, E[1] + ny];
  const C2b: Pt = [E[0] - nx, E[1] - ny];
  const sideS_C2 = side(S, C2a, C2b);
  const outsideC2 = sideS_C2 > 0 ? -1 : +1;

  const MIN_AREA = 0.5;
  const result: Pt[][] = [];

  for (const poly of polysIn) {
    if (!polysOverlap(poly, rect)) {
      result.push(poly);
      continue;
    }
    const frags: Pt[][] = [];
    const lf = clipHalfPlane(poly, L1a, L1b, +1);
    if (lf.length >= 3 && polyArea(lf) > MIN_AREA) frags.push(lf);
    const rf = clipHalfPlane(poly, L2a, L2b, -1);
    if (rf.length >= 3 && polyArea(rf) > MIN_AREA) frags.push(rf);
    let sf = clipHalfPlane(poly, C1a, C1b, outsideC1);
    sf = clipHalfPlane(sf, L1a, L1b, -1);
    sf = clipHalfPlane(sf, L2a, L2b, +1);
    if (sf.length >= 3 && polyArea(sf) > MIN_AREA) frags.push(sf);
    let ef = clipHalfPlane(poly, C2a, C2b, outsideC2);
    ef = clipHalfPlane(ef, L1a, L1b, -1);
    ef = clipHalfPlane(ef, L2a, L2b, +1);
    if (ef.length >= 3 && polyArea(ef) > MIN_AREA) frags.push(ef);
    if (frags.length === 0) continue;
    for (const f of frags) result.push(f);
  }
  return result;
}

export function clipPolygonByAllStreets(
  poly: Pt[],
  streetData: Array<{ start: Pt; end: Pt; widthM: number }>,
): Pt[][] {
  let current: Pt[][] = [poly];
  for (const sd of streetData) {
    // Si ya es un solo poly y es el original, pasar ref directa
    const next = applyStreetToPolys(current, sd);
    if (next.length === 0) return [];
    current = next;
  }
  return current;
}
