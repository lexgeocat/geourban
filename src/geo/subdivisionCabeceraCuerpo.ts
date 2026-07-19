// src/geo/subdivisionCabeceraCuerpo.ts
//
// Método "Cabecera + Cuerpo": 1 fila de lotes angostos en cada extremo del
// manzano (junto a las esquinas) + un cuerpo central a doble frente (2
// columnas). Portado de index_modelo.html (motor hbLotize*), adaptado al
// formato Pt = [number, number] de polygonEngine.ts en vez de {x,y}.
//
// A diferencia del modelo, acá SIEMPRE se opera sobre el contorno real del
// manzano (con sus ochaves ya aplicados por recomputeManzanos), así que se
// eliminó la rama "sin fillet" del motor original (dead code en nuestro caso).

import { type Pt, type LotResult, polyArea, centroid } from './polygonEngine';

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

function bisect(fn: (x: number) => number, lo: number, hi: number, target: number, iters = 60): number {
  let a = lo, b = hi;
  for (let i = 0; i < iters; i++) {
    const m = (a + b) / 2;
    if (fn(m) < target) a = m; else b = m;
  }
  return (a + b) / 2;
}

// ─── Envolvente cuadrilátera del manzano (para orientar cabecera/cuerpo) ──

function convexHull(pts: Pt[]): Pt[] {
  const arr = pts.slice().sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
  if (arr.length < 3) return arr;
  const cross = (O: Pt, A: Pt, B: Pt) => (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const p of arr) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = arr.length - 1; i >= 0; i--) {
    const p = arr[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function minAreaBoundingQuad(pts: Pt[]): Pt[] {
  const hull = convexHull(pts);
  if (hull.length < 3) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
  }
  let best: { area: number; minX: number; maxX: number; minY: number; maxY: number; ang: number } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const cs = Math.cos(-ang), sn = Math.sin(-ang);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of hull) {
      const rx = p[0] * cs - p[1] * sn, ry = p[0] * sn + p[1] * cs;
      if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (!best || area < best.area) best = { area, minX, maxX, minY, maxY, ang };
  }
  const cs = Math.cos(best!.ang), sn = Math.sin(best!.ang);
  const corners: Pt[] = [[best!.minX, best!.minY], [best!.maxX, best!.minY], [best!.maxX, best!.maxY], [best!.minX, best!.maxY]];
  return corners.map(([rx, ry]) => [rx * cs - ry * sn, rx * sn + ry * cs] as Pt);
}

// Reduce el contorno real (con ochave tesselado) a sus 4 esquinas "vivas",
// para poder orientar la cabecera/cuerpo según el rectángulo real del
// manzano en vez de su envolvente. Si no da un cuadrilátero limpio, cae al
// rectángulo de área mínima.
function unfilletManzano(ringIn: Pt[]): Pt[] {
  let pts = ringIn.slice();
  if (pts.length > 1) {
    const f = pts[0], l = pts[pts.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) pts.pop();
  }
  const m = pts.length;
  if (m < 3) return pts;

  const edir: Pt[] = [], elen: number[] = [];
  for (let k = 0; k < m; k++) {
    const a = pts[k], b = pts[(k + 1) % m];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy);
    elen.push(L);
    edir.push(L > 1e-9 ? [dx / L, dy / L] : [0, 0]);
  }
  const ANG = (4 * Math.PI) / 180;
  const isBreak: boolean[] = [];
  for (let k = 0; k < m; k++) {
    const p = edir[(k - 1 + m) % m], c = edir[k];
    const d = Math.max(-1, Math.min(1, p[0] * c[0] + p[1] * c[1]));
    isBreak[k] = Math.acos(d) > ANG;
  }
  const starts: number[] = [];
  for (let k = 0; k < m; k++) if (isBreak[k]) starts.push(k);
  if (starts.length < 2) return pts;

  const runs: { s: Pt; e: Pt; len: number; dir: Pt }[] = [];
  const R = starts.length;
  for (let s = 0; s < R; s++) {
    const a = starts[s], b = starts[(s + 1) % R];
    let L = 0, kk = a;
    while (true) {
      L += elen[kk];
      const nk = (kk + 1) % m;
      if (nk === b) break;
      kk = nk;
    }
    const sp = pts[a], ep = pts[b];
    const dx = ep[0] - sp[0], dy = ep[1] - sp[1], dl = Math.hypot(dx, dy) || 1;
    runs.push({ s: [sp[0], sp[1]], e: [ep[0], ep[1]], len: L, dir: [dx / dl, dy / dl] });
  }

  // Heurística: descarta las corridas cortas (cuerdas de un ochave tesselado)
  // para quedarse solo con los 4 lados "reales" del manzano.
  const MAX_FILLET_R = 8;
  const arcChord = 2 * MAX_FILLET_R * Math.sin(0.18 / 2);
  const LMIN = Math.max(1.0, arcChord * 1.6);
  const major = runs.filter((r) => r.len >= LMIN);
  if (major.length < 3) return pts;

  function lineLine(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9) return null;
    const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
    return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
  }

  const V: Pt[] = [];
  const P = major.length;
  for (let j = 0; j < P; j++) {
    const prev = major[(j - 1 + P) % P], cur = major[j];
    let ip = lineLine(prev.s, prev.dir, cur.s, cur.dir);
    const far = ip && (dist(ip, prev.e) > prev.len * 4 + 60 || dist(ip, cur.s) > cur.len * 4 + 60);
    if (!ip || far) ip = [(prev.e[0] + cur.s[0]) / 2, (prev.e[1] + cur.s[1]) / 2];
    V.push(ip);
  }
  return V;
}

