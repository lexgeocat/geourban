import { subdivideManzanoCabeceraCuerpo } from './subdivisionCabeceraCuerpo';
import type { Polygon as GeoJsonPolygon, MultiPolygon, Feature as GeoJsonFeature } from 'geojson';
import {
  type Pt,
  type CutResult,
  type LotResult,
  type SliceResult,
  polyArea,
  centroid,
  clipToStrip,
  principalAxis,
  projectExtents,
  pointInPoly,
  buildCutPolys,
} from './polygonEngine';

// ─── Tipos públicos ─────────────────────────────────────────────────

export type SubdivisionMethod = 'auto' | 'modo2' | 'exact' | 'manual-slice';

export interface SubdivisionOptions {
  method: SubdivisionMethod;
  /** Área objetivo por lote en m² (auto / exact / manual-slice) */
  targetAreaM2?: number;
  /** Frente mínimo en metros (auto / exact / manual-slice) */
  frontMinM?: number;
  /** Dirección preferida del eje de corte (auto / exact). Si no se provee, se calcula con PCA. */
  dirAx?: number;
  dirAy?: number;
  /** Para manual-slice: segmento de frente seleccionado */
  frenteSeg?: { a: Pt; b: Pt };
  /** Para manual-slice: segmento auxiliar (dirección perpendicular al corte) */
  auxSeg?: { a: Pt; b: Pt };
  /** Para manual-slice: línea de corte directa (alternativa a auxSeg) */
  cutLine?: { p1: Pt; p2: Pt };
}

export interface SubdivisionResult {
  ok: boolean;
  features: GeoJsonFeature<GeoJsonPolygon | MultiPolygon>[];
  warnings: string[];
  error?: string;
}

// ─── Constantes ─────────────────────────────────────────────────────

const NARROW_RATIO = 1.6;

// ─── Helpers locales ────────────────────────────────────────────────

function polyAreaM2(pts: Pt[]): number {
  return polyArea(pts);
}

function wm(d: number): number { return d; }
function mw(m: number): number { return m; }

function toGeoJsonFeature(pts: Pt[], properties: Record<string, unknown>): GeoJsonFeature<GeoJsonPolygon> {
  const ring = [...pts];
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}

// ─── computeCuts

function computeCuts(
  halfPoly: Pt[],
  halfExt: { min: number; max: number },
  lx: number, ly: number,
  sx: number, sy: number,
  targetAreaM2: number,
  frontMinM: number,
): CutResult[] | null {
  if (!halfPoly || !halfExt) return null;
  const extSH = projectExtents(halfPoly, sx, sy);
  const realDepthM = wm(extSH.max - extSH.min);
  if (realDepthM < 0.001) return null;
  const nomFrontM = Math.max(frontMinM, targetAreaM2 / realDepthM);
  const cuts: CutResult[] = [];
  let t = halfExt.min, lotCount = 0;

  while (t < halfExt.max - 1e-9) {
    const remaining = halfExt.max - t;
    const restPoly = clipToStrip(halfPoly, lx, ly, t, halfExt.max);
    if (!restPoly || restPoly.length < 3) break;
    const restAreaM2 = polyAreaM2(restPoly);
    if (restAreaM2 < targetAreaM2 * 0.5) {
      cuts.push({ t: halfExt.max, isRemnant: true });
      break;
    }
    const nomFrontW = mw(nomFrontM);
    const nRemaining = Math.round(remaining / nomFrontW);
    if (nRemaining <= 1 || remaining - nomFrontW < nomFrontW * 0.05) {
      cuts.push({ t: halfExt.max, isRemnant: restAreaM2 < targetAreaM2 * 0.5 });
      break;
    }

    let lo = mw(frontMinM), hi = remaining * 0.999;
    let bestF = nomFrontW;
    let bestErr = Infinity;

    for (let iter = 0; iter < 120; iter++) {
      const mid = (lo + hi) / 2;
      const testPoly = clipToStrip(halfPoly, lx, ly, t, t + mid);
      if (!testPoly || testPoly.length < 3) { lo = mid; continue; }
      const area = polyAreaM2(testPoly);
      const err = area - targetAreaM2;
      if (Math.abs(err) < Math.abs(bestErr)) { bestErr = err; bestF = mid; }
      if (Math.abs(err) <= 1e-6) break;
      if (err < 0) lo = mid; else hi = mid;
    }

    if (wm(bestF) < frontMinM * 0.99) bestF = mw(frontMinM);
    t += bestF;
    cuts.push({ t, isRemnant: false });
    if (++lotCount > 500) break;
  }
  return cuts;
}

// ─── computeLotsOnHalf

