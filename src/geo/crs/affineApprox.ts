// src/geo/crs/affineApprox.ts
import { transform } from 'ol/proj.js';
import type { Extent } from 'ol/extent.js';
import { DISPLAY_PROJECTION } from './projections';

export interface QuadCorrection {
  centerX: number;
  centerY: number;
  qxx: number;
  qxy: number;
  qyy: number;
  rxx: number;
  rxy: number;
  ryy: number;
  /** Corrección máxima observada en la grilla de ajuste — informativo. */
  maxCorrectionM: number;
}

export interface AffineTransform {
  a: number; b: number; c: number;
  d: number; e: number; f: number;
  /** undefined ⇒ afín puro (comportamiento idéntico al original). */
  quad?: QuadCorrection;
}

export const IDENTITY_AFFINE: AffineTransform = { a: 1, b: 0, c: 0, d: 0, e: 1, f: 0 };

export function applyAffine(pt: readonly [number, number], t: AffineTransform): [number, number] {
  let X = t.a * pt[0] + t.b * pt[1] + t.c;
  let Y = t.d * pt[0] + t.e * pt[1] + t.f;
  if (t.quad) {
    const dx = pt[0] - t.quad.centerX;
    const dy = pt[1] - t.quad.centerY;
    const xx = dx * dx, xy = dx * dy, yy = dy * dy;
    X += t.quad.qxx * xx + t.quad.qxy * xy + t.quad.qyy * yy;
    Y += t.quad.rxx * xx + t.quad.rxy * xy + t.quad.ryy * yy;
  }
  return [X, Y];
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

/** Eliminación gaussiana n×n con pivoteo parcial. Devuelve null si el sistema es singular. */
function solveSquareSystem(n: number, A: number[][], bVec: number[]): number[] | null {
  const M: number[][] = A.map((row, i) => [...row, bVec[i]]);
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
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = M[i][n];
  return out;
}

function solve3x3(A: number[][], bVec: number[]): number[] | null {
  return solveSquareSystem(3, A, bVec);
}

/**
 * Ajusta por mínimos cuadrados una afín 2D que mapea `src` -> `dst`
 * (mismos índices, mínimo 3 puntos no colineales).
 */
function fitAffineLeastSquares(
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
function maxResidual(
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

/**
 * Fase 5 (hardening) — ajusta una corrección cuadrática de segundo orden
 * sobre el RESIDUO del afín ya ajustado (no lo reemplaza, lo complementa):
 * captura la curvatura de la proyección conforme que un modelo puramente
 * lineal no puede representar, sin agregar ninguna llamada a proj4 por
 * vértice — se resuelve una sola vez, en el refit, igual que el afín.
 * Coordenadas centradas en el centroide de la grilla de muestra para
 * mantener bien condicionado el sistema normal (x/y crudos en EPSG:3857
 * son del orden de 10⁶-10⁷; su cuadrado desborda la precisión útil de un
 * double para esta cuenta si no se centra primero).
 */
function fitQuadraticCorrection(
  src: ReadonlyArray<readonly [number, number]>,
  dst: ReadonlyArray<readonly [number, number]>,
  affine: AffineTransform,
): QuadCorrection | null {
  const n = src.length;
  if (n < 6) return null;

  let centerX = 0, centerY = 0;
  for (const p of src) { centerX += p[0]; centerY += p[1]; }
  centerX /= n; centerY /= n;

  let s_xx_xx = 0, s_xx_xy = 0, s_xx_yy = 0, s_xy_xy = 0, s_xy_yy = 0, s_yy_yy = 0;
  let rX_xx = 0, rX_xy = 0, rX_yy = 0;
  let rY_xx = 0, rY_xy = 0, rY_yy = 0;

  for (let i = 0; i < n; i++) {
    const dx = src[i][0] - centerX;
    const dy = src[i][1] - centerY;
    const xx = dx * dx, xy = dx * dy, yy = dy * dy;

    s_xx_xx += xx * xx; s_xx_xy += xx * xy; s_xx_yy += xx * yy;
    s_xy_xy += xy * xy; s_xy_yy += xy * yy;
    s_yy_yy += yy * yy;

    const approx = applyAffine(src[i], affine);
    const resX = dst[i][0] - approx[0];
    const resY = dst[i][1] - approx[1];

    rX_xx += xx * resX; rX_xy += xy * resX; rX_yy += yy * resX;
    rY_xx += xx * resY; rY_xy += xy * resY; rY_yy += yy * resY;
  }

  const Normal = [
    [s_xx_xx, s_xx_xy, s_xx_yy],
    [s_xx_xy, s_xy_xy, s_xy_yy],
    [s_xx_yy, s_xy_yy, s_yy_yy],
  ];

  const solX = solveSquareSystem(3, Normal, [rX_xx, rX_xy, rX_yy]);
  const solY = solveSquareSystem(3, Normal, [rY_xx, rY_xy, rY_yy]);
  if (!solX || !solY) return null;

  let maxCorrectionM = 0;
  for (let i = 0; i < n; i++) {
    const dx = src[i][0] - centerX;
    const dy = src[i][1] - centerY;
    const xx = dx * dx, xy = dx * dy, yy = dy * dy;
    const corrX = solX[0] * xx + solX[1] * xy + solX[2] * yy;
    const corrY = solY[0] * xx + solY[1] * xy + solY[2] * yy;
    const m = Math.hypot(corrX, corrY);
    if (m > maxCorrectionM) maxCorrectionM = m;
  }

  return {
    centerX, centerY,
    qxx: solX[0], qxy: solX[1], qyy: solX[2],
    rxx: solY[0], rxy: solY[1], ryy: solY[2],
    maxCorrectionM,
  };
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
 * Ajusta la matriz que aproxima EPSG:3857 → `dstEpsg` (vía proj4) dentro
 * de `extent3857`: afín por mínimos cuadrados + corrección cuadrática del
 * residuo (Fase 5 hardening). gridSize=7 (49 puntos) da grados de libertad
 * de sobra para ambos ajustes — se paga solo al (re)ajustar, nunca por
 * vértice (ver affineCache.ts).
 */
export function fitAffineForExtent(
  extent3857: Extent,
  dstEpsg: string,
  gridSize = 7,
): AffineFitResult | null {
  const src = sampleGrid(extent3857, gridSize);
  const dst = src.map((p) => transform(p, DISPLAY_PROJECTION, dstEpsg) as [number, number]);
  const affine = fitAffineLeastSquares(src, dst);
  if (!affine) return null;

  const quad = fitQuadraticCorrection(src, dst, affine) ?? undefined;
  const finalTransform: AffineTransform = quad ? { ...affine, quad } : affine;
  const maxErrorM = maxResidual(finalTransform, src, dst);
  return { transform: finalTransform, maxErrorM, extent: extent3857 };
}

// ─── Plano tangente local (modo CRS 'none') ──────────────────────────

const WEB_MERCATOR_RADIUS_M = 6378137;

function mercatorYToLatRad(y: number): number {
  return 2 * Math.atan(Math.exp(y / WEB_MERCATOR_RADIUS_M)) - Math.PI / 2;
}

function exactTangentPoint(p: readonly [number, number], centerX: number, lat0: number): [number, number] {
  const lon0 = centerX / WEB_MERCATOR_RADIUS_M;
  const lon = p[0] / WEB_MERCATOR_RADIUS_M;
  const lat = mercatorYToLatRad(p[1]);
  return [
    WEB_MERCATOR_RADIUS_M * (lon - lon0) * Math.cos(lat0),
    WEB_MERCATOR_RADIUS_M * (lat - lat0),
  ];
}

/**
 * Ajusta, en forma cerrada, la afín EPSG:3857 -> plano tangente local
 * centrado en `extent3857`, más corrección cuadrática del residuo (Fase 5
 * hardening) — igual criterio que `fitAffineForExtent`.
 */
export function fitLocalTangentPlane(extent3857: Extent): AffineFitResult {
  const [minX, minY, maxX, maxY] = extent3857;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const lat0 = mercatorYToLatRad(centerY);
  const scale = Math.cos(lat0);

  const affine: AffineTransform = {
    a: scale, b: 0, c: -centerX * scale,
    d: 0, e: scale, f: -centerY * scale,
  };

  const src = sampleGrid(extent3857, 7);
  const dst = src.map((p) => exactTangentPoint(p, centerX, lat0));

  const quad = fitQuadraticCorrection(src, dst, affine) ?? undefined;
  const finalTransform: AffineTransform = quad ? { ...affine, quad } : affine;
  const maxErrorM = maxResidual(finalTransform, src, dst);
  return { transform: finalTransform, maxErrorM, extent: extent3857 };
}