function mznQuadApprox(mznPts: Pt[]): Pt[] {
  let V: Pt[] | null = null;
  try { V = unfilletManzano(mznPts); } catch { V = null; }
  if (V && V.length === 4) return V;
  return minAreaBoundingQuad(mznPts);
}

function orderQuadLong(pts: Pt[]): [Pt, Pt, Pt, Pt] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
  const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  const sorted = [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  const lenA = (dist(sorted[0], sorted[1]) + dist(sorted[2], sorted[3])) / 2;
  const lenB = (dist(sorted[1], sorted[2]) + dist(sorted[3], sorted[0])) / 2;
  return lenA <= lenB
    ? [sorted[0], sorted[1], sorted[2], sorted[3]]
    : [sorted[1], sorted[2], sorted[3], sorted[0]];
}

// ─── Primitivas de recorte sobre el contorno real ──────────────────────

function hbCleanPoly(pts: Pt[]): Pt[] {
  let p = pts;
  let changed = true;
  while (changed && p.length > 3) {
    changed = false;
    for (let i = 0; i < p.length; i++) {
      const n = p.length;
      const b = p[i], a = p[(i - 1 + n) % n], c = p[(i + 1) % n];
      const d1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const d2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (d1 < 1e-7 || d2 < 1e-7) { p = p.slice(0, i).concat(p.slice(i + 1)); changed = true; break; }
      const ux1 = (b[0] - a[0]) / d1, uy1 = (b[1] - a[1]) / d1;
      const ux2 = (c[0] - b[0]) / d2, uy2 = (c[1] - b[1]) / d2;
      const dot = ux1 * ux2 + uy1 * uy2;
      const cross = ux1 * uy2 - uy1 * ux2;
      if (dot < -0.999 || (dot > 0.99999 && Math.abs(cross) < 1e-5)) {
        p = p.slice(0, i).concat(p.slice(i + 1)); changed = true; break;
      }
    }
  }
  return p;
}

function hbClipPolyHalf(poly: Pt[], nx: number, ny: number, sign: number, d: number): Pt[] {
  if (!poly.length) return [];
  const inside = (p: Pt) => sign * (p[0] * nx + p[1] * ny) >= d - 1e-10;
  const result: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], nxt = poly[(i + 1) % poly.length];
    const cIn = inside(cur), nIn = inside(nxt);
    if (cIn) result.push(cur);
    if (cIn !== nIn) {
      const dc = sign * (cur[0] * nx + cur[1] * ny) - d;
      const dn = sign * (nxt[0] * nx + nxt[1] * ny) - d;
      const t = dc / (dc - dn);
      result.push([cur[0] + t * (nxt[0] - cur[0]), cur[1] + t * (nxt[1] - cur[1])]);
    }
  }
  return hbCleanPoly(result);
}

