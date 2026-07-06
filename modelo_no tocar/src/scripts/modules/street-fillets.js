// =====================================================================
// MÓDULO 08/17 · 08-street-fillets.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 05-coords.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [8] GEOMETRÍA AUXILIAR EN PÍXELES (fillets/empalmes de calles)
// (candidato a módulo: street-fillets.js · depende de: [5])
// =====================================================================
function _normPx(a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = Math.hypot(dx, dy);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: -dy / l, y: dx / l };
}
function _lineLineIntersectPx(p1, p2, p3, p4) {
  const dx1 = p2.x - p1.x,
    dy1 = p2.y - p1.y;
  const dx2 = p4.x - p3.x,
    dy2 = p4.y - p3.y;
  const d = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * dy2 - (p3.y - p1.y) * dx2) / d;
  return { x: p1.x + t * dx1, y: p1.y + t * dy1 };
}
function _addPx(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}
function _subPx(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}
function _scalePx(a, s) {
  return { x: a.x * s, y: a.y * s };
}
function _dotPx(a, b) {
  return a.x * b.x + a.y * b.y;
}
function _lenPx(a) {
  return Math.hypot(a.x, a.y);
}
function _normalizePx(a) {
  const l = _lenPx(a);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}
function _onSegmentPx(p, s, e, tol) {
  const dir = _subPx(e, s);
  const len = _lenPx(dir);
  if (len < 1e-9) return false;
  const proj = _dotPx(_subPx(p, s), _normalizePx(dir));
  return proj >= -tol && proj <= len + tol;
}
function _inSweep(ang, a, b) {
  const sweep = (((b - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const rel = (((ang - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return rel <= sweep;
}
function _getFilletRadiusForAngle(angleDeg) {
  if (angleDeg <= 60) return 2;
  if (angleDeg <= 95) return 3;
  if (angleDeg <= 180) return 4;
  return 6;
}
function _ptInsideStreetPx(pt, s, halfPx) {
  const a = toC(s.start.x, s.start.y),
    b = toC(s.end.x, s.end.y);
  const dir = _subPx(b, a),
    len = _lenPx(dir);
  if (len < 1e-9) return false;
  const dirN = _normalizePx(dir);
  const n = _normPx(a, b);
  const rel = _subPx(pt, a);
  const proj = _dotPx(rel, dirN);
  const perp = Math.abs(_dotPx(rel, n));
  return proj >= -halfPx && proj <= len + halfPx && perp <= halfPx;
}

function computeStreetFillets(sA, sB) {
  const results = [];
  const a0 = toC(sA.start.x, sA.start.y),
    a1 = toC(sA.end.x, sA.end.y);
  const b0 = toC(sB.start.x, sB.start.y),
    b1 = toC(sB.end.x, sB.end.y);
  const ip = _lineLineIntersectPx(a0, a1, b0, b1);
  if (!ip) return results;
  const halfA = mw(sA.width / 2) * zoom; // semiancho calle A en px
  const halfB = mw(sB.width / 2) * zoom; // semiancho calle B en px
  const nA = _normPx(a0, a1),
    dA = _normalizePx(_subPx(a1, a0));
  const nB = _normPx(b0, b1),
    dB = _normalizePx(_subPx(b1, b0));
  for (const sAs of [1, -1]) {
    for (const sBs of [1, -1]) {
      const eA0 = _addPx(a0, _scalePx(nA, sAs * halfA));
      const eA1 = _addPx(a1, _scalePx(nA, sAs * halfA));
      const eB0 = _addPx(b0, _scalePx(nB, sBs * halfB));
      const eB1 = _addPx(b1, _scalePx(nB, sBs * halfB));
      const corner = _lineLineIntersectPx(eA0, eA1, eB0, eB1);
      if (!corner) continue;
      const cRel = _subPx(corner, ip);
      if (sAs * _dotPx(nA, cRel) <= 0) continue;
      if (sBs * _dotPx(nB, cRel) <= 0) continue;
      if (_lenPx(cRel) < 1) continue;
      const ipRel = _subPx(ip, corner);
      const projA = _dotPx(ipRel, dA);
      const projB = _dotPx(ipRel, dB);
      const outA = projA >= 0 ? { x: -dA.x, y: -dA.y } : { x: dA.x, y: dA.y };
      const outB = projB >= 0 ? { x: -dB.x, y: -dB.y } : { x: dB.x, y: dB.y };
      const cosT = Math.max(-1, Math.min(1, _dotPx(outA, outB)));
      const theta = Math.acos(cosT);
      if (theta < 0.05 || theta > Math.PI - 0.05) continue;
      const cornerAngleDeg = (theta * 180) / Math.PI;
      const filletM = _getFilletRadiusForAngle(cornerAngleDeg);
      const filletPx = mw(filletM) * zoom;
      const tol = halfA + halfB + filletPx;
      if (!_onSegmentPx(ip, a0, a1, tol)) continue;
      if (!_onSegmentPx(ip, b0, b1, tol)) continue;
      if (_lenPx(cRel) > tol * 3) continue;

      const t = filletPx / Math.tan(theta / 2);
      if (t <= 0 || !isFinite(t)) continue;

      const tangA = _addPx(corner, _scalePx(outA, t));
      const tangB = _addPx(corner, _scalePx(outB, t));
      if (!_onSegmentPx(tangA, eA0, eA1, filletPx + 2)) continue;
      if (!_onSegmentPx(tangB, eB0, eB1, filletPx + 2)) continue;

      const bisRaw = _addPx(outA, outB);
      const bisLen = _lenPx(bisRaw);
      if (bisLen < 1e-9) continue;
      const bis = { x: bisRaw.x / bisLen, y: bisRaw.y / bisLen };
      const distToCtr = filletPx / Math.sin(theta / 2);
      const acx = corner.x + bis.x * distToCtr;
      const acy = corner.y + bis.y * distToCtr;
      const angA = Math.atan2(tangA.y - acy, tangA.x - acx);
      const angB = Math.atan2(tangB.y - acy, tangB.x - acx);
      const caRel = Math.atan2(-bis.y, -bis.x);
      const acw = !_inSweep(caRel, angA, angB);
      results.push({
        corner,
        tangA,
        tangB,
        acx,
        acy,
        angA,
        angB,
        acw,
        outA,
        outB,
        t,
        sAs,
        sBs,
        halfA,
        halfB,
        filletPx,
        segA: sA,
        segB: sB,
        eA0,
        eA1,
        eB0,
        eB1,
      });
    }
  }
  return results;
}

function filterStreetFillets(fillets, allStreets) {
  return fillets.filter((f) => {
    for (const seg of allStreets) {
      if (seg === f.segA || seg === f.segB) continue;
      const halfPx = mw(seg.width / 2) * zoom;
      if (_ptInsideStreetPx(f.corner, seg, halfPx)) return false;
      if (_ptInsideStreetPx({ x: f.acx, y: f.acy }, seg, halfPx + f.filletPx))
        return false;
    }
    return true;
  });
}

function _mergeIntervals(ivs) {
  if (!ivs.length) return [];
  ivs.sort((a, b) => a[0] - b[0]);
  const out = [ivs[0]];
  for (let i = 1; i < ivs.length; i++) {
    const last = out[out.length - 1];
    if (ivs[i][0] <= last[1] + 1) last[1] = Math.max(last[1], ivs[i][1]);
    else out.push(ivs[i]);
  }
  return out;
}

function drawStreetEdgeWithFillets(s, side, allFillets, otherStreets) {
  const halfPx = mw(s.width / 2) * zoom;
  const a = toC(s.start.x, s.start.y);
  const b = toC(s.end.x, s.end.y);
  const n = _normPx(a, b);
  const ox = n.x * side * halfPx,
    oy = n.y * side * halfPx;
  const pa = { x: a.x + ox, y: a.y + oy };
  const pb = { x: b.x + ox, y: b.y + oy };
  const segDir = _normalizePx(_subPx(pb, pa));
  const segLen = _lenPx(_subPx(pb, pa));
  if (segLen < 1e-6) return;
  const suppress = [];
  for (const f of allFillets) {
    const isA = f.segA === s;
    const isB = f.segB === s;
    if (!isA && !isB) continue;
    const mySide = isA ? f.sAs : f.sBs;
    if (mySide !== side) continue;
    const myTang = isA ? f.tangA : f.tangB;
    const cornerProj = _dotPx(_subPx(f.corner, pa), segDir);
    const tangProj = _dotPx(_subPx(myTang, pa), segDir);
    const t0 = Math.max(0, Math.min(tangProj, cornerProj) - 1);
    const t1 = Math.min(segLen, Math.max(tangProj, cornerProj) + 1);
    if (t1 > t0) suppress.push([t0, t1]);
  }
  const STEP = 4;
  let inStart = null;
  const flushIn = (tEnd) => {
    if (inStart !== null) {
      suppress.push([Math.max(0, inStart - 1), Math.min(segLen, tEnd + 1)]);
      inStart = null;
    }
  };
  for (let t = 0; t <= segLen + STEP; t += STEP) {
    const tc = Math.min(t, segLen);
    const pt = _addPx(pa, _scalePx(segDir, tc));
    let inside = false;
    for (const other of otherStreets) {
      if (other === s) continue;
      const oDist = mw(other.width / 2) * zoom;
      if (_ptInsideStreetPx(pt, other, oDist)) {
        inside = true;
        break;
      }
    }
    if (inside) {
      if (inStart === null) inStart = tc;
    } else flushIn(tc);
  }
  flushIn(segLen);
  const gaps = _mergeIntervals(suppress);
  let cur = 0;
  const strokeSeg = (t0, t1) => {
    if (t1 - t0 < 0.5) return;
    const p0 = _addPx(pa, _scalePx(segDir, t0));
    const p1 = _addPx(pa, _scalePx(segDir, t1));
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  };
  for (const [g0, g1] of gaps) {
    if (g0 > cur) strokeSeg(cur, g0);
    cur = g1;
  }
  if (cur < segLen) strokeSeg(cur, segLen);
}

function distPtSeg(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l2 = dx * dx + dy * dy;
  if (l2 < 1e-10) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function snapToVertex(wp) {
  const SNAP_RADIUS = 12 / zoom;
  const SEG_DETECT = 12 / zoom;
  const VERTEX_ATTRACT_PX = 120;
  const VERTEX_ATTRACT = VERTEX_ATTRACT_PX / zoom;

  let bestVertex = null,
    bestVertexDist = Infinity;
  let bestPerp = null,
    bestPerpDist = Infinity;
  let bestSegExtend = null,
    bestSegExtendDist = Infinity; // snap a extensión de segmento desde vértice

  for (const mzn of manzanos) {
    const pts = mzn.pts,
      n = pts.length;
    for (const p of pts) {
      const d = Math.hypot(wp.x - p.x, wp.y - p.y);
      if (d < SNAP_RADIUS && d < bestVertexDist) {
        bestVertexDist = d;
        bestVertex = {
          x: p.x,
          y: p.y,
          type: "vertex",
          segA: null,
          segB: null,
        };
      }
    }

    for (let i = 0; i < n; i++) {
      const a = pts[i],
        b = pts[(i + 1) % n];
      for (const [anchor, other] of [
        [a, b],
        [b, a],
      ]) {
        const sdx = other.x - anchor.x,
          sdy = other.y - anchor.y;
        const slen = Math.sqrt(sdx * sdx + sdy * sdy);
        if (slen < 1e-10) continue;
        const sux = sdx / slen,
          suy = sdy / slen;
        const dot = (wp.x - anchor.x) * sux + (wp.y - anchor.y) * suy;
        if (dot > 0) continue;
        const projX = anchor.x + dot * sux;
        const projY = anchor.y + dot * suy;
        const distToLine = Math.hypot(wp.x - projX, wp.y - projY);
        if (distToLine > SNAP_RADIUS * 2) continue;

        if (distToLine < bestSegExtendDist) {
          bestSegExtendDist = distToLine;
          bestSegExtend = {
            x: projX,
            y: projY,
            type: "segExtend",
            anchor: anchor,
            segA: anchor,
            segB: other,
            dirX: sux,
            dirY: suy,
            dot: dot,
          };
        }
      }

      if (!streetStart) continue;
      const sdx = b.x - a.x,
        sdy = b.y - a.y;
      const slen2 = sdx * sdx + sdy * sdy;
      if (slen2 < 1e-10) continue;
      const tMouse = ((wp.x - a.x) * sdx + (wp.y - a.y) * sdy) / slen2;
      const tClamped = Math.max(0, Math.min(1, tMouse));
      const closestX = a.x + tClamped * sdx,
        closestY = a.y + tClamped * sdy;
      const distMouseToSeg = Math.hypot(wp.x - closestX, wp.y - closestY);
      if (distMouseToSeg > SEG_DETECT) continue;
      const slen = Math.sqrt(slen2);
      const sux2 = sdx / slen,
        suy2 = sdy / slen;
      const nx2 = -suy2,
        ny2 = sux2;
      const denom = nx2 * -sdy - ny2 * -sdx;
      if (Math.abs(denom) < 1e-10) continue;
      const rhs_x = a.x - streetStart.x;
      const rhs_y = a.y - streetStart.y;
      const tLine = (rhs_x * -sdy - rhs_y * -sdx) / denom;
      const ix = streetStart.x + tLine * nx2;
      const iy = streetStart.y + tLine * ny2;
      const tSeg = ((ix - a.x) * sdx + (iy - a.y) * sdy) / slen2;
      if (tSeg < -0.01 || tSeg > 1.01) continue;
      const distToIntersect = Math.hypot(wp.x - ix, wp.y - iy);
      if (distToIntersect < bestPerpDist) {
        bestPerpDist = distToIntersect;
        bestPerp = { x: ix, y: iy, type: "perp", segA: a, segB: b };
      }
    }
  }

  for (const guide of dxfGuideLines) {
    if (!guide.pts || guide.pts.length < 2) continue;
    for (const p of guide.pts) {
      const d = Math.hypot(wp.x - p.x, wp.y - p.y);
      if (d < SNAP_RADIUS && d < bestVertexDist) {
        bestVertexDist = d;
        bestVertex = {
          x: p.x,
          y: p.y,
          type: "vertex",
          segA: null,
          segB: null,
          isGuide: true,
        };
      }
    }
    if (!streetStart) continue;
    const gpts = guide.pts;
    for (let i = 0; i < gpts.length - 1; i++) {
      const a = gpts[i],
        b = gpts[i + 1];
      const sdx = b.x - a.x,
        sdy = b.y - a.y;
      const slen2 = sdx * sdx + sdy * sdy;
      if (slen2 < 1e-10) continue;
      const tMouse = ((wp.x - a.x) * sdx + (wp.y - a.y) * sdy) / slen2;
      const tClamped = Math.max(0, Math.min(1, tMouse));
      const closestX = a.x + tClamped * sdx,
        closestY = a.y + tClamped * sdy;
      if (Math.hypot(wp.x - closestX, wp.y - closestY) > SEG_DETECT) continue;
      const slen = Math.sqrt(slen2);
      const sux = sdx / slen,
        suy = sdy / slen;
      const nx = -suy,
        ny = sux;
      const denom = nx * -sdy - ny * -sdx;
      if (Math.abs(denom) < 1e-10) continue;
      const rhs_x = a.x - streetStart.x,
        rhs_y = a.y - streetStart.y;
      const tLine = (rhs_x * -sdy - rhs_y * -sdx) / denom;
      const ix = streetStart.x + tLine * nx;
      const iy = streetStart.y + tLine * ny;
      const tSeg = ((ix - a.x) * sdx + (iy - a.y) * sdy) / slen2;
      if (tSeg < -0.01 || tSeg > 1.01) continue;
      const distToIntersect = Math.hypot(wp.x - ix, wp.y - iy);
      if (distToIntersect < bestPerpDist) {
        bestPerpDist = distToIntersect;
        bestPerp = {
          x: ix,
          y: iy,
          type: "perp",
          segA: a,
          segB: b,
          isGuide: true,
        };
      }
    }
  }

  // ── Prioridad: vértice exacto > perp > segExtend ──
  if (bestVertex) return bestVertex;
  if (bestPerp) return bestPerp;
  if (bestSegExtend) return bestSegExtend;
  return null;
}

