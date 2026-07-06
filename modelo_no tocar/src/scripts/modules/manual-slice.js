// =====================================================================
// MÓDULO 15/17 · 15-manual-slice.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 03-state.js, 09-polygon-engine.js, 10-lot-subdivision.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [15] SUBDIVISIÓN MANUAL (slice) — sub-manzanos definidos a mano
// (candidato a módulo: manual-slice.js · depende de: [3],[9],[10])
// =====================================================================
function slicePtInPoly(x, y, poly) {
  let inside = false,
    n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y,
      xj = poly[j].x,
      yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function sliceSegIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x,
    d1y = p2.y - p1.y,
    d2x = p4.x - p3.x,
    d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  if (t > -1e-9 && t < 1 + 1e-9 && u > -1e-9 && u < 1 + 1e-9)
    return { x: p1.x + t * d1x, y: p1.y + t * d1y, t, u };
  return null;
}

function sliceBuildPolys(wp, hA, hB) {
  const n = wp.length,
    ins = {};
  function addIns(si, u, pt, role) {
    if (!ins[si]) ins[si] = [];
    ins[si].push({ u, pt, role });
  }
  addIns(hA.segIdx, Math.max(0, Math.min(1, hA.u)), { x: hA.x, y: hA.y }, "A");
  addIns(hB.segIdx, Math.max(0, Math.min(1, hB.u)), { x: hB.x, y: hB.y }, "B");
  for (const k of Object.keys(ins)) ins[k].sort((a, b) => a.u - b.u);
  const verts = [];
  for (let i = 0; i < n; i++) {
    verts.push({ pt: wp[i], role: "orig" });
    if (ins[i]) for (const x of ins[i]) verts.push({ pt: x.pt, role: x.role });
  }
  let idxA = -1,
    idxB = -1;
  for (let i = 0; i < verts.length; i++) {
    if (verts[i].role === "A") idxA = i;
    if (verts[i].role === "B") idxB = i;
  }
  if (idxA < 0 || idxB < 0) return null;
  const lv = verts.length,
    p1 = [],
    p2 = [];
  let i = idxA,
    st = 0;
  do {
    p1.push(verts[i].pt);
    i = (i + 1) % lv;
    st++;
  } while (i !== idxB && st <= lv + 2);
  p1.push(verts[idxB].pt);
  i = idxB;
  st = 0;
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
    cutA: { x: hA.x, y: hA.y },
    cutB: { x: hB.x, y: hB.y },
  };
}

function sliceBuildCutAndSlice(wp, t, selSeg, auxS) {
  const ax = auxS.b.x - auxS.a.x,
    ay = auxS.b.y - auxS.a.y;
  const len = Math.hypot(ax, ay);
  if (len < 1e-10) return null;
  const nx = -ay / len,
    ny = ax / len;
  const ox = auxS.a.x + t * ax,
    oy = auxS.a.y + t * ay;
  const FAR = 1e7;
  const rA = { x: ox + nx * FAR, y: oy + ny * FAR },
    rB = { x: ox - nx * FAR, y: oy - ny * FAR };
  const n = wp.length,
    hits = [];
  for (let i = 0; i < n; i++) {
    const a = wp[i],
      b = wp[(i + 1) % n];
    const isect = sliceSegIntersect(rA, rB, a, b);
    if (!isect) continue;
    hits.push({
      x: isect.x,
      y: isect.y,
      segIdx: i,
      u: Math.max(0, Math.min(1, isect.u)),
      tCut: isect.t,
    });
  }
  if (hits.length < 2) return null;
  hits.sort((a, b) => a.tCut - b.tCut);
  const ded = [];
  for (const h of hits) {
    if (
      !ded.length ||
      Math.hypot(h.x - ded[ded.length - 1].x, h.y - ded[ded.length - 1].y) >
        1e-4
    )
      ded.push(h);
  }
  if (ded.length < 2) return null;
  let chosenA = null,
    chosenB = null;
  for (let i = 0; i < ded.length - 1; i++) {
    const hA = ded[i],
      hB = ded[i + 1];
    const mx = (hA.x + hB.x) / 2,
      my = (hA.y + hB.y) / 2;
    if (!slicePtInPoly(mx, my, wp)) continue;
    const sl = sliceBuildPolys(wp, hA, hB);
    if (!sl) continue;
    if (
      slicePolyContainsSeg(sl.poly1, selSeg) ||
      slicePolyContainsSeg(sl.poly2, selSeg)
    ) {
      chosenA = hA;
      chosenB = hB;
      break;
    }
  }
  if (!chosenA) {
    for (let i = 0; i < ded.length - 1; i++) {
      const hA = ded[i],
        hB = ded[i + 1];
      const mx = (hA.x + hB.x) / 2,
        my = (hA.y + hB.y) / 2;
      if (!slicePtInPoly(mx, my, wp)) continue;
      const sl = sliceBuildPolys(wp, hA, hB);
      if (sl) {
        chosenA = hA;
        chosenB = hB;
        break;
      }
    }
  }
  if (!chosenA) return null;
  const sl = sliceBuildPolys(wp, chosenA, chosenB);
  if (!sl) return null;
  return {
    cutA: { x: chosenA.x, y: chosenA.y },
    cutB: { x: chosenB.x, y: chosenB.y },
    slice: sl,
  };
}