function hbStripArea(poly: Pt[], ux: number, uy: number, t0: number, t1: number): number {
  let p = hbClipPolyHalf(poly, ux, uy, 1, t0);
  p = hbClipPolyHalf(p, ux, uy, -1, -t1);
  return p.length >= 3 ? polyArea(p) : 0;
}

function hbPolySliceAtU(pts: Pt[], ux: number, uy: number, t: number): Pt[] {
  const n = pts.length;
  const hits: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const ua = a[0] * ux + a[1] * uy, ub = b[0] * ux + b[1] * uy;
    if (Math.abs(ub - ua) < 1e-12) continue;
    if (!((ua <= t && ub >= t) || (ub <= t && ua >= t))) continue;
    const frac = (t - ua) / (ub - ua);
    hits.push([a[0] + frac * (b[0] - a[0]), a[1] + frac * (b[1] - a[1])]);
  }
  const uniq: Pt[] = [];
  for (const p of hits) if (!uniq.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-8)) uniq.push(p);
  return uniq;
}

function hbPolySliceAtUClamped(
  poly: Pt[], ux: number, uy: number, t: number, vx: number, vy: number, uMin: number, uMax: number,
): Pt[] {
  const EPS = 1e-6;
  const atEdge = Math.abs(t - uMin) < EPS || Math.abs(t - uMax) < EPS;
  if (atEdge) {
    const side = Math.abs(t - uMin) < EPS ? 'min' : 'max';
    const tol = (uMax - uMin) * 0.02 + EPS;
    const candidates = poly.filter((p) => {
      const u = p[0] * ux + p[1] * uy;
      return side === 'min' ? u <= uMin + tol : u >= uMax - tol;
    });
    if (candidates.length >= 2) {
      const sorted = [...candidates].sort((a, b) => a[0] * vx + a[1] * vy - (b[0] * vx + b[1] * vy));
      return [sorted[0], sorted[sorted.length - 1]];
    }
    if (candidates.length === 1) return [candidates[0], candidates[0]];
  }
  const raw = hbPolySliceAtU(poly, ux, uy, t);
  return [...raw].sort((a, b) => a[0] * vx + a[1] * vy - (b[0] * vx + b[1] * vy));
}

// ─── Reparto de columnas/filas (cabecera vs cuerpo) ────────────────────

interface HbConfig {
  bodyCols: number;
  bodyRows: number;
  headRows: number;
  minArea: number;
  headDepth: number;
  minFrente: number;
}

function hbGetCfg(blockArea: number, targetAreaM2: number, frontMinM: number): HbConfig {
  const minArea = Math.max(0, targetAreaM2 || 0);
  const minFrente = Math.max(0, frontMinM || 0);
  const headDepth = minFrente > 0 ? Math.max(5, minArea / minFrente) : 20;
  const bodyCols = 2;
  if (minArea > 0 && blockArea > 0) {
    const headRows = 1;
    const headArea = 2 * headRows * 2 * minArea;
    const bodyArea = Math.max(0, blockArea - headArea);
    const bodyLots = Math.max(1, Math.floor(bodyArea / minArea));
    const bodyRows = Math.max(1, Math.round(bodyLots / bodyCols));
    return { bodyCols, bodyRows, headRows, minArea, headDepth, minFrente };
  }
  return { bodyCols, bodyRows: 6, headRows: 1, headDepth, minArea: 0, minFrente };
}

