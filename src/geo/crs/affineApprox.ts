// src/geo/crs/affineApprox.ts
import { transform } from 'ol/proj.js';
import type { Extent } from 'ol/extent.js';
import { DISPLAY_PROJECTION } from './projections';

/**
 * Transformación afín 2D:
 *   X = a*x + b*y + c
 *   Y = d*x + e*y + f
 */
export interface AffineTransform {
  a: number; b: number; c: number;
  d: number; e: number; f: number;
}

export const IDENTITY_AFFINE: AffineTransform = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };

export function applyAffine(pt: readonly [number, number], t: AffineTransform): [number, number] {
  return [t.a * pt[0] + t.b * pt[1] + t.c, t.d * pt[0] + t.e * pt[1] + t.f];
}

export function applyAffineBatch(
  pts: ReadonlyArray<readonly [number, number]>,
  t: AffineTransform,
): [number, number][] {
  const out = new Array<[number, number]>(pts.length);
  for (let i = 0; i < pts.length; i++) out[i] = applyAffine(pts[i], t);
  return out;
}

export function extentOfPoints(pts: ReadonlyArray<readonly [number, number]>): Extent {
  if (pts.length === 0) return [0, 0, 0, 0];
  let minX = pts[0][0], minY = pts[0][1], maxX = pts[0][0], maxY = pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/** Eliminación gaussiana 3x3 con pivoteo parcial. Devuelve null si el sistema es singular. */
function solve3x3(A: number[][], bVec: number[]): number[] | null {
  const M = A.map((row, i) => [...row, bVec[i]]);
  const n = 3;
  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r][col]);
      if (v > maxAbs) { maxAbs = v; pivotRow = r; }
    }
    if (maxAbs < 1e-12) return null;
    if (pivotRow !== col) { const tmp = M[col]; M[col] = M[pivotRow]; M[pivotRow] = tmp; }
    const pivot = M[col][col];
    for (let c2 = col; c2 <= n; c2++) M[col][c2] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c2 = col; c2 <= n; c2++) M[r][c2] -= factor * M[col][c2];
    }
  }
  return [M[0][3], M[1][3], M[2][3]];
}

/**
 * Ajusta por mínimos cuadrados una afín 2D que mapea `src` -> `dst`
 * (mismos índices, mínimo 3 puntos no colineales). X e Y se resuelven
 * como dos regresiones lineales independientes sobre la misma matriz
 * normal (mismos x,y de entrada) — mismo método que usan las
 * herramientas de georreferenciación (world-file affine fit).
 */
export function fitAffineLeastSquares(
  src: ReadonlyArray<readonly [number, number]>,
  dst: ReadonlyArray<readonly [number, number]>,
): AffineTransform | null {
  const n = src.length;
  if (n < 3 || dst.length !== n) return null;

  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0;
  let sxX = 0, syX = 0, sX = 0;
  let sxY = 0, syY = 0, sY = 0;

  for (let i = 0; i < n; i++) {
    const [x, y] = src[i];
    const [X, Y] = dst[i];
    sxx += x * x; sxy += x * y; sx += x;
    syy += y * y; sy += y;
    sxX += x * X; syX += y * X; sX += X;
    sxY += x * Y; syY += y * Y; sY += Y;
  }

  const Normal = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];

  const solX = solve3x3(Normal, [sxX, syX, sX]);
  const solY = solve3x3(Normal, [sxY, syY, sY]);
  if (!solX || !solY) return null;

  return {
    a: solX[0], b: solX[1], c: solX[2],
    d: solY[0], e: solY[1], f: solY[2],
  };
}

/** Máximo residuo (en unidades de destino, típicamente metros) entre el afín y las muestras exactas. */
export function maxResidual(
  t: AffineTransform,
  src: ReadonlyArray<readonly [number, number]>,
  dst: ReadonlyArray<readonly [number, number]>,
): number {
  let maxErr = 0;
  for (let i = 0; i < src.length; i++) {
    const approx = applyAffine(src[i], t);
    const err = Math.hypot(approx[0] - dst[i][0], approx[1] - dst[i][1]);
    if (err > maxErr) maxErr = err;
  }
  return maxErr;
}

function sampleGrid(extent: Extent, n = 5): [number, number][] {
  const [minX, minY, maxX, maxY] = extent;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const tx = n === 1 ? 0.5 : i / (n - 1);
    const x = minX + tx * (maxX - minX);
    for (let j = 0; j < n; j++) {
      const ty = n === 1 ? 0.5 : j / (n - 1);
      const y = minY + ty * (maxY - minY);
      pts.push([x, y]);
    }
  }
  return pts;
}

export interface AffineFitResult {
  transform: AffineTransform;
  maxErrorM: number;
  extent: Extent;
}

/**
 * Ajusta la matriz afín 2×2 + offset que aproxima EPSG:3857 → `dstEpsg`
 * (vía proj4) dentro de `extent3857`. Muestrea una grilla `gridSize x
 * gridSize` (default 25 puntos) y hace fit por mínimos cuadrados — reparte
 * el error de forma más pareja que interpolar solo las 4 esquinas.
 * Costo: `gridSize^2` llamadas a proj4 — se paga solo al (re)ajustar, no
 * por vértice (ver affineCache.ts).
 */
export function fitAffineForExtent(
  extent3857: Extent,
  dstEpsg: string,
  gridSize = 5,
): AffineFitResult | null {
  const src = sampleGrid(extent3857, gridSize);
  const dst = src.map((p) => transform(p, DISPLAY_PROJECTION, dstEpsg) as [number, number]);
  const fit = fitAffineLeastSquares(src, dst);
  if (!fit) return null;
  const maxErrorM = maxResidual(fit, src, dst);
  return { transform: fit, maxErrorM, extent: extent3857 };
}