function slicePolyContainsSeg(poly, seg) {
  const tests = [
    { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 },
    {
      x: seg.a.x * 0.8 + seg.b.x * 0.2,
      y: seg.a.y * 0.8 + seg.b.y * 0.2,
    },
    {
      x: seg.a.x * 0.2 + seg.b.x * 0.8,
      y: seg.a.y * 0.2 + seg.b.y * 0.8,
    },
  ];
  let v = 0;
  for (const p of tests) if (slicePtInPoly(p.x, p.y, poly)) v++;
  return v >= 2;
}

function sliceBisectManzano(wp, targetAreaM2, selSeg, auxS) {
  const TOL_M2 = 1e-6;
  const totalArea = polyAreaM2(wp);
  const auxDx = auxS.b.x - auxS.a.x;
  const auxDy = auxS.b.y - auxS.a.y;
  const auxLen = Math.hypot(auxDx, auxDy);
  if (auxLen < 1e-10) return null;
  const advX = auxDx / auxLen;
  const advY = auxDy / auxLen;
  const cutX = -auxDy / auxLen;
  const cutY = auxDx / auxLen;
  const cen = centroid(wp);
  const cenAdvProj = cen.x * advX + cen.y * advY;
  const projs = wp.map((p) => p.x * advX + p.y * advY);
  const projMin = Math.min(...projs);
  const projMax = Math.max(...projs);
  const projRange = projMax - projMin;
  if (projRange < 1e-9) return null;
  const N_FRENTE = 11;
  const frentePoints = [];
  for (let k = 0; k <= N_FRENTE; k++) {
    frentePoints.push({
      x: selSeg.a.x + ((selSeg.b.x - selSeg.a.x) * k) / N_FRENTE,
      y: selSeg.a.y + ((selSeg.b.y - selSeg.a.y) * k) / N_FRENTE,
    });
  }

  const frenteAdvProjs = frentePoints.map((p) => p.x * advX + p.y * advY);
  const frenteProjMed =
    (Math.min(...frenteAdvProjs) + Math.max(...frenteAdvProjs)) / 2;
  const frenteEsMin =
    Math.abs(frenteProjMed - projMin) <= Math.abs(frenteProjMed - projMax);
  function fragmentContainsFronte(poly) {
    let cnt = 0;
    for (const p of frentePoints) {
      if (slicePtInPoly(p.x, p.y, poly)) cnt++;
    }
    return cnt >= Math.ceil(frentePoints.length * 0.5);
  }

  function evalT(t) {
    const proj = frenteEsMin
      ? projMin + t * projRange
      : projMax - t * projRange;
    const ox = cen.x + (proj - cenAdvProj) * advX;
    const oy = cen.y + (proj - cenAdvProj) * advY;
    const FAR = 1e7;
    const rA = { x: ox + cutX * FAR, y: oy + cutY * FAR };
    const rB = { x: ox - cutX * FAR, y: oy - cutY * FAR };
    const n = wp.length;
    const rawHits = [];
    for (let i = 0; i < n; i++) {
      const a = wp[i],
        b = wp[(i + 1) % n];
      const isect = sliceSegIntersect(rA, rB, a, b);
      if (!isect) continue;
      rawHits.push({
        x: isect.x,
        y: isect.y,
        segIdx: i,
        u: Math.max(0, Math.min(1, isect.u)),
        tCut: isect.t,
      });
    }
    if (rawHits.length < 2) return null;
    rawHits.sort((a, b) => a.tCut - b.tCut);

    const hits = [rawHits[0]];
    for (let i = 1; i < rawHits.length; i++) {
      if (
        Math.hypot(
          rawHits[i].x - hits[hits.length - 1].x,
          rawHits[i].y - hits[hits.length - 1].y,
        ) > 1e-6
      )
        hits.push(rawHits[i]);
    }
    if (hits.length < 2) return null;
    for (let i = 0; i < hits.length - 1; i++) {
      const hA = hits[i],
        hB = hits[i + 1];
      const mx = (hA.x + hB.x) / 2,
        my = (hA.y + hB.y) / 2;
      if (!slicePtInPoly(mx, my, wp)) continue;
      const sl = sliceBuildPolys(wp, hA, hB);
      if (!sl || sl.poly1.length < 3 || sl.poly2.length < 3) continue;
      const p1HasF = fragmentContainsFronte(sl.poly1);
      const p2HasF = fragmentContainsFronte(sl.poly2);
      let front, rest;
      if (p1HasF && !p2HasF) {
        front = sl.poly1;
        rest = sl.poly2;
      } else if (p2HasF && !p1HasF) {
        front = sl.poly2;
        rest = sl.poly1;
      } else {
        const fMX = (selSeg.a.x + selSeg.b.x) / 2;
        const fMY = (selSeg.a.y + selSeg.b.y) / 2;
        const d1 = Math.hypot(
          centroid(sl.poly1).x - fMX,
          centroid(sl.poly1).y - fMY,
        );
        const d2 = Math.hypot(
          centroid(sl.poly2).x - fMX,
          centroid(sl.poly2).y - fMY,
        );
        front = d1 <= d2 ? sl.poly1 : sl.poly2;
        rest = d1 <= d2 ? sl.poly2 : sl.poly1;
      }
      return { front, rest, areaM2: polyAreaM2(front) };
    }
    return null;
  }

  const N_SAMPLES = 50;
  const samples = [];
  for (let k = 1; k < N_SAMPLES; k++) {
    const t = k / N_SAMPLES;
    const ev = evalT(t);
    if (ev !== null) samples.push({ t, areaM2: ev.areaM2 });
  }
  if (samples.length === 0) return null;
  const crosses = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i],
      s1 = samples[i + 1];
    const diff0 = s0.areaM2 - targetAreaM2;
    const diff1 = s1.areaM2 - targetAreaM2;
    if (diff0 * diff1 <= 0) {
      const errMid = Math.min(Math.abs(diff0), Math.abs(diff1));
      crosses.push({ lo: s0.t, hi: s1.t, errMid });
    }
  }

  let bestLo, bestHi;
  if (crosses.length === 0) {
    let bestSample = samples[0],
      bestErr2 = Infinity;
    for (const s of samples) {
      const e = Math.abs(s.areaM2 - targetAreaM2);
      if (e < bestErr2) {
        bestErr2 = e;
        bestSample = s;
      }
    }
    return evalT(bestSample.t);
  }

  if (crosses.length === 1) {
    bestLo = crosses[0].lo;
    bestHi = crosses[0].hi;
  } else {
    let bestScore = Infinity;
    for (const cr of crosses) {
      const tMid = (cr.lo + cr.hi) / 2;
      const evMid = evalT(tMid);
      if (!evMid) continue;
      const relErr = Math.abs(evMid.areaM2 - targetAreaM2) / totalArea;
      const tPenalty = Math.abs(tMid - 0.5) * 0.05;
      const score = relErr + tPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestLo = cr.lo;
        bestHi = cr.hi;
      }
    }
    if (bestLo === undefined) {
      bestLo = crosses[0].lo;
      bestHi = crosses[0].hi;
    }
  }
  const evLo0 = evalT(bestLo);
  if (!evLo0) return evalT((bestLo + bestHi) / 2);
  const increasing = evLo0.areaM2 < targetAreaM2;
  let lo = bestLo,
    hi = bestHi;
  let best = null,
    bestErr = Infinity;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const ev = evalT(mid);
    if (!ev) {
      const evQ1 = evalT(lo + (mid - lo) * 0.5);
      const evQ2 = evalT(mid + (hi - mid) * 0.5);
      if (evQ1 && Math.abs(evQ1.areaM2 - targetAreaM2) < bestErr) {
        bestErr = Math.abs(evQ1.areaM2 - targetAreaM2);
        best = evQ1;
      }
      if (evQ2 && Math.abs(evQ2.areaM2 - targetAreaM2) < bestErr) {
        bestErr = Math.abs(evQ2.areaM2 - targetAreaM2);
        best = evQ2;
      }
      if (evQ1) hi = mid;
      else if (evQ2) lo = mid;
      else break;
      continue;
    }
    const err = Math.abs(ev.areaM2 - targetAreaM2);
    if (err < bestErr) {
      bestErr = err;
      best = ev;
    }
    if (err <= TOL_M2) break;
    const errSigned = ev.areaM2 - targetAreaM2;
    if (increasing ? errSigned < 0 : errSigned > 0) lo = mid;
    else hi = mid;
  }

  return best;
}