function hbAutoHeadPlan(
  totalArea: number, uMin: number, uMax: number, widthAtU: (u: number) => number,
  headRows: number, bodyRows: number, bodyCols: number, minArea: number, targetDepth: number,
) {
  const D = targetDepth > 0 ? targetDepth : 20;
  if (headRows <= 0) {
    return { headCols1: 0, headCols2: 0, targetLotArea: minArea > 0 ? minArea : (bodyRows * bodyCols > 0 ? totalArea / (bodyRows * bodyCols) : 0) };
  }
  const measure = (area: number) => {
    const frontage = Math.max(1e-6, area / D);
    const depth = headRows * D;
    const uA = Math.min(uMax, uMin + depth);
    const uB = Math.max(uMin, uMax - depth);
    const w1 = Math.max(1e-6, widthAtU((uMin + uA) / 2));
    const w2 = Math.max(1e-6, widthAtU((uMax + uB) / 2));
    return { c1: Math.max(1, Math.round(w1 / frontage)), c2: Math.max(1, Math.round(w2 / frontage)) };
  };
  let target = minArea > 0 ? minArea : totalArea / (bodyRows * bodyCols + 2 * headRows * 2);
  let c1 = 1, c2 = 1;
  const iters = minArea > 0 ? 1 : 5;
  for (let it = 0; it < iters; it++) {
    const m = measure(target); c1 = m.c1; c2 = m.c2;
    if (minArea > 0) break;
    const tl = bodyRows * bodyCols + headRows * (c1 + c2);
    target = tl > 0 ? totalArea / tl : target;
  }
  return { headCols1: c1, headCols2: c2, targetLotArea: target };
}

function hbFitBodyRows(
  totalArea: number, target: number, headRows: number, headCols1: number, headCols2: number,
  bodyCols: number, bodyRows: number, useFixedArea: boolean,
): number {
  if (!useFixedArea || headRows <= 0 || target <= 0) return bodyRows;
  const headL = headRows * (headCols1 + headCols2);
  const cap = Math.round((totalArea / target - headL) / bodyCols);
  return Math.max(1, cap);
}

// ─── Motor principal: lotiza a lo largo de un eje "baseline" (u = fondo,
// v = frente), con cabecera en ambas puntas y cuerpo a doble frente ──────

interface HbLot { pts: Pt[]; area: number; zone: string; isRemainder: boolean; }