function computeLotsOnHalf(
  fullPoly: Pt[],
  extL: { min: number; max: number },
  extS: { min: number; max: number },
  lx: number, ly: number,
  sx: number, sy: number,
  targetAreaM2: number,
  frontMinM: number,
): LotResult[] {
  const cuts = computeCuts(fullPoly, extL, lx, ly, sx, sy, targetAreaM2, frontMinM);
  if (!cuts) return [];
  const lots: LotResult[] = [];
  let prevT = extL.min;

  for (let ci = 0; ci < cuts.length; ci++) {
    const actualEnd = Math.min(cuts[ci].t, extL.max);
    if (actualEnd <= prevT + 1e-6) break;
    const stripPoly = clipToStrip(fullPoly, lx, ly, prevT, actualEnd);
    if (!stripPoly || stripPoly.length < 3) { prevT = actualEnd; continue; }
    const areaM2 = polyAreaM2(stripPoly);
    if (areaM2 < 1e-6) { prevT = actualEnd; continue; }
    const extSH = projectExtents(stripPoly, sx, sy);
    const depthM = wm(extSH.max - extSH.min);
    lots.push({
      pts: stripPoly,
      isRemnant: cuts[ci].isRemnant || areaM2 < targetAreaM2 * 0.5,
      frontM: wm(actualEnd - prevT),
      depthM: depthM > 0 ? depthM : wm(extS.max - extS.min),
      areaM2,
    });
    prevT = actualEnd;
    if (actualEnd >= extL.max - 1e-6) break;
  }

  if (prevT < extL.max - 1e-6) {
    const remPoly = clipToStrip(fullPoly, lx, ly, prevT, extL.max);
    if (remPoly && remPoly.length >= 3) {
      const areaM2 = polyAreaM2(remPoly);
      if (areaM2 > 1e-6)
        lots.push({
          pts: remPoly,
          isRemnant: areaM2 < targetAreaM2 * 0.5,
          frontM: wm(extL.max - prevT),
          depthM: wm(extS.max - extS.min),
          areaM2,
        });
    }
  }
  return lots;
}

// ─── subdivideHalf

function subdivideHalf(
  poly: Pt[],
  lx: number, ly: number,
  sx: number, sy: number,
  extL: { min: number; max: number },
  targetAreaM2: number,
  frontMinM: number,
  isRemnant: boolean,
  out: LotResult[],
): void {
  let t = extL.min;
  let lotCount = 0;
  const extSH = projectExtents(poly, sx, sy);
  const halfDepthM = Math.max(wm(extSH.max - extSH.min), 0.001);

  while (t < extL.max - 1e-9) {
    const remaining = extL.max - t;
    const restPoly = clipToStrip(poly, lx, ly, t, extL.max);
    if (!restPoly || restPoly.length < 3) break;
    const restArea = polyAreaM2(restPoly);
    const probeWidth = Math.min(mw(frontMinM) * 0.5, remaining * 0.1);
    const colProbe = clipToStrip(poly, lx, ly, t, t + Math.max(probeWidth, mw(0.5)));
    let depthLocal = halfDepthM;
    if (colProbe && colProbe.length >= 3) {
      const eP = projectExtents(colProbe, sx, sy);
      const d = wm(eP.max - eP.min);
      if (d > 0.5) depthLocal = d;
    }
    const nomFrontM = Math.max(frontMinM, targetAreaM2 / depthLocal);
    const nomFrontW = mw(nomFrontM);
    const nRemaining = Math.round(remaining / nomFrontW);

    if (restArea < targetAreaM2 * 0.5 || nRemaining <= 1 || remaining - nomFrontW < nomFrontW * 0.05) {
      const extSR = projectExtents(restPoly, sx, sy);
      out.push({
        pts: restPoly,
        isRemnant: true,
        frontM: wm(remaining),
        depthM: wm(extSR.max - extSR.min),
        areaM2: restArea,
      });
      break;
    }

    let lo = mw(frontMinM) * 0.1;
    let hi = remaining * 0.9999;
    let bestF = nomFrontW;
    let bestErr = Infinity;

    for (let iter = 0; iter < 160; iter++) {
      const mid = (lo + hi) / 2;
      const test = clipToStrip(poly, lx, ly, t, t + mid);
      if (!test || test.length < 3) { lo = mid; continue; }
      const area = polyAreaM2(test);
      const err = area - targetAreaM2;
      if (Math.abs(err) < Math.abs(bestErr)) { bestErr = err; bestF = mid; }
      if (Math.abs(err) <= 1e-6) break;
      if (err < 0) lo = mid; else hi = mid;
    }

    if (wm(bestF) < frontMinM * 0.99) bestF = mw(frontMinM);
    const lotPoly = clipToStrip(poly, lx, ly, t, t + bestF);
    if (!lotPoly || lotPoly.length < 3 || polyArea(lotPoly) < 0.5) break;
    const areaM2 = polyAreaM2(lotPoly);
    const extSL = projectExtents(lotPoly, sx, sy);
    out.push({
      pts: lotPoly,
      isRemnant: false,
      frontM: wm(bestF),
      depthM: wm(extSL.max - extSL.min),
      areaM2,
    });
    t += bestF;
    if (++lotCount > 500) break;
  }
}

// ─── subdivideManzanoAuto