function sliceBisectLote(
  wp,
  targetAreaM2,
  cutDirX,
  cutDirY,
  frenteMidX,
  frenteMidY,
) {
  const TOL_M2 = 1e-6;
  const perpX = -cutDirY,
    perpY = cutDirX;
  const projs = wp.map((p) => p.x * perpX + p.y * perpY);
  const pMin = Math.min(...projs),
    pMax = Math.max(...projs);
  const pRange = pMax - pMin;
  if (pRange < 1e-9) return null;
  const cen = centroid(wp);
  const cenPerpProj = cen.x * perpX + cen.y * perpY;
  const fProj = frenteMidX * perpX + frenteMidY * perpY;
  const frenteEsMin = Math.abs(fProj - pMin) <= Math.abs(fProj - pMax);
  const bordeFrenteProj = frenteEsMin ? pMin : pMax;
  const tol = pRange * 0.15;
  const frenteVerts = wp.filter(
    (p) => Math.abs(p.x * perpX + p.y * perpY - bordeFrenteProj) < tol,
  );
  const frenteRefPts =
    frenteVerts.length >= 2 ? frenteVerts : [{ x: frenteMidX, y: frenteMidY }];
  function fragmentContainsFronte(poly) {
    let inside = 0;
    for (const p of frenteRefPts) {
      if (slicePtInPoly(p.x, p.y, poly)) inside++;
    }
    return inside >= Math.ceil(frenteRefPts.length * 0.5);
  }

  function evalT(t) {
    const proj = frenteEsMin ? pMin + t * pRange : pMax - t * pRange;
    const ox = cen.x + (proj - cenPerpProj) * perpX;
    const oy = cen.y + (proj - cenPerpProj) * perpY;
    const FAR = 1e7;
    const rA = { x: ox + cutDirX * FAR, y: oy + cutDirY * FAR };
    const rB = { x: ox - cutDirX * FAR, y: oy - cutDirY * FAR };
    const n = wp.length;
    const rawHits = [];
    for (let i = 0; i < n; i++) {
      const a = wp[i],
        b = wp[(i + 1) % n];
      const isect = sliceSegIntersect(rA, rB, a, b);
      if (!isect) continue;
      rawHits.push({
        x: isect.x,
        y: isect.y,
        segIdx: i,
        u: Math.max(0, Math.min(1, isect.u)),
        tCut: isect.t,
      });
    }
    if (rawHits.length < 2) return null;
    rawHits.sort((a, b) => a.tCut - b.tCut);
    const hits = [rawHits[0]];
    for (let i = 1; i < rawHits.length; i++) {
      if (
        Math.hypot(
          rawHits[i].x - hits[hits.length - 1].x,
          rawHits[i].y - hits[hits.length - 1].y,
        ) > 1e-6
      ) {
        hits.push(rawHits[i]);
      }
    }
    if (hits.length < 2) return null;
    for (let i = 0; i < hits.length - 1; i++) {
      const hA = hits[i],
        hB = hits[i + 1];
      const mx = (hA.x + hB.x) / 2,
        my = (hA.y + hB.y) / 2;
      if (!slicePtInPoly(mx, my, wp)) continue;
      const sl = sliceBuildPolys(wp, hA, hB);
      if (!sl || sl.poly1.length < 3 || sl.poly2.length < 3) continue;
      const p1HasFronte = fragmentContainsFronte(sl.poly1);
      const p2HasFronte = fragmentContainsFronte(sl.poly2);
      let front, rest;
      if (p1HasFronte && !p2HasFronte) {
        front = sl.poly1;
        rest = sl.poly2;
      } else if (p2HasFronte && !p1HasFronte) {
        front = sl.poly2;
        rest = sl.poly1;
      } else {
        const d1 = Math.hypot(
          centroid(sl.poly1).x - frenteMidX,
          centroid(sl.poly1).y - frenteMidY,
        );
        const d2 = Math.hypot(
          centroid(sl.poly2).x - frenteMidX,
          centroid(sl.poly2).y - frenteMidY,
        );
        front = d1 <= d2 ? sl.poly1 : sl.poly2;
        rest = d1 <= d2 ? sl.poly2 : sl.poly1;
      }

      return { front, rest, areaM2: polyAreaM2(front) };
    }
    return null;
  }

  const samples = [];
  for (let k = 1; k <= 24; k++) {
    const t = k / 25;
    const ev = evalT(t);
    if (ev) samples.push({ t, areaM2: ev.areaM2 });
  }
  if (samples.length === 0) return null;
  let bestLo = null,
    bestHi = null;
  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i],
      s1 = samples[i + 1];
    if ((s0.areaM2 - targetAreaM2) * (s1.areaM2 - targetAreaM2) <= 0) {
      bestLo = s0.t;
      bestHi = s1.t;
      break;
    }
  }

  if (bestLo === null) {
    let bestSample = samples[0],
      bestErr = Infinity;
    for (const s of samples) {
      const err = Math.abs(s.areaM2 - targetAreaM2);
      if (err < bestErr) {
        bestErr = err;
        bestSample = s;
      }
    }
    return evalT(bestSample.t);
  }

  let lo = bestLo,
    hi = bestHi;
  const evLo0 = evalT(lo);
  const increasing = evLo0 ? evLo0.areaM2 < targetAreaM2 : true;
  let best = null,
    bestErr = Infinity;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    const ev = evalT(mid);
    if (!ev) {
      const evQ1 = evalT(lo + (mid - lo) * 0.5);
      const evQ2 = evalT(mid + (hi - mid) * 0.5);
      if (evQ1) {
        hi = mid;
        if (Math.abs(evQ1.areaM2 - targetAreaM2) < bestErr) {
          bestErr = Math.abs(evQ1.areaM2 - targetAreaM2);
          best = evQ1;
        }
      } else if (evQ2) {
        lo = mid;
        if (Math.abs(evQ2.areaM2 - targetAreaM2) < bestErr) {
          bestErr = Math.abs(evQ2.areaM2 - targetAreaM2);
          best = evQ2;
        }
      } else break;
      continue;
    }
    const err = Math.abs(ev.areaM2 - targetAreaM2);
    if (err < bestErr) {
      bestErr = err;
      best = ev;
    }
    if (err <= TOL_M2) break;
    const errSigned = ev.areaM2 - targetAreaM2;
    if (increasing ? errSigned < 0 : errSigned > 0) lo = mid;
    else hi = mid;
  }
  return best;
}