function hbLotizeWithBaseline(mznPts: Pt[], cfg: HbConfig, baseline: [Pt, Pt]): HbLot[] {
  const { bodyCols, bodyRows, headRows, minArea, headDepth, minFrente } = cfg;
  const lots: HbLot[] = [];
  const workPoly = mznPts;

  const dxB = baseline[1][0] - baseline[0][0];
  const dyB = baseline[1][1] - baseline[0][1];
  const lenB = Math.hypot(dxB, dyB);
  if (lenB < 1e-9) return [];

  const vx = dxB / lenB, vy = dyB / lenB;
  const ux = -vy, uy = vx;

  const uProjs = workPoly.map((p) => p[0] * ux + p[1] * uy);
  const uMin = Math.min(...uProjs), uMax = Math.max(...uProjs);
  if (uMax - uMin < 1e-9) return [];

  const totalArea = hbStripArea(workPoly, ux, uy, uMin, uMax);
  if (totalArea <= 0) return [];
  const useFixedArea = minArea > 0;
  const areaUpTo = (uCut: number) => hbStripArea(workPoly, ux, uy, uMin, uCut);

  const widthAtU = (uu: number) => {
    const pts = hbPolySliceAtU(workPoly, ux, uy, uu);
    if (pts.length < 2) return 0;
    const vs = pts.map((p) => p[0] * vx + p[1] * vy);
    return Math.max(...vs) - Math.min(...vs);
  };
  const plan = hbAutoHeadPlan(totalArea, uMin, uMax, widthAtU, headRows, bodyRows, bodyCols, minArea, headDepth);
  const { headCols1, headCols2, targetLotArea } = plan;
  const bRows = hbFitBodyRows(totalArea, targetLotArea, headRows, headCols1, headCols2, bodyCols, bodyRows, useFixedArea);

  let uH1: number, uH2: number;
  if (headRows <= 0) { uH1 = uMin; uH2 = uMax; }
  else {
    const headArea1 = headRows * headCols1 * targetLotArea;
    const bodyArea = bRows * bodyCols * targetLotArea;
    uH1 = bisect(areaUpTo, uMin, uMax, headArea1);
    uH2 = Math.min(uMax, Math.max(uH1, bisect(areaUpTo, uH1, uMax, headArea1 + bodyArea)));
  }

  function buildZone(uA: number, uB: number, nRows: number, nCols: number, zone: string, remainderLot: boolean) {
    if (nRows <= 0 || nCols <= 0) return;
    let zonePoly = hbClipPolyHalf(workPoly, ux, uy, 1, uA);
    zonePoly = hbClipPolyHalf(zonePoly, ux, uy, -1, -uB);
    if (zonePoly.length < 3) return;
    const zoneTotal = polyArea(zonePoly);

    const uKey = (p: Pt) => p[0] * ux + p[1] * uy;
    const vKey = (p: Pt) => p[0] * vx + p[1] * vy;
    const EPSU = (uMax - uMin) * 1e-6 + 1e-9;
    const onA = zonePoly.filter((p) => Math.abs(uKey(p) - uA) < EPSU);
    const onB = zonePoly.filter((p) => Math.abs(uKey(p) - uB) < EPSU);
    const minV = (arr: Pt[]) => arr.reduce((a, b) => (vKey(b) < vKey(a) ? b : a));
    const maxV = (arr: Pt[]) => arr.reduce((a, b) => (vKey(b) > vKey(a) ? b : a));
    const skewOk = onA.length >= 2 && onB.length >= 2;
    const topLo = skewOk ? minV(onA) : null, topHi = skewOk ? maxV(onA) : null;
    const botLo = skewOk ? minV(onB) : null, botHi = skewOk ? maxV(onB) : null;

    const vMinZ = Math.min(...zonePoly.map(vKey)), vMaxZ = Math.max(...zonePoly.map(vKey));
    const vSpanZ = vMaxZ - vMinZ;

    // Divisor de columna: si ambos bordes (uA/uB) matchean con >=2 vértices,
    // sigue el sesgo real del manzano (esquinas no perpendiculares al eje);
    // si no, cae a un corte paralelo a "v".
    const dividerAt = (f: number): { nx: number; ny: number; d: number } => {
      if (!skewOk) return { nx: vx, ny: vy, d: vMinZ + f * vSpanZ };
      const pt = lerp(topLo!, topHi!, f), pb = lerp(botLo!, botHi!, f);
      let dx = pb[0] - pt[0], dy = pb[1] - pt[1];
      const len = Math.hypot(dx, dy);
      let nx: number, ny: number;
      if (len < 1e-9) { nx = vx; ny = vy; } else { nx = dy / len; ny = -dx / len; }
      if (nx * vx + ny * vy < 0) { nx = -nx; ny = -ny; }
      return { nx, ny, d: nx * pt[0] + ny * pt[1] };
    };

    const colAreaUpToF = (f: number) => {
      if (f <= 1e-12) return 0;
      if (f >= 1) return zoneTotal;
      const L = dividerAt(f);
      const sub = hbClipPolyHalf(zonePoly, L.nx, L.ny, -1, -L.d);
      return sub.length >= 3 ? polyArea(sub) : 0;
    };

    let eqSplit = false;
    if (remainderLot && nCols === 2 && targetLotArea > 0) {
      const fullCol = nRows * targetLotArea;
      const remA = zoneTotal - fullCol;
      if (remA < fullCol) {
        lots.push({ pts: zonePoly, area: zoneTotal, zone, isRemainder: true });
        return;
      }
      eqSplit = true;
    }

    const fCuts = [0];
    if (remainderLot && !eqSplit) {
      const fullCol = nRows * targetLotArea;
      for (let c = 0; c < nCols - 1; c++) fCuts.push(bisect(colAreaUpToF, 0, 1, (c + 1) * fullCol));
    } else {
      const colTarget = zoneTotal / nCols;
      for (let c = 0; c < nCols - 1; c++) fCuts.push(bisect(colAreaUpToF, 0, 1, (c + 1) * colTarget));
    }
    fCuts.push(1);

    for (let c = 0; c < nCols; c++) {
      const L0 = dividerAt(fCuts[c]), L1 = dividerAt(fCuts[c + 1]);
      let colPoly = zonePoly;
      if (fCuts[c] > 1e-9) colPoly = hbClipPolyHalf(colPoly, L0.nx, L0.ny, 1, L0.d);
      if (fCuts[c + 1] < 1 - 1e-9) colPoly = hbClipPolyHalf(colPoly, L1.nx, L1.ny, -1, -L1.d);
      if (colPoly.length < 3) continue;
      const colArea = polyArea(colPoly);
      const isRemCol = remainderLot && !eqSplit && nCols > 1 && c === nCols - 1;
      const cellTarget = isRemCol ? targetLotArea : colArea / nRows;

      const uProjsCol = colPoly.map(uKey);
      const uMinC = Math.min(...uProjsCol), uMaxC = Math.max(...uProjsCol);
      const rowAreaUpTo = (uCut: number) => {
        let sub = hbClipPolyHalf(colPoly, ux, uy, 1, uMinC);
        sub = hbClipPolyHalf(sub, ux, uy, -1, -uCut);
        return sub.length >= 3 ? polyArea(sub) : 0;
      };
      const rowCuts = [uMinC];
      for (let r = 0; r < nRows - 1; r++) rowCuts.push(bisect(rowAreaUpTo, uMinC, uMaxC, (r + 1) * cellTarget));
      rowCuts.push(uMaxC);

      for (let r = 0; r < nRows; r++) {
        let lot = hbClipPolyHalf(colPoly, ux, uy, 1, rowCuts[r]);
        lot = hbClipPolyHalf(lot, ux, uy, -1, -rowCuts[r + 1]);
        if (lot.length < 3) continue;
        lots.push({ pts: lot, area: polyArea(lot), zone, isRemainder: isRemCol && r === nRows - 1 });
      }
    }
  }

  function buildBodyZone(uA: number, uB: number, nRows: number, nCols: number) {
    if (nRows <= 0 || nCols <= 0) return;
    const zoneTotal = hbStripArea(workPoly, ux, uy, uA, uB);
    if (zoneTotal <= 0) return;
    const rowTarget = zoneTotal / nRows;
    const rowCuts = [uA];
    for (let r = 0; r < nRows - 1; r++) rowCuts.push(bisect(areaUpTo, uA, uB, areaUpTo(uA) + (r + 1) * rowTarget));
    rowCuts.push(uB);

    for (let r = 0; r < nRows; r++) {
      const ra = rowCuts[r], rb = rowCuts[r + 1];
      let stripPoly = hbClipPolyHalf(workPoly, ux, uy, 1, ra);
      stripPoly = hbClipPolyHalf(stripPoly, ux, uy, -1, -rb);
      if (stripPoly.length < 3) continue;

      const sliceA = hbPolySliceAtUClamped(workPoly, ux, uy, ra, vx, vy, uMin, uMax);
      const sliceB = hbPolySliceAtUClamped(workPoly, ux, uy, rb, vx, vy, uMin, uMax);
      if (sliceA.length < 2 || sliceB.length < 2) continue;

      const QA = sliceA[0], QB = sliceA[sliceA.length - 1];
      const QD = sliceB[0], QC = sliceB[sliceB.length - 1];
      const cutLineAt = (t: number) => {
        const p1 = lerp(QA, QB, t), p2 = lerp(QD, QC, t);
        const dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dx, dy);
        if (len < 1e-9) return { nx: vx, ny: vy, d: p1[0] * vx + p1[1] * vy };
        let nx = -dy / len, ny = dx / len;
        if (nx * vx + ny * vy < 0) { nx = -nx; ny = -ny; }
        return { nx, ny, d: nx * p1[0] + ny * p1[1] };
      };
      const lotAreaAt = (t0: number, t1: number) => {
        const c0 = cutLineAt(t0), c1 = cutLineAt(t1);
        let sub = t0 > 1e-9 ? hbClipPolyHalf(stripPoly, c0.nx, c0.ny, 1, c0.d) : stripPoly;
        sub = t1 < 1 - 1e-9 ? hbClipPolyHalf(sub, c1.nx, c1.ny, -1, -c1.d) : sub;
        return sub.length >= 3 ? polyArea(sub) : 0;
      };
      const rowArea = lotAreaAt(0, 1);

      const rowLenU = Math.abs(rb - ra);
      const localAncho = rowLenU > 1e-9 ? rowArea / rowLenU : 0;
      const forceSingleCol = minFrente > 0 && nCols > 1 && localAncho / nCols <= minFrente;
      const nColsHere = forceSingleCol ? 1 : nCols;

      const colTarget = rowArea / nColsHere;
      const cumT = (t: number) => lotAreaAt(0, t);
      const colCuts = [0];
      for (let c = 0; c < nColsHere - 1; c++) colCuts.push(bisect(cumT, colCuts[c], 1, (c + 1) * colTarget));
      colCuts.push(1);

      for (let c = 0; c < nColsHere; c++) {
        const t0 = colCuts[c], t1 = colCuts[c + 1];
        const c0 = cutLineAt(t0), c1 = cutLineAt(t1);
        let colPoly = t0 > 1e-9 ? hbClipPolyHalf(stripPoly, c0.nx, c0.ny, 1, c0.d) : stripPoly;
        colPoly = t1 < 1 - 1e-9 ? hbClipPolyHalf(colPoly, c1.nx, c1.ny, -1, -c1.d) : colPoly;
        if (colPoly.length < 3) continue;

        if (forceSingleCol && minArea > 0 && targetLotArea > 0) {
          const colArea = polyArea(colPoly);
          const nSubRows = Math.max(1, Math.round(colArea / targetLotArea));
          if (nSubRows > 1) {
            const uProjsCol = colPoly.map((p) => p[0] * ux + p[1] * uy);
            const uMinCol = Math.min(...uProjsCol), uMaxCol = Math.max(...uProjsCol);
            const subRowAreaUpTo = (uCut: number) => {
              let sub = hbClipPolyHalf(colPoly, ux, uy, 1, uMinCol);
              sub = hbClipPolyHalf(sub, ux, uy, -1, -uCut);
              return sub.length >= 3 ? polyArea(sub) : 0;
            };
            const subTarget = colArea / nSubRows;
            const subCuts = [uMinCol];
            for (let sr = 0; sr < nSubRows - 1; sr++) subCuts.push(bisect(subRowAreaUpTo, uMinCol, uMaxCol, (sr + 1) * subTarget));
            subCuts.push(uMaxCol);
            for (let sr = 0; sr < nSubRows; sr++) {
              let subLot = hbClipPolyHalf(colPoly, ux, uy, 1, subCuts[sr]);
              subLot = hbClipPolyHalf(subLot, ux, uy, -1, -subCuts[sr + 1]);
              if (subLot.length < 3) continue;
              lots.push({ pts: subLot, area: polyArea(subLot), zone: 'body', isRemainder: false });
            }
            continue;
          }
        }
        lots.push({ pts: colPoly, area: polyArea(colPoly), zone: 'body', isRemainder: false });
      }
    }
  }

  if (headRows > 0) buildZone(uMin, uH1, headRows, headCols1, 'head1', useFixedArea);
  buildBodyZone(uH1, uH2, bRows, bodyCols);
  if (headRows > 0) buildZone(uH2, uMax, headRows, headCols2, 'head2', useFixedArea);

  return lots;
}