export function subdivideManzanoAuto(
  mznPts: Pt[],
  targetAreaM2: number,
  frontMinM: number,
  dirPref?: { ax: number; ay: number },
): LotResult[] {
  if (mznPts.length < 3) return [];
  const totalArea = polyAreaM2(mznPts);
  if (totalArea < targetAreaM2 * 0.15) return [];

  let lx: number, ly: number;
  if (dirPref && dirPref.ax !== undefined) {
    lx = dirPref.ax; ly = dirPref.ay;
  } else {
    const pa = principalAxis(mznPts);
    lx = pa.ux; ly = pa.uy;
  }
  const sx = -ly, sy = lx;
  const extS = projectExtents(mznPts, sx, sy);
  const extL = projectExtents(mznPts, lx, ly);
  const totalShortM = wm(extS.max - extS.min);
  const nomDepthM = targetAreaM2 / Math.max(frontMinM, 1);
  const isNarrow = totalShortM < NARROW_RATIO * nomDepthM;

  if (isNarrow) {
    return computeLotsOnHalf(mznPts, extL, extS, lx, ly, sx, sy, targetAreaM2, frontMinM);
  }

  const sMid = (extS.min + extS.max) / 2;
  const halfBot = clipToStrip(mznPts, sx, sy, extS.min, sMid);
  const halfTop = clipToStrip(mznPts, sx, sy, sMid, extS.max);
  const halfBotOk = halfBot && halfBot.length >= 3 && polyAreaM2(halfBot) >= targetAreaM2 * 0.1;
  const halfTopOk = halfTop && halfTop.length >= 3 && polyAreaM2(halfTop) >= targetAreaM2 * 0.1;

  if (!halfBotOk && !halfTopOk) {
    return computeLotsOnHalf(mznPts, extL, extS, lx, ly, sx, sy, targetAreaM2, frontMinM);
  }
  if (!halfBotOk) {
    const extLTop = projectExtents(halfTop!, lx, ly);
    const extSTop = projectExtents(halfTop!, sx, sy);
    return computeLotsOnHalf(halfTop!, extLTop, extSTop, lx, ly, sx, sy, targetAreaM2, frontMinM);
  }
  if (!halfTopOk) {
    const extLBot = projectExtents(halfBot!, lx, ly);
    const extSBot = projectExtents(halfBot!, sx, sy);
    return computeLotsOnHalf(halfBot!, extLBot, extSBot, lx, ly, sx, sy, targetAreaM2, frontMinM);
  }

  const extLBot = projectExtents(halfBot!, lx, ly);
  const extLTop = projectExtents(halfTop!, lx, ly);
  const spanBot = extLBot.max - extLBot.min;
  const spanTop = extLTop.max - extLTop.min;
  const masterIdx = spanTop > spanBot ? 1 : 0;
  const masterPoly = masterIdx === 0 ? halfBot! : halfTop!;
  const masterExt = masterIdx === 0 ? extLBot : extLTop;
  const masterCuts = computeCuts(masterPoly, masterExt, lx, ly, sx, sy, targetAreaM2, frontMinM);

  if (!masterCuts || masterCuts.length === 0) {
    const allLots: LotResult[] = [];
    const extSBot2 = projectExtents(halfBot!, sx, sy);
    allLots.push(...computeLotsOnHalf(halfBot!, extLBot, extSBot2, lx, ly, sx, sy, targetAreaM2, frontMinM));
    const extSTop2 = projectExtents(halfTop!, sx, sy);
    allLots.push(...computeLotsOnHalf(halfTop!, extLTop, extSTop2, lx, ly, sx, sy, targetAreaM2, frontMinM));
    return allLots;
  }

  const allLots: LotResult[] = [];
  for (const halfInfo of [
    { poly: halfBot!, extL: extLBot },
    { poly: halfTop!, extL: extLTop },
  ]) {
    const { poly: halfPoly, extL: halfExt } = halfInfo;
    const extSH = projectExtents(halfPoly, sx, sy);
    const realDepthM = Math.max(wm(extSH.max - extSH.min), 0.001);
    const myMin = halfExt.min, myMax = halfExt.max;
    let prevT = myMin;

    for (let ci = 0; ci < masterCuts.length; ci++) {
      const actualEnd = Math.min(masterCuts[ci].t, myMax);
      if (actualEnd <= prevT + 1e-6) continue;
      const stripPoly = clipToStrip(halfPoly, lx, ly, prevT, actualEnd);
      if (!stripPoly || stripPoly.length < 3) { prevT = actualEnd; continue; }
      const areaM2 = polyAreaM2(stripPoly);
      if (areaM2 < 0.5) { prevT = actualEnd; continue; }
      const extSStrip = projectExtents(stripPoly, sx, sy);
      const depthM = Math.max(wm(extSStrip.max - extSStrip.min), realDepthM);
      const isRemnant = masterCuts[ci].isRemnant || areaM2 < targetAreaM2 * 0.5;
      allLots.push({
        pts: stripPoly,
        isRemnant,
        frontM: wm(actualEnd - prevT),
        depthM,
        areaM2,
      });
      prevT = actualEnd;
      if (actualEnd >= myMax - 1e-6) break;
    }

    if (prevT < myMax - 1e-6) {
      const remPoly = clipToStrip(halfPoly, lx, ly, prevT, myMax);
      if (remPoly && remPoly.length >= 3) {
        const areaM2 = polyAreaM2(remPoly);
        if (areaM2 >= 0.5) {
          const extSRem = projectExtents(remPoly, sx, sy);
          allLots.push({
            pts: remPoly,
            isRemnant: areaM2 < targetAreaM2 * 0.5,
            frontM: wm(myMax - prevT),
            depthM: Math.max(wm(extSRem.max - extSRem.min), realDepthM),
            areaM2,
          });
        }
      }
    }
  }
  return allLots;
}

