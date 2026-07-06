// =====================================================================
// MÓDULO 10/17 · 10-lot-subdivision.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 03-state.js, 09-polygon-engine.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [10] MOTOR DE SUBDIVISIÓN AUTOMÁTICA DE LOTES
// (candidato a módulo: lot-subdivision.js · depende de: [3],[9])
// Nota: mznMethods, mznEquipamiento, _satMap, _satOverlay, _geoOrigin,
// _satVisible y _rendering (abajo) son estado global de la app, no
// exclusivo de este motor — al modularizar deberían unirse al bloque
// de estado global [3].
// =====================================================================
const NARROW_RATIO = 1.6;
const N_SAMPLES = 5;
let mznMethods = {};
let mznEquipamiento = {};
let _satMap = null;
let _satOverlay = null;
let _geoOrigin = null;
let _satVisible = false;
let _rendering = false;

function localWidthAt(poly, lx, ly, sx, sy, t) {
  const PROBE_W = 0.5;
  const slice = clipToStrip(poly, lx, ly, t - PROBE_W, t + PROBE_W);
  if (!slice || slice.length < 3) return 0;
  const ext = projectExtents(slice, sx, sy);
  return ext.max - ext.min;
}

function subdivideManzanoExact(mznPts, targetAreaM2, frontMinM, dirPref) {
  if (mznPts.length < 3) return [];
  const totalArea = polyAreaM2(mznPts);
  if (totalArea < targetAreaM2 * 0.15) return [];

  let lx, ly;
  if (dirPref && dirPref.ax !== undefined) {
    lx = dirPref.ax;
    ly = dirPref.ay;
  } else {
    const pa = principalAxis(mznPts);
    lx = pa.ux;
    ly = pa.uy;
  }
  const sx = -ly,
    sy = lx;

  const extS = projectExtents(mznPts, sx, sy);
  const nomDepthW = mw(targetAreaM2 / Math.max(frontMinM, 1));
  const totalDepthM = wm(extS.max - extS.min);
  const globalNarrow = totalDepthM < NARROW_RATIO * wm(nomDepthW);

  const extL = projectExtents(mznPts, lx, ly);
  const allLots = [];

  if (globalNarrow) {
    subdivideHalf(
      mznPts,
      lx,
      ly,
      sx,
      sy,
      extL,
      targetAreaM2,
      frontMinM,
      false,
      allLots,
    );
  } else {
    const sMid = (extS.min + extS.max) / 2;
    const halfBot = clipToStrip(mznPts, sx, sy, extS.min, sMid);
    const halfTop = clipToStrip(mznPts, sx, sy, sMid, extS.max);
    const halfBotOk =
      halfBot &&
      halfBot.length >= 3 &&
      polyAreaM2(halfBot) >= targetAreaM2 * 0.1;
    const halfTopOk =
      halfTop &&
      halfTop.length >= 3 &&
      polyAreaM2(halfTop) >= targetAreaM2 * 0.1;

    if (!halfBotOk && !halfTopOk) {
      subdivideHalf(
        mznPts,
        lx,
        ly,
        sx,
        sy,
        extL,
        targetAreaM2,
        frontMinM,
        false,
        allLots,
      );
    } else if (!halfBotOk) {
      const extLTop = projectExtents(halfTop, lx, ly);
      subdivideHalf(
        halfTop,
        lx,
        ly,
        sx,
        sy,
        extLTop,
        targetAreaM2,
        frontMinM,
        false,
        allLots,
      );
    } else if (!halfTopOk) {
      const extLBot = projectExtents(halfBot, lx, ly);
      subdivideHalf(
        halfBot,
        lx,
        ly,
        sx,
        sy,
        extLBot,
        targetAreaM2,
        frontMinM,
        false,
        allLots,
      );
    } else {
      const extLBot = projectExtents(halfBot, lx, ly);
      subdivideHalf(
        halfBot,
        lx,
        ly,
        sx,
        sy,
        extLBot,
        targetAreaM2,
        frontMinM,
        false,
        allLots,
      );
      const extLTop = projectExtents(halfTop, lx, ly);
      subdivideHalf(
        halfTop,
        lx,
        ly,
        sx,
        sy,
        extLTop,
        targetAreaM2,
        frontMinM,
        false,
        allLots,
      );
    }
  }
  return allLots;
}

