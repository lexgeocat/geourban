// =====================================================================
// MÓDULO 09/17 · 09-polygon-engine.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 03-state.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [9] MOTOR GEOMÉTRICO DE POLÍGONOS (parcela / manzanos / calles)
// (candidato a módulo: polygon-engine.js · depende de: [3])
// =====================================================================
function closePolygon() {
  if (polyPts.length < 3) return;
  _snapshot();
  polyClosed = true;
  document.getElementById("btnClose").style.display = "none";
  document.getElementById("btnStreet").disabled = false;
  document.getElementById("btnSlice").disabled = false;
  manzanos = [{ pts: [...polyPts], colorIdx: 0 }];
  lotSubdivisions = [];
  lotSubdivisions = [];
  updateSidebar();
  updateInstr();
  updateStatsPanel();
  render();
}

function polyArea(pts) {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
}
function polyAreaM2(pts) {
  return polyArea(pts) * MPP * MPP;
}
function centroid(pts) {
  let cx = 0,
    cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / pts.length, y: cy / pts.length };
}

function side(pt, lp1, lp2) {
  return (lp2.x - lp1.x) * (pt.y - lp1.y) - (lp2.y - lp1.y) * (pt.x - lp1.x);
}

function clipHalfPlane(pts, lp1, lp2, keepSide) {
  if (pts.length < 3) return [];
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const cur = pts[i],
      nxt = pts[(i + 1) % n];
    const sc = side(cur, lp1, lp2),
      sn = side(nxt, lp1, lp2);
    const curIn = keepSide > 0 ? sc >= -1e-9 : sc <= 1e-9;
    const nxtIn = keepSide > 0 ? sn >= -1e-9 : sn <= 1e-9;
    if (curIn) out.push({ ...cur });
    if ((curIn && !nxtIn) || (!curIn && nxtIn)) {
      const inter = lineLineIntersect(cur, nxt, lp1, lp2);
      if (inter) out.push(inter);
    }
  }
  return out.length >= 3 ? out : [];
}

function lineLineIntersect(a, b, c, d) {
  const dx1 = b.x - a.x,
    dy1 = b.y - a.y,
    dx2 = d.x - c.x,
    dy2 = d.y - c.y;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((c.x - a.x) * dy2 - (c.y - a.y) * dx2) / denom;
  return { x: a.x + t * dx1, y: a.y + t * dy1 };
}

function polysOverlap(a, b) {
  for (const poly of [a, b]) {
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p1 = poly[i],
        p2 = poly[(i + 1) % n];
      const nx = -(p2.y - p1.y),
        ny = p2.x - p1.x;
      let minA = Infinity,
        maxA = -Infinity,
        minB = Infinity,
        maxB = -Infinity;
      for (const pt of a) {
        const d = pt.x * nx + pt.y * ny;
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const pt of b) {
        const d = pt.x * nx + pt.y * ny;
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA < minB - 1e-9 || maxB < minA - 1e-9) return false;
    }
  }
  return true;
}

function approxOverlapArea(polyA, polyB) {
  let clipped = polyA.map((p) => ({ ...p }));
  const n = polyB.length;
  for (let i = 0; i < n; i++) {
    if (clipped.length < 3) break;
    const a = polyB[i],
      b = polyB[(i + 1) % n];
    const cenB = centroid(polyB);
    const s = side(cenB, a, b);
    const keepSide = s >= 0 ? +1 : -1;
    clipped = clipHalfPlane(clipped, a, b, keepSide);
  }
  if (!clipped || clipped.length < 3) return 0;
  return polyArea(clipped);
}

function clipPolyToManzano(polyPtsIn, mznPts) {
  if (!polyPtsIn || polyPtsIn.length < 3 || !mznPts || mznPts.length < 3)
    return null;
  let clipped = polyPtsIn.map((p) => ({ ...p }));
  const n = mznPts.length;
  const cenM = centroid(mznPts);
  for (let i = 0; i < n; i++) {
    if (clipped.length < 3) return null;
    const a = mznPts[i],
      b = mznPts[(i + 1) % n];
    const s = side(cenM, a, b);
    const keepSide = s >= 0 ? +1 : -1;
    clipped = clipHalfPlane(clipped, a, b, keepSide);
  }
  return clipped && clipped.length >= 3 ? clipped : null;
}

function streetRect(street) {
  const { start: S, end: E, width: W } = street;
  const dx = E.x - S.x,
    dy = E.y - S.y,
    len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return null;
  const nx = -dy / len,
    ny = dx / len,
    hw = mw(W / 2);
  return [
    { x: S.x + nx * hw, y: S.y + ny * hw },
    { x: E.x + nx * hw, y: E.y + ny * hw },
    { x: E.x - nx * hw, y: E.y - ny * hw },
    { x: S.x - nx * hw, y: S.y - ny * hw },
  ];
}