// ─── subdivideManzanoExact

export function subdivideManzanoExact(
  mznPts: Pt[],
  targetAreaM2: number,
  frontMinM: number,
  dirPref?: { ax: number; ay: number },
): LotResult[] {
  if (mznPts.length < 3) return [];
  const totalArea = polyAreaM2(mznPts);
  if (totalArea < targetAreaM2 * 0.15) return [];

  let lx: number, ly: number;
  if (dirPref && dirPref.ax !== undefined) {
    lx = dirPref.ax; ly = dirPref.ay;
  } else {
    const pa = principalAxis(mznPts);
    lx = pa.ux; ly = pa.uy;
  }
  const sx = -ly, sy = lx;
  const extS = projectExtents(mznPts, sx, sy);
  const nomDepthW = mw(targetAreaM2 / Math.max(frontMinM, 1));
  const totalDepthM = wm(extS.max - extS.min);
  const globalNarrow = totalDepthM < NARROW_RATIO * wm(nomDepthW);
  const extL = projectExtents(mznPts, lx, ly);
  const allLots: LotResult[] = [];

  if (globalNarrow) {
    subdivideHalf(mznPts, lx, ly, sx, sy, extL, targetAreaM2, frontMinM, false, allLots);
  } else {
    const sMid = (extS.min + extS.max) / 2;
    const halfBot = clipToStrip(mznPts, sx, sy, extS.min, sMid);
    const halfTop = clipToStrip(mznPts, sx, sy, sMid, extS.max);
    const halfBotOk = halfBot && halfBot.length >= 3 && polyAreaM2(halfBot) >= targetAreaM2 * 0.1;
    const halfTopOk = halfTop && halfTop.length >= 3 && polyAreaM2(halfTop) >= targetAreaM2 * 0.1;

    if (!halfBotOk && !halfTopOk) {
      subdivideHalf(mznPts, lx, ly, sx, sy, extL, targetAreaM2, frontMinM, false, allLots);
    } else if (!halfBotOk) {
      const extLTop = projectExtents(halfTop!, lx, ly);
      subdivideHalf(halfTop!, lx, ly, sx, sy, extLTop, targetAreaM2, frontMinM, false, allLots);
    } else if (!halfTopOk) {
      const extLBot = projectExtents(halfBot!, lx, ly);
      subdivideHalf(halfBot!, lx, ly, sx, sy, extLBot, targetAreaM2, frontMinM, false, allLots);
    } else {
      const extLBot = projectExtents(halfBot!, lx, ly);
      subdivideHalf(halfBot!, lx, ly, sx, sy, extLBot, targetAreaM2, frontMinM, false, allLots);
      const extLTop = projectExtents(halfTop!, lx, ly);
      subdivideHalf(halfTop!, lx, ly, sx, sy, extLTop, targetAreaM2, frontMinM, false, allLots);
    }
  }
  return allLots;
}

// ─── sliceBisectManzano