// Fusiona un lote de cabecera "remanente" (área < 80% del objetivo) con su
// vecino de cabecera con mayor borde compartido, para no dejar recortes feos.
function hbMergeHeadRemainders(lots: HbLot[], targetLotArea: number): HbLot[] {
  if (!targetLotArea || targetLotArea <= 0) return lots;
  const THRESHOLD = 0.8;

  function mergePolys(a: Pt[], b: Pt[]): Pt[] {
    const all = [...a, ...b].sort((p, q) => (p[0] !== q[0] ? p[0] - q[0] : p[1] - q[1]));
    const cross = (O: Pt, A: Pt, B: Pt) => (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
    const lower: Pt[] = [], upper: Pt[] = [];
    for (const p of all) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    for (let i = all.length - 1; i >= 0; i--) {
      const p = all[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    upper.pop(); lower.pop();
    return [...lower, ...upper];
  }

  function sharedEdgeLen(a: Pt[], b: Pt[]): number {
    const EPS = 0.5;
    let total = 0;
    for (let i = 0; i < a.length; i++) {
      const a1 = a[i], a2 = a[(i + 1) % a.length];
      for (let j = 0; j < b.length; j++) {
        const b1 = b[j], b2 = b[(j + 1) % b.length];
        const dax = a2[0] - a1[0], day = a2[1] - a1[1];
        const dbx = b2[0] - b1[0], dby = b2[1] - b1[1];
        const lenA = Math.hypot(dax, day), lenB = Math.hypot(dbx, dby);
        if (lenA < 1e-9 || lenB < 1e-9) continue;
        const cross = Math.abs(dax * dby - day * dbx) / (lenA * lenB);
        if (cross > 0.05) continue;
        const cx = b1[0] - a1[0], cy = b1[1] - a1[1];
        if (Math.abs(cx * day - cy * dax) / lenA > EPS) continue;
        const pB1 = (cx * dax + cy * day) / lenA;
        const pB2 = pB1 + (dbx * dax + dby * day) / lenA;
        const lo = Math.max(0, Math.min(pB1, pB2));
        const hi = Math.min(lenA, Math.max(pB1, pB2));
        if (hi > lo + EPS) total += hi - lo;
      }
    }
    return total;
  }

  let result = [...lots];
  let changed = true;
  while (changed) {
    changed = false;
    const remIdx = result.findIndex((l) => l.zone.startsWith('head') && l.area < targetLotArea * THRESHOLD);
    if (remIdx === -1) break;
    const rem = result[remIdx];
    let bestIdx = -1, bestShared = -1;
    for (let i = 0; i < result.length; i++) {
      if (i === remIdx || !result[i].zone.startsWith('head')) continue;
      const shared = sharedEdgeLen(rem.pts, result[i].pts);
      if (shared > bestShared) { bestShared = shared; bestIdx = i; }
    }
    if (bestIdx === -1 || bestShared < 0.1) break;
    const neighbor = result[bestIdx];
    const merged = mergePolys(rem.pts, neighbor.pts);
    const mergedLot: HbLot = { pts: merged, area: polyArea(merged), zone: neighbor.zone, isRemainder: false };
    result = result.filter((_, i) => i !== remIdx && i !== bestIdx);
    result.splice(Math.min(bestIdx, remIdx), 0, mergedLot);
    changed = true;
  }
  return result;
}

// ─── Punto de entrada ───────────────────────────────────────────────────

export function subdivideManzanoCabeceraCuerpo(
  mznPts: Pt[],
  targetAreaM2: number,
  frontMinM: number,
  dirPref?: { ax: number; ay: number },
): LotResult[] {
  if (mznPts.length < 3) return [];
  const blockArea = polyArea(mznPts);
  if (blockArea < targetAreaM2 * 0.15) return [];

  let baseline: [Pt, Pt];
  if (dirPref) {
    const c = centroid(mznPts);
    baseline = [c, [c[0] + dirPref.ax, c[1] + dirPref.ay]];
  } else {
    const quad = mznQuadApprox(mznPts);
    const [A, , , D] = orderQuadLong(quad);
    baseline = [A, D];
  }

  const cfg = hbGetCfg(blockArea, targetAreaM2, frontMinM);
  let raw = hbLotizeWithBaseline(mznPts, cfg, baseline);
  if (cfg.minArea > 0) raw = hbMergeHeadRemainders(raw, cfg.minArea);
  raw = raw.filter((l) => l.area >= 0.5);

  return raw.map((l): LotResult => {
    // frontM/depthM son solo informativos (para etiquetas/exportación);
    // la geometría real es exacta, esto es una aproximación por bbox.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of l.pts) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
    return {
      pts: l.pts,
      isRemnant: l.isRemainder,
      frontM: Math.min(maxX - minX, maxY - minY),
      depthM: Math.max(maxX - minX, maxY - minY),
      areaM2: l.area,
    };
  });
}