function subdivideHalf(
  poly,
  lx,
  ly,
  sx,
  sy,
  extL,
  targetAreaM2,
  frontMinM,
  isRemnant,
  out,
) {
  let t = extL.min;
  let lotCount = 0;
  const extSH = projectExtents(poly, sx, sy);
  const halfDepthM = Math.max(wm(extSH.max - extSH.min), 0.001);
  const nomFrontM0 = Math.max(frontMinM, targetAreaM2 / halfDepthM);
  while (t < extL.max - 1e-9) {
    const remaining = extL.max - t;
    const restPoly = clipToStrip(poly, lx, ly, t, extL.max);
    if (!restPoly || restPoly.length < 3) break;
    const restArea = polyAreaM2(restPoly);
    const probeWidth = Math.min(mw(frontMinM) * 0.5, remaining * 0.1);
    const colProbe = clipToStrip(
      poly,
      lx,
      ly,
      t,
      t + Math.max(probeWidth, mw(0.5)),
    );
    let depthLocal = halfDepthM;
    if (colProbe && colProbe.length >= 3) {
      const eP = projectExtents(colProbe, sx, sy);
      const d = wm(eP.max - eP.min);
      if (d > 0.5) depthLocal = d;
    }
    const nomFrontM = Math.max(frontMinM, targetAreaM2 / depthLocal);
    const nomFrontW = mw(nomFrontM);
    const nRemaining = Math.round(remaining / nomFrontW);

    if (
      restArea < targetAreaM2 * 0.5 ||
      nRemaining <= 1 ||
      remaining - nomFrontW < nomFrontW * 0.05
    ) {
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
      if (!test || test.length < 3) {
        lo = mid;
        continue;
      }
      const area = polyAreaM2(test);
      const err = area - targetAreaM2;
      if (Math.abs(err) < Math.abs(bestErr)) {
        bestErr = err;
        bestF = mid;
      }
      if (Math.abs(err) <= 1e-6) break;
      if (err < 0) lo = mid;
      else hi = mid;
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

function subdivideManzanoAuto(mznPts, targetAreaM2, frontMinM, dirPref) {
  if (mznPts.length < 3) return [];
  const totalArea = polyAreaM2(mznPts);
  if (totalArea < targetAreaM2 * 0.15) return [];
  let lx, ly;
  if (dirPref && dirPref.ax !== undefined) {
    lx = dirPref.ax;
    ly = dirPref.ay;
  } else {
    const pa = principalAxis(mznPts);
    lx = pa.ux;
    ly = pa.uy;
  }
  const sx = -ly,
    sy = lx;
  const extS = projectExtents(mznPts, sx, sy);
  const extL = projectExtents(mznPts, lx, ly);
  const totalShortM = wm(extS.max - extS.min);
  const nomDepthM = targetAreaM2 / Math.max(frontMinM, 1);
  const isNarrow = totalShortM < NARROW_RATIO * nomDepthM;
  if (isNarrow) {
    return computeLotsOnHalf(
      mznPts,
      extL,
      extS,
      lx,
      ly,
      sx,
      sy,
      targetAreaM2,
      frontMinM,
    );
  }

  const sMid = (extS.min + extS.max) / 2;
  const halfBot = clipToStrip(mznPts, sx, sy, extS.min, sMid);
  const halfTop = clipToStrip(mznPts, sx, sy, sMid, extS.max);
  const halfBotOk =
    halfBot && halfBot.length >= 3 && polyAreaM2(halfBot) >= targetAreaM2 * 0.1;
  const halfTopOk =
    halfTop && halfTop.length >= 3 && polyAreaM2(halfTop) >= targetAreaM2 * 0.1;
  if (!halfBotOk && !halfTopOk) {
    return computeLotsOnHalf(
      mznPts,
      extL,
      extS,
      lx,
      ly,
      sx,
      sy,
      targetAreaM2,
      frontMinM,
    );
  }
  if (!halfBotOk) {
    const extLTop = projectExtents(halfTop, lx, ly);
    const extSTop = projectExtents(halfTop, sx, sy);
    return computeLotsOnHalf(
      halfTop,
      extLTop,
      extSTop,
      lx,
      ly,
      sx,
      sy,
      targetAreaM2,
      frontMinM,
    );
  }
  if (!halfTopOk) {
    const extLBot = projectExtents(halfBot, lx, ly);
    const extSBot = projectExtents(halfBot, sx, sy);
    return computeLotsOnHalf(
      halfBot,
      extLBot,
      extSBot,
      lx,
      ly,
      sx,
      sy,
      targetAreaM2,
      frontMinM,
    );
  }

  const extLBot = projectExtents(halfBot, lx, ly);
  const extLTop = projectExtents(halfTop, lx, ly);
  const spanBot = extLBot.max - extLBot.min;
  const spanTop = extLTop.max - extLTop.min;
  const masterIdx = spanTop > spanBot ? 1 : 0;
  const masterPoly = masterIdx === 0 ? halfBot : halfTop;
  const masterExt = masterIdx === 0 ? extLBot : extLTop;
  const extSMaster = projectExtents(masterPoly, sx, sy);
  const masterCuts = computeCuts(
    masterPoly,
    masterExt,
    lx,
    ly,
    sx,
    sy,
    targetAreaM2,
    frontMinM,
  );

  if (!masterCuts || masterCuts.length === 0) {
    const allLots = [];
    const extSBot2 = projectExtents(halfBot, sx, sy);
    allLots.push(
      ...computeLotsOnHalf(
        halfBot,
        extLBot,
        extSBot2,
        lx,
        ly,
        sx,
        sy,
        targetAreaM2,
        frontMinM,
      ),
    );
    const extSTop2 = projectExtents(halfTop, sx, sy);
    allLots.push(
      ...computeLotsOnHalf(
        halfTop,
        extLTop,
        extSTop2,
        lx,
        ly,
        sx,
        sy,
        targetAreaM2,
        frontMinM,
      ),
    );
    return allLots;
  }
  const allLots = [];
  for (const halfInfo of [
    { poly: halfBot, extL: extLBot },
    { poly: halfTop, extL: extLTop },
  ]) {
    const { poly: halfPoly, extL: halfExt } = halfInfo;
    const extSH = projectExtents(halfPoly, sx, sy);
    const realDepthM = Math.max(wm(extSH.max - extSH.min), 0.001);
    const myMin = halfExt.min,
      myMax = halfExt.max;
    let prevT = myMin;

    for (let ci = 0; ci < masterCuts.length; ci++) {
      const actualEnd = Math.min(masterCuts[ci].t, myMax);
      if (actualEnd <= prevT + 1e-6) continue;
      const stripPoly = clipToStrip(halfPoly, lx, ly, prevT, actualEnd);
      if (!stripPoly || stripPoly.length < 3) {
        prevT = actualEnd;
        continue;
      }
      const areaM2 = polyAreaM2(stripPoly);
      if (areaM2 < 0.5) {
        prevT = actualEnd;
        continue;
      }
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
function subdivideManzano(mznPts, targetAreaM2, frontMinM, dirPref, mznIdx) {
  const method = mznMethods[mznIdx] || "auto";
  if (method === "exact") {
    return subdivideManzanoExact(mznPts, targetAreaM2, frontMinM, dirPref);
  }
  return subdivideManzanoAuto(mznPts, targetAreaM2, frontMinM, dirPref);
}

function computeCuts(
  halfPoly,
  halfExt,
  lx,
  ly,
  sx,
  sy,
  targetAreaM2,
  frontMinM,
) {
  if (!halfPoly || !halfExt) return null;
  const extSH = projectExtents(halfPoly, sx, sy);
  const realDepthM = wm(extSH.max - extSH.min);
  if (realDepthM < 0.001) return null;
  const nomFrontM = Math.max(frontMinM, targetAreaM2 / realDepthM);
  const cuts = [];
  let t = halfExt.min,
    lotCount = 0;
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
      cuts.push({
        t: halfExt.max,
        isRemnant: restAreaM2 < targetAreaM2 * 0.5,
      });
      break;
    }

    let lo = mw(frontMinM),
      hi = remaining * 0.999;
    let bestF = nomFrontW;
    let bestErr = Infinity;

    for (let iter = 0; iter < 120; iter++) {
      const mid = (lo + hi) / 2;
      const testPoly = clipToStrip(halfPoly, lx, ly, t, t + mid);
      if (!testPoly || testPoly.length < 3) {
        lo = mid;
        continue;
      }
      const area = polyAreaM2(testPoly);
      const err = area - targetAreaM2;
      if (Math.abs(err) < Math.abs(bestErr)) {
        bestErr = err;
        bestF = mid;
      }
      if (Math.abs(err) <= 1e-6) break;
      if (err < 0) lo = mid;
      else hi = mid;
    }

    if (wm(bestF) < frontMinM * 0.99) bestF = mw(frontMinM);
    t += bestF;
    cuts.push({ t, isRemnant: false });
    if (++lotCount > 500) break;
  }
  return cuts;
}

function computeLotsOnHalf(
  fullPoly,
  extL,
  extS,
  lx,
  ly,
  sx,
  sy,
  targetAreaM2,
  frontMinM,
) {
  const cuts = computeCuts(
    fullPoly,
    extL,
    lx,
    ly,
    sx,
    sy,
    targetAreaM2,
    frontMinM,
  );
  if (!cuts) return [];
  const lots = [];
  let prevT = extL.min;
  for (let ci = 0; ci < cuts.length; ci++) {
    const actualEnd = Math.min(cuts[ci].t, extL.max);
    if (actualEnd <= prevT + 1e-6) break;
    const stripPoly = clipToStrip(fullPoly, lx, ly, prevT, actualEnd);
    if (!stripPoly || stripPoly.length < 3) {
      prevT = actualEnd;
      continue;
    }
    const areaM2 = polyAreaM2(stripPoly);
    if (areaM2 < 1e-6) {
      prevT = actualEnd;
      continue;
    }
    const extSH = projectExtents(stripPoly, sx, sy);
    const depthM2 = wm(extSH.max - extSH.min);
    lots.push({
      pts: stripPoly,
      isRemnant: cuts[ci].isRemnant || areaM2 < targetAreaM2 * 0.5,
      frontM: wm(actualEnd - prevT),
      depthM: depthM2 > 0 ? depthM2 : wm(extS.max - extS.min),
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

function setMznMethod(mznIdx, method) {
  _snapshot();
  mznMethods[mznIdx] = method;
  const targetArea = parseFloat(document.getElementById("lpArea").value) || 250;
  const frontMin = parseFloat(document.getElementById("lpFront").value) || 12;
  const dir = document.getElementById("lpDir").value;
  const existing = lotSubdivisions.find((s) => s.mznIdx === mznIdx);
  if (existing) {
    const segDir =
      dir === "seg" && mznSegments[mznIdx] ? mznSegments[mznIdx] : null;
    const sliceSubs = sliceLots.filter((sd) => sd.mznIdx === mznIdx);
    let basePoly = manzanos[mznIdx].pts;
    if (sliceSubs.length > 0) {
      const subtracted = subtractSliceSubMznos(manzanos[mznIdx].pts, sliceSubs);
      if (!subtracted || subtracted.length < 3) {
        existing.lots = [];
        updateSidebar();
        render();
        return;
      }
      basePoly = subtracted;
    }

    existing.lots = subdivideManzano(
      basePoly,
      targetArea,
      frontMin,
      segDir,
      mznIdx,
    );
    updateSidebar();
    render();
  }
}

function subtractSliceSubMznos(basePts, sliceSubs) {
  if (!sliceSubs || sliceSubs.length === 0) return basePts;
  let remaining = basePts.map((p) => ({ ...p }));
  for (const sliceSub of sliceSubs) {
    const subPoly = sliceSub.subMznPts;
    if (!subPoly || subPoly.length < 3) continue;
    if (!polysOverlap(remaining, subPoly)) continue;
    const cenSub = centroid(subPoly);
    let best = null;
    let bestArea = -1;
    const n = subPoly.length;
    for (let e = 0; e < n; e++) {
      const a = subPoly[e];
      const b = subPoly[(e + 1) % n];
      for (const keepSide of [+1, -1]) {
        const frag = clipHalfPlane(remaining, a, b, keepSide);
        if (!frag || frag.length < 3) continue;
        const cenFrag = centroid(frag);
        if (slicePtInPoly(cenFrag.x, cenFrag.y, subPoly)) continue;
        if (slicePtInPoly(cenSub.x, cenSub.y, frag)) continue;
        const fa = polyArea(frag);
        if (fa > bestArea) {
          bestArea = fa;
          best = frag;
        }
      }
    }

    if (!best || best.length < 3) {
      for (let e = 0; e < n && !best; e++) {
        const a = subPoly[e];
        const b = subPoly[(e + 1) % n];
        for (const keepSide of [+1, -1]) {
          const frag = clipHalfPlane(remaining, a, b, keepSide);
          if (!frag || frag.length < 3) continue;
          const cenFrag = centroid(frag);
          if (!slicePtInPoly(cenFrag.x, cenFrag.y, subPoly)) {
            const fa = polyArea(frag);
            if (fa > bestArea) {
              bestArea = fa;
              best = frag;
            }
          }
        }
      }
    }

    if (!best || best.length < 3) return null;
    remaining = best;
  }

  return remaining && remaining.length >= 3 ? remaining : null;
}

function applyLots() {
  _snapshot();
  const targetArea = parseFloat(document.getElementById("lpArea").value) || 250;
  const frontMin = parseFloat(document.getElementById("lpFront").value) || 12;
  const dir = document.getElementById("lpDir").value;

  lotSubdivisions = [];
  for (let i = 0; i < manzanos.length; i++) {
    const mzn = manzanos[i];
    const mznArea = polyAreaM2(mzn.pts);

    if (mznArea < 1.0) {
      lotSubdivisions.push({ mznIdx: i, lots: [] });
      continue;
    }

    if (mznEquipamiento[i]) {
      lotSubdivisions.push({ mznIdx: i, lots: [] });
      continue;
    }

    const segDir = dir === "seg" && mznSegments[i] ? mznSegments[i] : null;
    const sliceSubs = sliceLots.filter((sd) => sd.mznIdx === i);
    let basePoly = mzn.pts;

    if (sliceSubs.length > 0) {
      const subtracted = subtractSliceSubMznos(mzn.pts, sliceSubs);
      if (
        !subtracted ||
        subtracted.length < 3 ||
        polyAreaM2(subtracted) < 1.0
      ) {
        lotSubdivisions.push({ mznIdx: i, lots: [] });
        continue;
      }
      basePoly = subtracted;
    }

    const lots = subdivideManzano(basePoly, targetArea, frontMin, segDir, i);
    lotSubdivisions.push({ mznIdx: i, lots });
  }
  updateSidebar();
  updateStatsPanel();
  render();
}

function clearLots() {
  _snapshot();
  lotSubdivisions = [];
  sliceLots = [];
  sliceSubMzn = null;
  sliceSubPhase = "none";
  sliceSelectingFrente = null;
  sliceSelectingAux = null;
  sliceAdjacentSegs = [];
  slicePickingSeg = false;
  sliceCutDirX = null;
  sliceCutDirY = null;
  sliceFrenteMidX = null;
  sliceFrenteMidY = null;
  mznSegments = {};
  mznMethods = {};
  pickingSegForMzn = -1;
  document.getElementById("segHint").style.display = "none";
  document.getElementById("lpDir").value = "auto";
  document.getElementById("slicePhaseA").style.display = "";
  document.getElementById("slicePhaseB").style.display = "none";
  document.getElementById("slicePhaseC").style.display = "none";
  document.getElementById("slicePhaseD").style.display = "none";
  document.getElementById("sliceSegHint").style.display = "none";
  document.getElementById("sliceSegInfo").style.display = "none";
  updateLpCalc();
  updateSidebar();
  updateStatsPanel();
  render();
}

function toggleLotList(id) {
  const list = document.getElementById(id);
  const mznIdx = id.replace("lotlist-", "");
  const arrow = document.getElementById("lotlist-arrow-" + mznIdx);
  if (!list) return;
  const isOpen = list.style.display !== "none";
  list.style.display = isOpen ? "none" : "block";
  if (arrow) arrow.style.transform = isOpen ? "" : "rotate(90deg)";
}