export function sliceBisectManzano(
  wp: Pt[],
  targetAreaM2: number,
  frenteSeg: { a: Pt; b: Pt },
  auxSeg: { a: Pt; b: Pt },
): SliceResult | null {
  const TOL_M2 = 1e-6;
  const totalArea = polyAreaM2(wp);
  const auxDx = auxSeg.b[0] - auxSeg.a[0];
  const auxDy = auxSeg.b[1] - auxSeg.a[1];
  const auxLen = Math.hypot(auxDx, auxDy);
  if (auxLen < 1e-10) return null;
  const advX = auxDx / auxLen, advY = auxDy / auxLen;
  const cutX = -auxDy / auxLen, cutY = auxDx / auxLen;
  const cen = centroid(wp);
  const cenAdvProj = cen[0] * advX + cen[1] * advY;
  const projs = wp.map(p => p[0] * advX + p[1] * advY);
  const projMin = Math.min(...projs), projMax = Math.max(...projs);
  const projRange = projMax - projMin;
  if (projRange < 1e-9) return null;

  const N_FRENTE = 11;
  const frentePoints: Pt[] = [];
  for (let k = 0; k <= N_FRENTE; k++) {
    frentePoints.push([
      frenteSeg.a[0] + ((frenteSeg.b[0] - frenteSeg.a[0]) * k) / N_FRENTE,
      frenteSeg.a[1] + ((frenteSeg.b[1] - frenteSeg.a[1]) * k) / N_FRENTE,
    ]);
  }
  const frenteAdvProjs = frentePoints.map(p => p[0] * advX + p[1] * advY);
  const frenteProjMed = (Math.min(...frenteAdvProjs) + Math.max(...frenteAdvProjs)) / 2;
  const frenteEsMin = Math.abs(frenteProjMed - projMin) <= Math.abs(frenteProjMed - projMax);

  function fragmentContainsFronte(poly: Pt[]): boolean {
    let cnt = 0;
    for (const p of frentePoints) { if (pointInPoly(p[0], p[1], poly)) cnt++; }
    return cnt >= Math.ceil(frentePoints.length * 0.5);
  }

  function evalT(t: number): SliceResult | null {
    const proj = frenteEsMin ? projMin + t * projRange : projMax - t * projRange;
    const ox = cen[0] + (proj - cenAdvProj) * advX;
    const oy = cen[1] + (proj - cenAdvProj) * advY;
    const FAR = 1e7;
    const rA: Pt = [ox + cutX * FAR, oy + cutY * FAR];
    const rB: Pt = [ox - cutX * FAR, oy - cutY * FAR];
    const n = wp.length;
    const rawHits: { x: number; y: number; segIdx: number; u: number; tCut: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = wp[i], b = wp[(i + 1) % n];
      const d1x = b[0] - a[0], d1y = b[1] - a[1];
      const d2x = rB[0] - rA[0], d2y = rB[1] - rA[1];
      const denom = d1x * d2y - d1y * d2x;
      if (Math.abs(denom) < 1e-10) continue;
      const tt = ((rA[0] - a[0]) * d2y - (rA[1] - a[1]) * d2x) / denom;
      const u = ((rA[0] - a[0]) * d1y - (rA[1] - a[1]) * d1x) / denom;
      if (tt < -1e-9 || tt > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
      rawHits.push({ x: a[0] + tt * d1x, y: a[1] + tt * d1y, segIdx: i, u: Math.max(0, Math.min(1, tt)), tCut: u });
    }
    if (rawHits.length < 2) return null;
    rawHits.sort((a, b) => a.tCut - b.tCut);
    const hits = [rawHits[0]];
    for (let i = 1; i < rawHits.length; i++) {
      if (Math.hypot(rawHits[i].x - hits[hits.length - 1].x, rawHits[i].y - hits[hits.length - 1].y) > 1e-6)
        hits.push(rawHits[i]);
    }
    if (hits.length < 2) return null;

    for (let i = 0; i < hits.length - 1; i++) {
      const hA = hits[i], hB = hits[i + 1];
      const mx = (hA.x + hB.x) / 2, my = (hA.y + hB.y) / 2;
      if (!pointInPoly(mx, my, wp)) continue;
      const sl = buildCutPolys(wp, { segIdx: hA.segIdx, u: hA.u, pt: [hA.x, hA.y] }, { segIdx: hB.segIdx, u: hB.u, pt: [hB.x, hB.y] });
      if (!sl || sl.poly1.length < 3 || sl.poly2.length < 3) continue;
      const p1HasF = fragmentContainsFronte(sl.poly1);
      const p2HasF = fragmentContainsFronte(sl.poly2);
      let front: Pt[], rest: Pt[];
      if (p1HasF && !p2HasF) { front = sl.poly1; rest = sl.poly2; }
      else if (p2HasF && !p1HasF) { front = sl.poly2; rest = sl.poly1; }
      else {
        const fMX = (frenteSeg.a[0] + frenteSeg.b[0]) / 2;
        const fMY = (frenteSeg.a[1] + frenteSeg.b[1]) / 2;
        const d1 = Math.hypot(centroid(sl.poly1)[0] - fMX, centroid(sl.poly1)[1] - fMY);
        const d2 = Math.hypot(centroid(sl.poly2)[0] - fMX, centroid(sl.poly2)[1] - fMY);
        front = d1 <= d2 ? sl.poly1 : sl.poly2;
        rest = d1 <= d2 ? sl.poly2 : sl.poly1;
      }
      return { front, rest, areaM2: polyAreaM2(front) };
    }
    return null;
  }

  const N_SAMPLES = 50;
  const samples: { t: number; areaM2: number }[] = [];
  for (let k = 1; k < N_SAMPLES; k++) {
    const t = k / N_SAMPLES;
    const ev = evalT(t);
    if (ev !== null) samples.push({ t, areaM2: ev.areaM2 });
  }
  if (samples.length === 0) return null;

  const crosses: { lo: number; hi: number }[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i], s1 = samples[i + 1];
    if ((s0.areaM2 - targetAreaM2) * (s1.areaM2 - targetAreaM2) <= 0) {
      crosses.push({ lo: s0.t, hi: s1.t });
    }
  }

  let bestLo = undefined as number | undefined, bestHi = undefined as number | undefined;
  if (crosses.length === 0) {
    let bestSample = samples[0], bestErr = Infinity;
    for (const s of samples) {
      const e = Math.abs(s.areaM2 - targetAreaM2);
      if (e < bestErr) { bestErr = e; bestSample = s; }
    }
    return evalT(bestSample.t);
  }

  if (crosses.length === 1) {
    bestLo = crosses[0].lo; bestHi = crosses[0].hi;
  } else {
    let bestScore = Infinity;
    for (const cr of crosses) {
      const tMid = (cr.lo + cr.hi) / 2;
      const evMid = evalT(tMid);
      if (!evMid) continue;
      const relErr = Math.abs(evMid.areaM2 - targetAreaM2) / totalArea;
      const tPenalty = Math.abs(tMid - 0.5) * 0.05;
      const score = relErr + tPenalty;
      if (score < bestScore) { bestScore = score; bestLo = cr.lo; bestHi = cr.hi; }
    }
    if (bestLo === undefined) { bestLo = crosses[0].lo; bestHi = crosses[0].hi; }
  }

  const evLo0 = evalT(bestLo!);
  if (!evLo0) return evalT((bestLo! + bestHi!) / 2);
  const increasing = evLo0.areaM2 < targetAreaM2;
  let lo = bestLo!, hi = bestHi!;
  let best: SliceResult | null = null, bestErr = Infinity;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const ev = evalT(mid);
    if (!ev) {
      const evQ1 = evalT(lo + (mid - lo) * 0.5);
      const evQ2 = evalT(mid + (hi - mid) * 0.5);
      if (evQ1 && Math.abs(evQ1.areaM2 - targetAreaM2) < bestErr) { bestErr = Math.abs(evQ1.areaM2 - targetAreaM2); best = evQ1; }
      if (evQ2 && Math.abs(evQ2.areaM2 - targetAreaM2) < bestErr) { bestErr = Math.abs(evQ2.areaM2 - targetAreaM2); best = evQ2; }
      if (evQ1) hi = mid; else if (evQ2) lo = mid; else break;
      continue;
    }
    const err = Math.abs(ev.areaM2 - targetAreaM2);
    if (err < bestErr) { bestErr = err; best = ev; }
    if (err <= TOL_M2) break;
    const errSigned = ev.areaM2 - targetAreaM2;
    if (increasing ? errSigned < 0 : errSigned > 0) lo = mid; else hi = mid;
  }
  return best;
}