function sliceCalcFrenteM(pts, cutDirX, cutDirY) {
  const projs = pts.map((p) => p.x * cutDirX + p.y * cutDirY);
  return wm(Math.max(...projs) - Math.min(...projs));
}

function populateSliceMznSel() {
  const sel = document.getElementById("sliceMznSel");
  sel.innerHTML = "";
  manzanos.forEach((mz, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${t("mzoPrefix")} ${i + 1}  (${polyAreaM2(mz.pts).toFixed(1)} m²)`;
    sel.appendChild(opt);
  });
  if (sliceMznIdx < 0 || sliceMznIdx >= manzanos.length) sliceMznIdx = 0;
  sel.value = sliceMznIdx;
  const mzn = manzanos[sliceMznIdx];
  if (mzn)
    document.getElementById("sliceTargetArea").value = Math.round(
      polyAreaM2(mzn.pts) * 0.5,
    );
  updateSliceCalc();
}

function onSliceMznChange() {
  sliceMznIdx = parseInt(document.getElementById("sliceMznSel").value);
  const mzn = manzanos[sliceMznIdx];
  if (mzn)
    document.getElementById("sliceTargetArea").value = Math.round(
      polyAreaM2(mzn.pts) * 0.5,
    );
  sliceResetState();
  updateSliceCalc();
  render();
}

function sliceResetState() {
  sliceSubPhase = "none";
  sliceSelectingFrente = null;
  sliceSelectingAux = null;
  sliceAdjacentSegs = [];
  sliceSubMzn = null;
  slicePickingSeg = false;
  sliceCutDirX = null;
  sliceCutDirY = null;
  sliceFrenteMidX = null;
  sliceFrenteMidY = null;
  sliceCutLineMode = false;
  sliceCutLineStep = 0;
  sliceCutLineP1 = null;
  sliceCutLineP2 = null;
  document.getElementById("slicePhaseA").style.display = "";
  document.getElementById("slicePhaseB").style.display = "none";
  document.getElementById("slicePhaseC").style.display = "none";
  document.getElementById("slicePhaseD").style.display = "none";
  document.getElementById("sliceSegHint").style.display = "none";
  document.getElementById("sliceSegInfo").style.display = "none";
  document.getElementById("slicePhaseCHintAux").style.display = "";
  document.getElementById("slicePhaseCHintLine").style.display = "none";
  document.getElementById("btnSliceCutLine").style.display = "";
}

function onSliceModeChange() {
  const m = document.getElementById("sliceMode").value;
  document.getElementById("sliceNGroup").style.display =
    m === "equal" ? "" : "none";
  document.getElementById("sliceAreasGroup").style.display =
    m === "custom" ? "" : "none";
  updateSliceCalc();
}

function updateSliceCalc() {
  const el = document.getElementById("sliceCalcInfo");
  if (sliceMznIdx < 0 || sliceMznIdx >= manzanos.length) {
    el.innerHTML = "";
    return;
  }
  const mzn = manzanos[sliceMznIdx];
  const totalM2 = polyAreaM2(mzn.pts);
  const targetM2 =
    parseFloat(document.getElementById("sliceTargetArea").value) || 0;
  let html = `<div style="color:#8b949e">Área manzano: <span style="color:#3fb950">${totalM2.toFixed(1)} m²</span></div>`;
  html += `<div style="color:#8b949e">Área sub-manzano: <span style="color:${targetM2 > totalM2 ? "#f85149" : "#d2a8ff"}">${targetM2.toFixed(1)} m²</span></div>`;
  el.innerHTML = html;
}

function sliceStartFrente() {
  if (sliceMznIdx < 0 || sliceMznIdx >= manzanos.length) return;
  const targetM2 =
    parseFloat(document.getElementById("sliceTargetArea").value) || 0;
  if (targetM2 <= 0 || targetM2 >= polyAreaM2(manzanos[sliceMznIdx].pts)) {
    alert(t("alertSubAreaInv"));
    return;
  }
  sliceSubPhase = "pickFrente";
  sliceSelectingFrente = null;
  sliceAdjacentSegs = [];
  document.getElementById("slicePhaseA").style.display = "none";
  document.getElementById("slicePhaseB").style.display = "";
  render();
}

function sliceCancelFrente() {
  sliceResetState();
  render();
}

function sliceRunBisectManzano() {
  const mzn = manzanos[sliceMznIdx];
  const targetM2 =
    parseFloat(document.getElementById("sliceTargetArea").value) || 0;
  const result = sliceBisectManzano(
    mzn.pts,
    targetM2,
    sliceSelectingFrente,
    sliceSelectingAux,
  );
  if (!result) {
    alert(t("alertCorteError"));
    sliceResetState();
    render();
    return;
  }
  sliceSubMzn = { pts: result.front, mznIdx: sliceMznIdx };
  sliceSubPhase = "ready";
  const areaM2 = polyAreaM2(result.front);
  document.getElementById("slicePhaseC").style.display = "none";
  document.getElementById("slicePhaseD").style.display = "";
  document.getElementById("sliceSubMznInfo").textContent =
    `✓ ${t("sliceMznBase")}: ${areaM2.toFixed(1)} m²`;
  updateSliceCalc();
  render();
}

function startSliceCutLine() {
  sliceCutLineMode = true;
  sliceCutLineStep = 0;
  sliceCutLineP1 = null;
  sliceCutLineP2 = null;
  document.getElementById("slicePhaseCHintAux").style.display = "none";
  document.getElementById("slicePhaseCHintLine").style.display = "";
  document.getElementById("sliceCutLineStepTxt").textContent =
    t("sliceHintLinea");
  document.getElementById("btnSliceCutLine").style.display = "none";
  render();
}

function sliceRunBisectManzanoFromLine() {
  const mzn = manzanos[sliceMznIdx];
  const targetM2 =
    parseFloat(document.getElementById("sliceTargetArea").value) || 0;
  const dx = sliceCutLineP2.x - sliceCutLineP1.x;
  const dy = sliceCutLineP2.y - sliceCutLineP1.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-10) {
    alert(t("alertLineaCorta"));
    return;
  }
  const fakeAuxS = {
    a: { x: 0, y: 0 },
    b: { x: -dy / len, y: dx / len },
  };
  const result = sliceBisectManzano(
    mzn.pts,
    targetM2,
    sliceSelectingFrente,
    fakeAuxS,
  );
  if (!result) {
    alert(t("alertCorteError2"));
    sliceResetState();
    render();
    return;
  }
  sliceSubMzn = { pts: result.front, mznIdx: sliceMznIdx };
  sliceSubPhase = "ready";
  const areaM2 = polyAreaM2(result.front);
  document.getElementById("slicePhaseC").style.display = "none";
  document.getElementById("slicePhaseD").style.display = "";
  document.getElementById("sliceSubMznInfo").textContent =
    `✓ ${t("sliceMznBase")}: ${areaM2.toFixed(1)} m²`;

  sliceCutDirX = -dy / len;
  sliceCutDirY = dx / len;
  sliceFrenteMidX = (sliceCutLineP1.x + sliceCutLineP2.x) / 2;
  sliceFrenteMidY = (sliceCutLineP1.y + sliceCutLineP2.y) / 2;
  slicePickingSeg = false;
  document.getElementById("sliceSegInfo").style.display = "";
  document.getElementById("sliceSegHint").style.display = "none";

  updateSliceCalc();
  render();
}

function _slicePerpSnap(cp, pts) {
  const n = pts.length;
  let bestDist = Infinity,
    bestFoot = null;
  for (let i = 0; i < n; i++) {
    const a = pts[i],
      b = pts[(i + 1) % n];
    const ac = toC(a.x, a.y),
      bc = toC(b.x, b.y);
    const ddx = bc.x - ac.x,
      ddy = bc.y - ac.y;
    const lenSq = ddx * ddx + ddy * ddy;
    if (lenSq < 1e-10) continue;
    const t = Math.max(
      0,
      Math.min(1, ((cp.x - ac.x) * ddx + (cp.y - ac.y) * ddy) / lenSq),
    );
    const foot = { x: ac.x + t * ddx, y: ac.y + t * ddy };
    const d = Math.hypot(cp.x - foot.x, cp.y - foot.y);
    if (d < bestDist) {
      bestDist = d;
      bestFoot = foot;
    }
  }
  return bestDist < 28 ? bestFoot : null; // radio de snap en px
}

function startSliceSegPick() {
  if (!sliceSubMzn) return;
  slicePickingSeg = true;
  sliceCutDirX = null;
  sliceCutDirY = null;
  document.getElementById("sliceSegInfo").style.display = "none";
  document.getElementById("sliceSegHint").style.display = "";
  render();
}

function clearSliceLots() {
  sliceLots = sliceLots.filter((sd) => sd.mznIdx !== sliceMznIdx);
  sliceResetState();
  updateSidebar();
  render();
}

function sliceDeleteSubMzn(mznIdx, subIdx) {
  const subs = sliceLots.filter((sd) => sd.mznIdx === mznIdx);
  if (subIdx < 0 || subIdx >= subs.length) return;
  if (!confirm(t("confirmDelSub", subIdx + 1))) return;
  _snapshot();
  const target = subs[subIdx];
  sliceLots = sliceLots.filter((sd) => sd !== target);
  for (let i = 0; i < manzanos.length; i++) {
    const existingAuto = lotSubdivisions.find((s) => s.mznIdx === i);
    if (!existingAuto) continue;
    const targetArea =
      parseFloat(document.getElementById("lpArea").value) || 250;
    const frontMin = parseFloat(document.getElementById("lpFront").value) || 12;
    const dir = document.getElementById("lpDir").value;
    const segDir = dir === "seg" && mznSegments[i] ? mznSegments[i] : null;
    const sliceSubsAll = sliceLots.filter((sd) => sd.mznIdx === i);
    let basePoly = manzanos[i].pts;
    if (sliceSubsAll.length > 0) {
      const subtracted = subtractSliceSubMznos(manzanos[i].pts, sliceSubsAll);
      if (subtracted && subtracted.length >= 3) {
        basePoly = subtracted;
      } else {
        existingAuto.lots = [];
        continue;
      }
    }
    existingAuto.lots = subdivideManzano(
      basePoly,
      targetArea,
      frontMin,
      segDir,
      i,
    );
  }

  updateSidebar();
  updateStatsPanel();
  render();
}

function sliceNewSubManzano() {
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
  document.getElementById("slicePhaseA").style.display = "";
  document.getElementById("slicePhaseB").style.display = "none";
  document.getElementById("slicePhaseC").style.display = "none";
  document.getElementById("slicePhaseD").style.display = "none";
  document.getElementById("sliceSegHint").style.display = "none";
  document.getElementById("sliceSegInfo").style.display = "none";
  populateSliceMznSel();
  render();
}

async function runSliceSubdivision() {
  if (!sliceSubMzn) {
    alert(t("alertNoSubMzn"));
    return;
  }
  if (sliceCutDirX === null) {
    alert(t("alertNoDirCorte"));
    return;
  }
  _snapshot();
  const modeV = document.getElementById("sliceMode").value;
  const frenteMinM =
    parseFloat(document.getElementById("sliceFrente").value) || 6;
  const totalM2 = polyAreaM2(sliceSubMzn.pts);
  let areas = [];
  if (modeV === "equal") {
    const n = parseInt(document.getElementById("sliceN").value) || 4;
    if (n < 2 || n > 99) return;
    areas = Array(n).fill(totalM2 / n);
  } else {
    const raw = document.getElementById("sliceAreas").value;
    const parts = raw
      .split(",")
      .map((s) => parseFloat(s.trim()))
      .filter((v) => !isNaN(v) && v > 0);
    if (!parts.length) {
      alert(t("alertAreaInvalida"));
      return;
    }
    if (parts.length === 1) {
      const areaLote = parts[0];
      if (areaLote > totalM2 * 1.001) {
        alert(t("alertAreaSupera", areaLote, totalM2.toFixed(1)));
        return;
      }
      const nLotes = Math.floor(totalM2 / areaLote);
      if (nLotes < 1) {
        alert(t("alertNoCaben"));
        return;
      }
      areas = Array(nLotes).fill(areaLote);
    } else {
      const sumaAreas = parts.reduce((a, b) => a + b, 0);
      if (sumaAreas > totalM2 * 1.001) {
        alert(t("alertSumaSupera", sumaAreas.toFixed(1), totalM2.toFixed(1)));
        return;
      }
      areas = [...parts];
      const resto = totalM2 - sumaAreas;
      if (resto > 0.1) areas.push(resto);
    }
  }

  const lots = [];
  let remaining = sliceSubMzn.pts.map((p) => ({ ...p }));
  const origFMX = sliceFrenteMidX,
    origFMY = sliceFrenteMidY;
  for (let i = 0; i < areas.length - 1; i++) {
    if (!remaining || remaining.length < 3) break;
    const remArea = polyAreaM2(remaining);
    const targetArea = areas[i];
    if (targetArea >= remArea * 0.9999) {
      lots.push({
        pts: remaining,
        areaM2: remArea,
        frontM: sliceCalcFrenteM(remaining, sliceCutDirX, sliceCutDirY),
        isRemnant: true,
      });
      remaining = [];
      break;
    }

    const currentFMX = origFMX;
    const currentFMY = origFMY;
    const result = sliceBisectLote(
      remaining,
      targetArea,
      sliceCutDirX,
      sliceCutDirY,
      currentFMX,
      currentFMY,
    );
    if (!result) {
      console.warn(`sliceBisectLote falló en lote ${i + 1}`);
      break;
    }

    const frenteReal = sliceCalcFrenteM(
      result.front,
      sliceCutDirX,
      sliceCutDirY,
    );
    const isRemnant = frenteMinM > 0 && frenteReal < frenteMinM * 0.95;
    lots.push({
      pts: result.front,
      areaM2: polyAreaM2(result.front),
      frontM: frenteReal,
      isRemnant,
    });
    remaining = result.rest;
    render();
    await new Promise((r) => setTimeout(r, 60));
  }

  if (remaining && remaining.length >= 3) {
    const remArea = polyAreaM2(remaining);
    if (remArea > 0.1)
      lots.push({
        pts: remaining,
        areaM2: remArea,
        frontM: sliceCalcFrenteM(remaining, sliceCutDirX, sliceCutDirY),
        isRemnant: true,
      });
  }

  const subCen = centroid(sliceSubMzn.pts);
  sliceLots = sliceLots.filter((sd) => {
    if (sd.mznIdx !== sliceMznIdx) return true;
    if (!sd.subMznPts || sd.subMznPts.length < 3) return true;
    const c = centroid(sd.subMznPts);
    return Math.hypot(c.x - subCen.x, c.y - subCen.y) > 1;
  });
  sliceLots.push({
    mznIdx: sliceMznIdx,
    subMznPts: sliceSubMzn.pts,
    lots,
  });
  const existingAuto = lotSubdivisions.find((s) => s.mznIdx === sliceMznIdx);
  if (existingAuto) {
    const targetArea =
      parseFloat(document.getElementById("lpArea").value) || 250;
    const frontMin = parseFloat(document.getElementById("lpFront").value) || 12;
    const dir = document.getElementById("lpDir").value;
    const segDir =
      dir === "seg" && mznSegments[sliceMznIdx]
        ? mznSegments[sliceMznIdx]
        : null;
    const sliceSubs = sliceLots.filter((sd) => sd.mznIdx === sliceMznIdx);
    const basePoly = subtractSliceSubMznos(
      manzanos[sliceMznIdx].pts,
      sliceSubs,
    );
    if (basePoly && basePoly.length >= 3) {
      existingAuto.lots = subdivideManzano(
        basePoly,
        targetArea,
        frontMin,
        segDir,
        sliceMznIdx,
      );
    } else {
      existingAuto.lots = [];
    }
  }

  updateSidebar();
  render();
}