function clipToStrip(pts, ax, ay, minT, maxT) {
  if (pts.length < 3) return [];
  const nx = -ay,
    ny = ax;
  const minPt = { x: minT * ax, y: minT * ay };
  const p1 = { x: minPt.x + nx, y: minPt.y + ny };
  const p2 = { x: minPt.x - nx, y: minPt.y - ny };
  const testMin = { x: (minT + 1) * ax, y: (minT + 1) * ay };
  const sMin = side(testMin, p1, p2);
  let clipped = clipHalfPlane(pts, p1, p2, sMin >= 0 ? +1 : -1);
  const maxPt = { x: maxT * ax, y: maxT * ay };
  const p3 = { x: maxPt.x + nx, y: maxPt.y + ny };
  const p4 = { x: maxPt.x - nx, y: maxPt.y - ny };
  const testMax = { x: (maxT - 1) * ax, y: (maxT - 1) * ay };
  const sMax = side(testMax, p3, p4);
  clipped = clipHalfPlane(clipped, p3, p4, sMax >= 0 ? +1 : -1);
  return clipped;
}

function applyStreetToLots(lotsIn, street) {
  const rect = streetRect(street);
  if (!rect) return lotsIn;
  const { start: S, end: E, width: W } = street;
  const dx = E.x - S.x,
    dy = E.y - S.y,
    len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return lotsIn;
  const ux = dx / len,
    uy = dy / len,
    nx = -uy,
    ny = ux,
    hw = mw(W / 2);
  const L1a = { x: S.x + nx * hw, y: S.y + ny * hw },
    L1b = { x: E.x + nx * hw, y: E.y + ny * hw };
  const L2a = { x: S.x - nx * hw, y: S.y - ny * hw },
    L2b = { x: E.x - nx * hw, y: E.y - ny * hw };
  const C1a = { x: S.x + nx, y: S.y + ny },
    C1b = { x: S.x - nx, y: S.y - ny };
  const sideE_C1 = side(E, C1a, C1b);
  const outsideC1 = sideE_C1 > 0 ? -1 : +1;
  const C2a = { x: E.x + nx, y: E.y + ny },
    C2b = { x: E.x - nx, y: E.y - ny };
  const sideS_C2 = side(S, C2a, C2b);
  const outsideC2 = sideS_C2 > 0 ? -1 : +1;
  const MIN_AREA_W2 = 1 / MPP / MPP;
  const result = [];
  for (const lot of lotsIn) {
    if (!polysOverlap(lot.pts, rect)) {
      result.push(lot);
      continue;
    }
    const frags = [];
    const lf = clipHalfPlane(lot.pts, L1a, L1b, +1);
    if (lf.length >= 3 && polyArea(lf) > MIN_AREA_W2) frags.push(lf);
    const rf = clipHalfPlane(lot.pts, L2a, L2b, -1);
    if (rf.length >= 3 && polyArea(rf) > MIN_AREA_W2) frags.push(rf);
    let sf = clipHalfPlane(lot.pts, C1a, C1b, outsideC1);
    sf = clipHalfPlane(sf, L1a, L1b, -1);
    sf = clipHalfPlane(sf, L2a, L2b, +1);
    if (sf.length >= 3 && polyArea(sf) > MIN_AREA_W2) frags.push(sf);
    let ef = clipHalfPlane(lot.pts, C2a, C2b, outsideC2);
    ef = clipHalfPlane(ef, L1a, L1b, -1);
    ef = clipHalfPlane(ef, L2a, L2b, +1);
    if (ef.length >= 3 && polyArea(ef) > MIN_AREA_W2) frags.push(ef);
    if (frags.length === 0) {
      continue;
    }
    for (const f of frags) result.push({ pts: f, colorIdx: 0 });
  }
  return result.map((l, i) => ({
    pts: l.pts,
    colorIdx: i % MZN_COLORS.length,
  }));
}