// ─── sliceBisectLote

function sliceBisectLote(
  wp: Pt[],
  targetAreaM2: number,
  cutDirX: number,
  cutDirY: number,
  frenteMidX: number,
  frenteMidY: number,
): SliceResult | null {
  const TOL_M2 = 1e-6;
  const perpX = -cutDirY, perpY = cutDirX;
  const projs = wp.map(p => p[0] * perpX + p[1] * perpY);
  const pMin = Math.min(...projs), pMax = Math.max(...projs);
  const pRange = pMax - pMin;
  if (pRange < 1e-9) return null;
  const cen = centroid(wp);
  const cenPerpProj = cen[0] * perpX + cen[1] * perpY;
  const fProj = frenteMidX * perpX + frenteMidY * perpY;
  const frenteEsMin = Math.abs(fProj - pMin) <= Math.abs(fProj - pMax);
  const bordeFrenteProj = frenteEsMin ? pMin : pMax;
  const tol = pRange * 0.15;
  const frenteVerts = wp.filter(p => Math.abs(p[0] * perpX + p[1] * perpY - bordeFrenteProj) < tol);
  const frenteRefPts = frenteVerts.length >= 2 ? frenteVerts : [[frenteMidX, frenteMidY] as Pt];

  function fragmentContainsFronte(poly: Pt[]): boolean {
    let inside = 0;
    for (const p of frenteRefPts) { if (pointInPoly(p[0], p[1], poly)) inside++; }
    return inside >= Math.ceil(frenteRefPts.length * 0.5);
  }

  function evalT(t: number): SliceResult | null {
    const proj = frenteEsMin ? pMin + t * pRange : pMax - t * pRange;
    const ox = cen[0] + (proj - cenPerpProj) * perpX;
    const oy = cen[1] + (proj - cenPerpProj) * perpY;
    const FAR = 1e7;
    const rA: Pt = [ox + cutDirX * FAR, oy + cutDirY * FAR];
    const rB: Pt = [ox - cutDirX * FAR, oy - cutDirY * FAR];
    const n = wp.length;
    const rawHits: { x: number; y: number; segIdx: number; u: number; tCut: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = wp[i], b = wp[(i + 1) % n];
      const d1x = b[0] - a[0], d1y = b[1] - a[1];
      const d2x = rB[0] - rA[0], d2y = rB[1] - rA[1];
      const denom = d1x * d2y - d1y * d2x;
      if (Math.abs(denom) < 1e-10) continue;
      const tt = ((rA[0] - a[0]) * d2y - (rA[1] - a[1]) * d2x) / denom;
      const u = ((rA[0] - a[0]) * d1y - (rA[1] - a[1]) * d1x) / denom;
      if (tt < -1e-9 || tt > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) continue;
      rawHits.push({ x: a[0] + tt * d1x, y: a[1] + tt * d1y, segIdx: i, u: Math.max(0, Math.min(1, tt)), tCut: u });
    }
    if (rawHits.length < 2) return null;
    rawHits.sort((a, b) => a.tCut - b.tCut);
    const hits = [rawHits[0]];
    for (let i = 1; i < rawHits.length; i++) {
      if (Math.hypot(rawHits[i].x - hits[hits.length - 1].x, rawHits[i].y - hits[hits.length - 1].y) > 1e-6)
        hits.push(rawHits[i]);
    }
    if (hits.length < 2) return null;
    for (let i = 0; i < hits.length - 1; i++) {
      const hA = hits[i], hB = hits[i + 1];
      const mx = (hA.x + hB.x) / 2, my = (hA.y + hB.y) / 2;
      if (!pointInPoly(mx, my, wp)) continue;
      const sl = buildCutPolys(wp, { segIdx: hA.segIdx, u: hA.u, pt: [hA.x, hA.y] }, { segIdx: hB.segIdx, u: hB.u, pt: [hB.x, hB.y] });
      if (!sl || sl.poly1.length < 3 || sl.poly2.length < 3) continue;
      const p1HasFronte = fragmentContainsFronte(sl.poly1);
      const p2HasFronte = fragmentContainsFronte(sl.poly2);
      let front: Pt[], rest: Pt[];
      if (p1HasFronte && !p2HasFronte) { front = sl.poly1; rest = sl.poly2; }
      else if (p2HasFronte && !p1HasFronte) { front = sl.poly2; rest = sl.poly1; }
      else {
        const d1 = Math.hypot(centroid(sl.poly1)[0] - frenteMidX, centroid(sl.poly1)[1] - frenteMidY);
        const d2 = Math.hypot(centroid(sl.poly2)[0] - frenteMidX, centroid(sl.poly2)[1] - frenteMidY);
        front = d1 <= d2 ? sl.poly1 : sl.poly2;
        rest = d1 <= d2 ? sl.poly2 : sl.poly1;
      }
      return { front, rest, areaM2: polyAreaM2(front) };
    }
    return null;
  }

  const samples: { t: number; areaM2: number }[] = [];
  for (let k = 1; k <= 24; k++) {
    const t = k / 25;
    const ev = evalT(t);
    if (ev) samples.push({ t, areaM2: ev.areaM2 });
  }
  if (samples.length === 0) return null;

  let bestLo: number | null = null, bestHi: number | null = null;
  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i], s1 = samples[i + 1];
    if ((s0.areaM2 - targetAreaM2) * (s1.areaM2 - targetAreaM2) <= 0) {
      bestLo = s0.t; bestHi = s1.t; break;
    }
  }

  if (bestLo === null) {
    let bestSample = samples[0], bestErr = Infinity;
    for (const s of samples) {
      const err = Math.abs(s.areaM2 - targetAreaM2);
      if (err < bestErr) { bestErr = err; bestSample = s; }
    }
    return evalT(bestSample.t);
  }

  let lo = bestLo, hi = bestHi!;
  const evLo0 = evalT(lo);
  const increasing = evLo0 ? evLo0.areaM2 < targetAreaM2 : true;
  let best: SliceResult | null = null, bestErr = Infinity;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const ev = evalT(mid);
    if (!ev) {
      const evQ1 = evalT(lo + (mid - lo) * 0.5);
      const evQ2 = evalT(mid + (hi - mid) * 0.5);
      if (evQ1) {
        hi = mid;
        if (Math.abs(evQ1.areaM2 - targetAreaM2) < bestErr) { bestErr = Math.abs(evQ1.areaM2 - targetAreaM2); best = evQ1; }
      } else if (evQ2) {
        lo = mid;
        if (Math.abs(evQ2.areaM2 - targetAreaM2) < bestErr) { bestErr = Math.abs(evQ2.areaM2 - targetAreaM2); best = evQ2; }
      } else break;
      continue;
    }
    const err = Math.abs(ev.areaM2 - targetAreaM2);
    if (err < bestErr) { bestErr = err; best = ev; }
    if (err <= TOL_M2) break;
    const errSigned = ev.areaM2 - targetAreaM2;
    if (increasing ? errSigned < 0 : errSigned > 0) lo = mid; else hi = mid;
  }
  return best;
}