function recomputeManzanos() {
  if (!polyClosed) return;
  const prevManzanos = manzanos.slice();
  const prevSliceLots = sliceLots.slice();
  const prevLotSubdivs = lotSubdivisions.slice();
  let cur = [{ pts: [...polyPts], colorIdx: 0 }];
  for (const s of streets) cur = applyStreetToLots(cur, s);
  const MIN_MZN_M2 = 1.0;
  manzanos = cur
    .filter((l) => polyAreaM2(l.pts) >= MIN_MZN_M2)
    .map((l, i) => ({ ...l, colorIdx: i % MZN_COLORS.length }));

  const remappedSliceLots = [];
  for (const sd of prevSliceLots) {
    if (!sd.subMznPts || sd.subMznPts.length < 3) continue;
    const subCen = centroid(sd.subMznPts);
    let bestNewIdx = -1;
    let bestOverlap = -1;
    for (let ni = 0; ni < manzanos.length; ni++) {
      if (slicePtInPoly(subCen.x, subCen.y, manzanos[ni].pts)) {
        const overlap = approxOverlapArea(sd.subMznPts, manzanos[ni].pts);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestNewIdx = ni;
        }
      }
    }

    if (bestNewIdx < 0) {
      let bestDist = Infinity;
      for (let ni = 0; ni < manzanos.length; ni++) {
        const cen = centroid(manzanos[ni].pts);
        const d = Math.hypot(cen.x - subCen.x, cen.y - subCen.y);
        if (d < bestDist) {
          bestDist = d;
          bestNewIdx = ni;
        }
      }

      if (bestNewIdx >= 0) {
        const overlap = approxOverlapArea(
          sd.subMznPts,
          manzanos[bestNewIdx].pts,
        );
        const subArea = polyArea(sd.subMznPts);
        if (subArea > 0 && overlap / subArea < 0.3) bestNewIdx = -1;
      }
    }

    if (bestNewIdx < 0) continue;
    const clipped = clipPolyToManzano(sd.subMznPts, manzanos[bestNewIdx].pts);
    if (!clipped || clipped.length < 3) continue;

    const clippedAreaM2 = polyAreaM2(clipped);
    if (clippedAreaM2 < 1) continue;
    const reclippedLots = [];
    for (const lt of sd.lots) {
      const ltClipped = clipPolyToManzano(lt.pts, manzanos[bestNewIdx].pts);
      if (!ltClipped || ltClipped.length < 3) continue;
      const ltArea = polyAreaM2(ltClipped);
      if (ltArea < 0.5) continue;
      reclippedLots.push({
        ...lt,
        pts: ltClipped,
        areaM2: ltArea,
        frontM: lt.frontM,
        isRemnant: lt.isRemnant,
      });
    }

    if (reclippedLots.length === 0) continue;

    remappedSliceLots.push({
      mznIdx: bestNewIdx,
      subMznPts: clipped,
      lots: reclippedLots,
    });
  }
  sliceLots = remappedSliceLots;
  const remappedLotSubdivs = [];
  for (const sub of prevLotSubdivs) {
    if (!sub.lots || sub.lots.length === 0) continue;
    const firstLot = sub.lots[0];
    if (!firstLot || !firstLot.pts || firstLot.pts.length < 3) continue;
    const lotCen = centroid(firstLot.pts);
    let bestNewIdx = -1;
    let bestDist = Infinity;
    for (let ni = 0; ni < manzanos.length; ni++) {
      if (slicePtInPoly(lotCen.x, lotCen.y, manzanos[ni].pts)) {
        bestNewIdx = ni;
        break;
      }
      const cen = centroid(manzanos[ni].pts);
      const d = Math.hypot(cen.x - lotCen.x, cen.y - lotCen.y);
      if (d < bestDist) {
        bestDist = d;
        bestNewIdx = ni;
      }
    }
    if (bestNewIdx < 0) continue;
    const reclipped = [];
    for (const lt of sub.lots) {
      const cl = clipPolyToManzano(lt.pts, manzanos[bestNewIdx].pts);
      if (!cl || cl.length < 3) continue;
      const a = polyAreaM2(cl);
      if (a < 0.5) continue;
      reclipped.push({ ...lt, pts: cl, areaM2: a });
    }
    if (reclipped.length === 0) continue;
    if (!remappedLotSubdivs.find((r) => r.mznIdx === bestNewIdx)) {
      remappedLotSubdivs.push({ mznIdx: bestNewIdx, lots: reclipped });
    }
  }

  for (let ni = 0; ni < manzanos.length; ni++) {
    if (!remappedLotSubdivs.find((r) => r.mznIdx === ni)) {
      remappedLotSubdivs.push({ mznIdx: ni, lots: [] });
    }
  }
  lotSubdivisions = remappedLotSubdivs;
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
  const validIdxs = new Set(manzanos.map((_, i) => i));
  for (const k of Object.keys(mznEquipamiento)) {
    if (!validIdxs.has(parseInt(k))) delete mznEquipamiento[k];
  }
  updateStatsPanel();
}
function principalAxis(pts) {
  const n = pts.length;
  let mx = 0,
    my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let cxx = 0,
    cxy = 0,
    cyy = 0;
  for (const p of pts) {
    const dx = p.x - mx,
      dy = p.y - my;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }
  const trace = cxx + cyy,
    det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const l1 = trace / 2 + disc; // largest eigenvalue → long axis
  let ex, ey;
  if (Math.abs(cxy) > 1e-10) {
    ex = l1 - cyy;
    ey = cxy;
  } else {
    ex = cxx >= cyy ? 1 : 0;
    ey = cxx >= cyy ? 0 : 1;
  }
  const len = Math.sqrt(ex * ex + ey * ey) || 1;
  let ux = ex / len,
    uy = ey / len;
  if (ux < 0 || (Math.abs(ux) < 1e-9 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  return { ux, uy };
}

function projectExtents(pts, ax, ay) {
  let mn = Infinity,
    mx = -Infinity;
  for (const p of pts) {
    const t = p.x * ax + p.y * ay;
    if (t < mn) mn = t;
    if (t > mx) mx = t;
  }
  return { min: mn, max: mx };
}