// ─── Dispatcher ─────────────────────────────────────────────────────
// ─── Dispatcher directo por anillo (Pt[]), sin pasar por GeoJSON ───────
// Lo usan GenerateLotsCommand (subdivisión masiva por manzano) y
// RecomputeManzanoLotsCommand (recálculo puntual desde el panel).

export type ManzanoLoteMethod = 'auto' | 'exact' | 'modo2';

export function subdivideManzano(
  ringPts: Pt[],
  method: ManzanoLoteMethod,
  targetAreaM2: number,
  frontMinM: number,
  dirPref?: { ax: number; ay: number },
): LotResult[] {
  if (!ringPts || ringPts.length < 3) return [];
  const pts: Pt[] = ringPts.map((c) => [c[0], c[1]]);
  if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) {
    pts.push([pts[0][0], pts[0][1]]);
  }
  if (method === 'exact') return subdivideManzanoExact(pts, targetAreaM2, frontMinM, dirPref);
  if (method === 'modo2') return subdivideManzanoAuto(pts, targetAreaM2, frontMinM, dirPref);
  return subdivideManzanoCabeceraCuerpo(pts, targetAreaM2, frontMinM, dirPref);
}

export function subdivide(
  polygon: GeoJsonPolygon,
  opts: SubdivisionOptions,
): SubdivisionResult {
  try {
    const ring = polygon.coordinates[0] as Pt[];
    if (!ring || ring.length < 3) {
      return { ok: false, features: [], warnings: [], error: 'Polígono inválido' };
    }
    // Cerrar anillo si es necesario
    const pts: Pt[] = ring.map(c => [c[0], c[1]]);
    if (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1]) {
      pts.push([pts[0][0], pts[0][1]]);
    }

    const targetAreaM2 = opts.targetAreaM2 ?? 250;
    const frontMinM = opts.frontMinM ?? 12;
    const dirPref = opts.dirAx !== undefined ? { ax: opts.dirAx, ay: opts.dirAy! } : undefined;

    let lots: LotResult[] = [];
    const warnings: string[] = [];

    if (opts.method === 'auto') {
      lots = subdivideManzanoCabeceraCuerpo(pts, targetAreaM2, frontMinM, dirPref);
    } else if (opts.method === 'modo2') {
      lots = subdivideManzanoAuto(pts, targetAreaM2, frontMinM, dirPref);
    } else if (opts.method === 'exact') {
      lots = subdivideManzanoExact(pts, targetAreaM2, frontMinM, dirPref);
    } else if (opts.method === 'manual-slice') {
      if (opts.cutLine) {
        const dx = opts.cutLine.p2[0] - opts.cutLine.p1[0];
        const dy = opts.cutLine.p2[1] - opts.cutLine.p1[1];
        const len = Math.hypot(dx, dy);
        if (len < 1e-10) return { ok: false, features: [], warnings, error: 'Línea de corte muy corta' };
        const fakeFrente: { a: Pt; b: Pt } = { a: opts.cutLine.p1, b: opts.cutLine.p2 };
        const fakeAux: { a: Pt; b: Pt } = { a: [0, 0], b: [-dy / len, dx / len] };
        const result = sliceBisectManzano(pts, targetAreaM2, fakeFrente, fakeAux);
        if (!result) return { ok: false, features: [], warnings, error: 'Bisección falló' };
        lots = [
          { pts: result.front, isRemnant: false, frontM: 0, depthM: 0, areaM2: polyAreaM2(result.front) },
          { pts: result.rest, isRemnant: true, frontM: 0, depthM: 0, areaM2: polyAreaM2(result.rest) },
        ];
      } else if (opts.frenteSeg && opts.auxSeg) {
        const result = sliceBisectManzano(pts, targetAreaM2, opts.frenteSeg, opts.auxSeg);
        if (!result) return { ok: false, features: [], warnings, error: 'Bisección falló' };
        lots = [
          { pts: result.front, isRemnant: false, frontM: 0, depthM: 0, areaM2: polyAreaM2(result.front) },
          { pts: result.rest, isRemnant: true, frontM: 0, depthM: 0, areaM2: polyAreaM2(result.rest) },
        ];
      } else {
        return { ok: false, features: [], warnings, error: 'Falta frenteSeg+auxSeg o cutLine para manual-slice' };
      }
    } else {
      return { ok: false, features: [], warnings, error: `Método desconocido: ${opts.method}` };
    }

    if (lots.length === 0) {
      return { ok: false, features: [], warnings, error: 'No se generaron lotes' };
    }

    warnings.push(`${lots.length} lotes generados (${lots.filter(l => l.isRemnant).length} remanentes)`);

    const features = lots.map((lot, i) =>
      toGeoJsonFeature(lot.pts, {
        subdivision: opts.method,
        label: lot.isRemnant ? `Remanente ${i + 1}` : `Lote ${i + 1}`,
        areaM2: lot.areaM2,
        frontM: lot.frontM,
        depthM: lot.depthM,
        isRemnant: lot.isRemnant,
      })
    );

    return { ok: true, features: features as GeoJsonFeature<GeoJsonPolygon | MultiPolygon>[], warnings };
  } catch (err) {
    return {
      ok: false,
      features: [],
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
