// =====================================================================
// MÓDULO 13/17 · 13-render.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 03-state.js, 05-coords.js, 08-street-fillets.js, 09-polygon-engine.js, 12-equipamiento-render.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [13] RENDER PRINCIPAL DEL CANVAS
// (candidato a módulo: render.js · depende de: [3],[5],[8],[9],[12];
//  es el módulo con más dependencias — conviene extraerlo al final)
// =====================================================================
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (showGrid) drawGrid();
  if (typeof drawOrthoOnCanvas === "function") drawOrthoOnCanvas();
  for (let i = 0; i < manzanos.length; i++) {
    const l = manzanos[i],
      c = MZN_COLORS[l.colorIdx];
    const sub = showLots ? lotSubdivisions.find((s) => s.mznIdx === i) : null;
    const hasLots = sub && sub.lots.length > 0;
    const unifiedLots = [];
    if (showLots) {
      if (sub && sub.lots.length > 0) {
        sub.lots.forEach((lt) =>
          unifiedLots.push({ ...lt, _type: "auto", _color: c }),
        );
      }
      sliceLots
        .filter((sd) => sd.mznIdx === i)
        .forEach((sd) => {
          sd.lots.forEach((lt) =>
            unifiedLots.push({
              ...lt,
              _type: "slice",
              _color: "#d2a8ff",
            }),
          );
        });
    }

    if (unifiedLots.length > 0) {
      for (let j = 0; j < unifiedLots.length; j++) {
        const lt = unifiedLots[j];
        const lcp = lt.pts.map((p) => toC(p.x, p.y));
        ctx.beginPath();
        ctx.moveTo(lcp[0].x, lcp[0].y);
        for (let k = 1; k < lcp.length; k++) ctx.lineTo(lcp[k].x, lcp[k].y);
        ctx.closePath();
        if (lt.isRemnant) {
          ctx.fillStyle = "#ffa65718";
          ctx.fill();
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = "#ffa65799";
          ctx.lineWidth = 0.8;
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = lt._color + (lt._type === "slice" ? "30" : "20");
          ctx.fill();
          ctx.strokeStyle = lt._color + (lt._type === "slice" ? "cc" : "aa");
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }

        const lcen = centroid(lt.pts),
          lcc = toC(lcen.x, lcen.y);
        const la = lt.areaM2 !== undefined ? lt.areaM2 : polyAreaM2(lt.pts);
        const fs2 = Math.max(10, Math.min(14, 11 * zoom));
        let longestAngle = 0;
        {
          let maxLen = -1;
          const lp = lt.pts,
            ln = lp.length;
          for (let k = 0; k < ln; k++) {
            const a = lp[k],
              b = lp[(k + 1) % ln];
            const dl = Math.hypot(b.x - a.x, b.y - a.y);
            if (dl > maxLen) {
              maxLen = dl;
              longestAngle = Math.atan2(b.y - a.y, b.x - a.x);
            }
          }
          if (longestAngle > Math.PI / 2 || longestAngle < -Math.PI / 2)
            longestAngle += Math.PI;
        }
        ctx.save();
        ctx.translate(lcc.x, lcc.y);
        ctx.rotate(longestAngle);
        ctx.fillStyle = lt.isRemnant ? "#ffa657bb" : lt._color + "cc";
        ctx.font = `bold ${fs2}px Courier New`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`L${j + 1}`, 0, 0);
        if (zoom > 0.45) {
          ctx.font = `${Math.max(10, Math.min(14, 11 * zoom))}px Courier New`;
          ctx.fillStyle = "#8b949eaa";
          ctx.fillText(`${la.toFixed(1)}m²`, 0, fs2 * 1.4);
        }
        ctx.restore();
      }
      const cp = l.pts.map((p) => toC(p.x, p.y));
      ctx.beginPath();
      ctx.moveTo(cp[0].x, cp[0].y);
      for (let j = 1; j < cp.length; j++) ctx.lineTo(cp[j].x, cp[j].y);
      ctx.closePath();
      ctx.strokeStyle = c;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      sliceLots
        .filter((sd) => sd.mznIdx === i)
        .forEach((sd) => {
          if (sd.subMznPts && sd.subMznPts.length >= 3) {
            const scp = sd.subMznPts.map((p) => toC(p.x, p.y));
            ctx.beginPath();
            ctx.moveTo(scp[0].x, scp[0].y);
            for (let k = 1; k < scp.length; k++) ctx.lineTo(scp[k].x, scp[k].y);
            ctx.closePath();
            ctx.strokeStyle = "#d2a8ff";
            ctx.lineWidth = 1.8;
            ctx.setLineDash([4, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        });

      if (zoom > 0.15) {
        const swPath = buildSidewalkPath(l.pts);
        if (swPath) {
          ctx.save();
          ctx.strokeStyle = c + "cc";
          ctx.lineWidth = Math.max(0.8, 1.2 * zoom);
          ctx.setLineDash([Math.max(3, 5 * zoom), Math.max(2, 3 * zoom)]);
          ctx.stroke(swPath);
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    } else if (mznEquipamiento[i]) {
      const cp = l.pts.map((p) => toC(p.x, p.y));
      const { type: equipType } = getEquipamientoInfo(polyAreaM2(l.pts));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cp[0].x, cp[0].y);
      for (let j = 1; j < cp.length; j++) ctx.lineTo(cp[j].x, cp[j].y);
      ctx.closePath();
      ctx.clip();
      const ccen = toC(centroid(l.pts).x, centroid(l.pts).y);
      const bb2 = eqBBox(l.pts);
      const gradR = Math.max(bb2.w, bb2.h) * 0.65;
      const grad = ctx.createRadialGradient(
        ccen.x,
        ccen.y,
        0,
        ccen.x,
        ccen.y,
        gradR,
      );
      grad.addColorStop(0, "rgba(45,120,45,0.55)");
      grad.addColorStop(0.6, "rgba(30,100,35,0.48)");
      grad.addColorStop(1, "rgba(15,75,20,0.38)");
      ctx.fillStyle = grad;
      ctx.fillRect(bb2.minX, bb2.minY, bb2.w, bb2.h);
      ctx.restore();
      drawEquipamientoContent(l.pts, i, equipType);
      ctx.beginPath();
      ctx.moveTo(cp[0].x, cp[0].y);
      for (let j = 1; j < cp.length; j++) ctx.lineTo(cp[j].x, cp[j].y);
      ctx.closePath();
      ctx.strokeStyle = "#e3b341";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (zoom > 0.15) {
        const swPath = buildSidewalkPath(l.pts);
        if (swPath) {
          ctx.save();
          ctx.strokeStyle = "#e3b341cc";
          ctx.lineWidth = Math.max(0.8, 1.2 * zoom);
          ctx.setLineDash([Math.max(3, 5 * zoom), Math.max(2, 3 * zoom)]);
          ctx.stroke(swPath);
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    } else {
      const cp = l.pts.map((p) => toC(p.x, p.y));
      ctx.beginPath();
      ctx.moveTo(cp[0].x, cp[0].y);
      for (let j = 1; j < cp.length; j++) ctx.lineTo(cp[j].x, cp[j].y);
      ctx.closePath();
      ctx.fillStyle = c + "22";
      ctx.fill();
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (zoom > 0.12) {
      const segPts = l.pts;
      const segN = segPts.length;
      const mznCen = centroid(segPts);
      for (let si = 0; si < segN; si++) {
        const pA = segPts[si];
        const pB = segPts[(si + 1) % segN];
        const dxW = pB.x - pA.x,
          dyW = pB.y - pA.y;
        const lenM = Math.sqrt(dxW * dxW + dyW * dyW) * MPP;
        if (lenM < 0.5) continue;
        const midW = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
        const midC = toC(midW.x, midW.y);
        let ang = Math.atan2(dyW, dxW);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        const segLen = Math.sqrt(dxW * dxW + dyW * dyW) || 1;
        const nxSeg = -dyW / segLen,
          nySeg = dxW / segLen;
        const dotOut =
          (midW.x - mznCen.x) * nxSeg + (midW.y - mznCen.y) * nySeg;
        const outX = dotOut >= 0 ? nxSeg : -nxSeg;
        const outY = dotOut >= 0 ? nySeg : -nySeg;
        const offsetPx = Math.max(10, 13 * zoom);
        const txC = midC.x + outX * offsetPx;
        const tyC = midC.y + outY * offsetPx;
        const fsSeg = Math.max(10, Math.min(15, 11 * zoom));
        ctx.save();
        ctx.translate(txC, tyC);
        ctx.rotate(ang);
        const label =
          lenM >= 100 ? lenM.toFixed(1) + " m" : lenM.toFixed(2) + " m";
        ctx.font = `600 ${fsSeg}px Courier New`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(13,17,23,0.72)";
        ctx.fillRect(-tw / 2 - 2, -fsSeg / 2 - 1, tw + 4, fsSeg + 2);
        if (mznEquipamiento[i]) {
          ctx.fillStyle = "#e3b341ee";
        } else {
          ctx.fillStyle = MZN_COLORS[l.colorIdx] + "ee";
        }
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
    if (zoom > 0.35 && showLots) {
      const allLotsForDim = [];
      const subDim = lotSubdivisions.find((s) => s.mznIdx === i);
      if (subDim && subDim.lots.length > 0) {
        subDim.lots.forEach((lt) => allLotsForDim.push(lt));
      }
      sliceLots
        .filter((sd) => sd.mznIdx === i)
        .forEach((sd) => {
          sd.lots.forEach((lt) => allLotsForDim.push(lt));
        });

      for (const lt of allLotsForDim) {
        if (!lt.pts || lt.pts.length < 3) continue;
        const ltCen = centroid(lt.pts);
        const ltN = lt.pts.length;
        for (let si = 0; si < ltN; si++) {
          const pA = lt.pts[si];
          const pB = lt.pts[(si + 1) % ltN];
          const dxW = pB.x - pA.x,
            dyW = pB.y - pA.y;
          const lenM = Math.sqrt(dxW * dxW + dyW * dyW) * MPP;
          if (lenM < 0.5) continue;
          const pAc = toC(pA.x, pA.y);
          const pBc = toC(pB.x, pB.y);
          const segPx = Math.hypot(pBc.x - pAc.x, pBc.y - pAc.y);
          if (segPx < 28) continue;
          const midW = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
          const midC = toC(midW.x, midW.y);
          let ang = Math.atan2(dyW, dxW);
          if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
          const segLen = Math.sqrt(dxW * dxW + dyW * dyW) || 1;
          const nxSeg = -dyW / segLen,
            nySeg = dxW / segLen;
          const dotOut =
            (midW.x - ltCen.x) * nxSeg + (midW.y - ltCen.y) * nySeg;
          const inX = dotOut >= 0 ? -nxSeg : nxSeg;
          const inY = dotOut >= 0 ? -nySeg : nySeg;
          const offsetPx = Math.max(7, 9 * zoom);
          const txC = midC.x + inX * offsetPx;
          const tyC = midC.y + inY * offsetPx;
          const fsDim = Math.max(9, Math.min(13, 10 * zoom));
          const label =
            lenM >= 100 ? lenM.toFixed(1) + "m" : lenM.toFixed(2) + "m";
          ctx.save();
          ctx.translate(txC, tyC);
          ctx.rotate(ang);
          ctx.font = `500 ${fsDim}px Courier New`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      }
    }

    const cen = centroid(l.pts),
      cc = toC(cen.x, cen.y);
    const fs = Math.max(11, Math.min(17, 11.5 * zoom)); // Principal
    if (mznEquipamiento[i]) {
      const { icon, label } = getEquipamientoInfo(polyAreaM2(l.pts));

      ctx.fillStyle = "#e3b341";
      ctx.font = `bold ${fs}px Courier New`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${icon} Equipamiento`, cc.x, cc.y - fs * 0.75);
      if (zoom > 0.18) {
        ctx.font = `${Math.max(10, Math.min(14.5, 11.3 * zoom))}px Courier New`;
        ctx.fillText("Área de Equipamiento", cc.x, cc.y + fs * 0.15);
        ctx.fillStyle = "#e3b34199";
        ctx.font = `${Math.max(10, Math.min(12.5, 10.3 * zoom))}px Courier New`;
        ctx.fillText(label, cc.x, cc.y + fs * 1.35);
        ctx.fillText(
          `${polyAreaM2(l.pts).toFixed(0)}m²`,
          cc.x,
          cc.y + fs * 2.25,
        );
      }
    } else {
      ctx.fillStyle = c;
      ctx.font = `bold ${fs}px Courier New`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`Mzo.${i + 1}`, cc.x, cc.y);

      if (zoom > 0.28) {
        ctx.font = `${Math.max(11, Math.min(15.5, 12 * zoom))}px Courier New`;
        ctx.fillStyle = "#8b949e";
        ctx.fillText(
          `${polyAreaM2(l.pts).toFixed(0)}m²`,
          cc.x,
          cc.y + fs * 1.55,
        );
      }
    }
  }

  if (sliceSubMzn && sliceSubMzn.pts) {
    const scp = sliceSubMzn.pts.map((p) => toC(p.x, p.y));
    ctx.beginPath();
    ctx.moveTo(scp[0].x, scp[0].y);
    for (let k = 1; k < scp.length; k++) ctx.lineTo(scp[k].x, scp[k].y);
    ctx.closePath();
    ctx.fillStyle = "rgba(210,168,255,0.12)";
    ctx.fill();
    ctx.strokeStyle = "#d2a8ff";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (
    sliceSubPhase === "pickFrente" &&
    sliceMznIdx >= 0 &&
    manzanos[sliceMznIdx]
  ) {
    const mzn = manzanos[sliceMznIdx];
    const mcp = mzn.pts.map((p) => toC(p.x, p.y));
    ctx.beginPath();
    ctx.moveTo(mcp[0].x, mcp[0].y);
    for (let k = 1; k < mcp.length; k++) ctx.lineTo(mcp[k].x, mcp[k].y);
    ctx.closePath();
    ctx.strokeStyle = "#d2a8ff";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    const pts = mzn.pts,
      n = pts.length;
    let bestDist = Infinity,
      bestP1 = null,
      bestP2 = null;
    for (let i = 0; i < n; i++) {
      const a = pts[i],
        b = pts[(i + 1) % n];
      const d = distPtSeg(mousePos, toC(a.x, a.y), toC(b.x, b.y));
      if (d < bestDist) {
        bestDist = d;
        bestP1 = a;
        bestP2 = b;
      }
    }
    if (bestP1 && bestDist < 20) {
      const sc2 = toC(bestP1.x, bestP1.y),
        ec2 = toC(bestP2.x, bestP2.y);
      ctx.beginPath();
      ctx.moveTo(sc2.x, sc2.y);
      ctx.lineTo(ec2.x, ec2.y);
      ctx.strokeStyle = "#d2a8ffcc";
      ctx.lineWidth = 6;
      ctx.stroke();
    }
  }

  if (
    sliceSubPhase === "pickAux" &&
    sliceMznIdx >= 0 &&
    manzanos[sliceMznIdx]
  ) {
    const mzn = manzanos[sliceMznIdx];
    if (!sliceCutLineMode) {
      for (const seg of sliceAdjacentSegs) {
        const ac = toC(seg.a.x, seg.a.y),
          bc = toC(seg.b.x, seg.b.y);
        ctx.beginPath();
        ctx.moveTo(ac.x, ac.y);
        ctx.lineTo(bc.x, bc.y);
        ctx.strokeStyle = "#e3b341";
        ctx.lineWidth = 6;
        ctx.stroke();
      }
    } else {
      const snapC = _slicePerpSnap(mousePos, mzn.pts);
      if (snapC) {
        ctx.beginPath();
        ctx.arc(snapC.x, snapC.y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = "#58a6ff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(snapC.x, snapC.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "#58a6ff";
        ctx.fill();
      }

      if (sliceCutLineP1) {
        const p1c = toC(sliceCutLineP1.x, sliceCutLineP1.y);
        const p2c = snapC || mousePos;
        ctx.beginPath();
        ctx.moveTo(p1c.x, p1c.y);
        ctx.lineTo(p2c.x, p2c.y);
        ctx.strokeStyle = "#58a6ff";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(p1c.x, p1c.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#58a6ff";
        ctx.fill();
      }
    }

    if (sliceSelectingFrente) {
      const af = toC(sliceSelectingFrente.a.x, sliceSelectingFrente.a.y);
      const bf = toC(sliceSelectingFrente.b.x, sliceSelectingFrente.b.y);
      ctx.beginPath();
      ctx.moveTo(af.x, af.y);
      ctx.lineTo(bf.x, bf.y);
      ctx.strokeStyle = "#f85149";
      ctx.lineWidth = 5;
      ctx.stroke();
    }
  }

  if (
    sliceCutLineP1 &&
    sliceCutLineP2 &&
    (sliceSubPhase === "pickAux" ||
      sliceSubPhase === "ready" ||
      sliceSubPhase === "pickSeg")
  ) {
    const p1c = toC(sliceCutLineP1.x, sliceCutLineP1.y);
    const p2c = toC(sliceCutLineP2.x, sliceCutLineP2.y);
    ctx.beginPath();
    ctx.moveTo(p1c.x, p1c.y);
    ctx.lineTo(p2c.x, p2c.y);
    ctx.strokeStyle = "#58a6ff";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p1c.x, p1c.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#58a6ff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p2c.x, p2c.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#58a6ff";
    ctx.fill();
  }

  if (slicePickingSeg && sliceSubMzn) {
    const mcp = sliceSubMzn.pts.map((p) => toC(p.x, p.y));
    ctx.beginPath();
    ctx.moveTo(mcp[0].x, mcp[0].y);
    for (let k = 1; k < mcp.length; k++) ctx.lineTo(mcp[k].x, mcp[k].y);
    ctx.closePath();
    ctx.strokeStyle = "#d2a8ff";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    const pts = sliceSubMzn.pts,
      n = pts.length;
    let bestDist = Infinity,
      bestP1 = null,
      bestP2 = null;
    for (let i = 0; i < n; i++) {
      const a = pts[i],
        b = pts[(i + 1) % n];
      const d = distPtSeg(mousePos, toC(a.x, a.y), toC(b.x, b.y));
      if (d < bestDist) {
        bestDist = d;
        bestP1 = a;
        bestP2 = b;
      }
    }
    if (bestP1 && bestDist < 20) {
      const sc2 = toC(bestP1.x, bestP1.y),
        ec2 = toC(bestP2.x, bestP2.y);
      ctx.beginPath();
      ctx.moveTo(sc2.x, sc2.y);
      ctx.lineTo(ec2.x, ec2.y);
      ctx.strokeStyle = "#d2a8ffcc";
      ctx.lineWidth = 6;
      ctx.stroke();
    }
  }

  if (streets.length > 0) {
    const _allFillets = [];
    for (let _i = 0; _i < streets.length; _i++) {
      for (let _j = _i + 1; _j < streets.length; _j++) {
        _allFillets.push(...computeStreetFillets(streets[_i], streets[_j]));
      }
    }
    const _filteredFillets = filterStreetFillets(_allFillets, streets);

    for (const s of streets) {
      const dx = s.end.x - s.start.x,
        dy = s.end.y - s.start.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len,
        ny = dx / len,
        hw = mw(s.width / 2);
      const isSel = s.id === selStreetId;

      const corners = [
        toC(s.start.x + nx * hw, s.start.y + ny * hw),
        toC(s.end.x + nx * hw, s.end.y + ny * hw),
        toC(s.end.x - nx * hw, s.end.y - ny * hw),
        toC(s.start.x - nx * hw, s.start.y - ny * hw),
      ];

      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();

      if (isSel) {
        ctx.fillStyle = "#f7816618";
        ctx.fill();
      }
      if (isSel) {
        ctx.strokeStyle = "#f78166";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        ctx.lineTo(corners[1].x, corners[1].y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(corners[3].x, corners[3].y);
        ctx.lineTo(corners[2].x, corners[2].y);
        ctx.stroke();
      }

      const sc = toC(s.start.x, s.start.y),
        ec = toC(s.end.x, s.end.y);
      ctx.beginPath();
      ctx.moveTo(sc.x, sc.y);
      ctx.lineTo(ec.x, ec.y);
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = "#f78166bb";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      const bw = Math.max(1, 1.2 * zoom);
      ctx.strokeStyle = "#f78166";
      ctx.lineWidth = bw;
      ctx.setLineDash([]);
      drawStreetEdgeWithFillets(s, +1, _filteredFillets, streets);
      drawStreetEdgeWithFillets(s, -1, _filteredFillets, streets);
    }

    const bwFillet = Math.max(1, 1.2 * zoom);
    ctx.strokeStyle = "#f78166";
    ctx.lineWidth = bwFillet;
    ctx.setLineDash([]);
    ctx.lineCap = "round";
    for (const f of _filteredFillets) {
      ctx.beginPath();
      ctx.arc(f.acx, f.acy, f.filletPx, f.angA, f.angB, f.acw);
      ctx.stroke();
    }
    ctx.lineCap = "butt";

    for (const s of streets) {
      const dx = s.end.x - s.start.x,
        dy = s.end.y - s.start.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const sc = toC(s.start.x, s.start.y),
        ec = toC(s.end.x, s.end.y);

      if (zoom > 0.3) {
        const mid = toC((s.start.x + s.end.x) / 2, (s.start.y + s.end.y) / 2);
        const ang = Math.atan2(dy, dx);
        const streetIdx = streets.indexOf(s) + 1;
        const nombreCalle = `--- Calle ${String.fromCharCode(64 + streetIdx)} (Ancho de Vía ${s.width.toFixed(2)}m) ---`;
        const ejeTexto = "E   J   E    D   E     V   Í   A";

        ctx.save();
        ctx.translate(mid.x, mid.y);
        let ang2 = ang;
        if (ang2 > Math.PI / 2 || ang2 < -Math.PI / 2) ang2 += Math.PI;
        ctx.rotate(ang2);

        const fs1 = Math.max(9, Math.min(15.5, 11.5 * zoom));
        const fs2 = Math.max(8, Math.min(13, 10.3 * zoom));

        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#f78166dd";
        ctx.font = `bold ${fs1}px Courier New`;
        ctx.fillText(nombreCalle, 0, -fs1 * 0.7);
        ctx.fillStyle = "#f7816699";
        ctx.font = `${fs2}px Courier New`;
        ctx.fillText(ejeTexto, 0, fs2 * 0.9);
        ctx.restore();
      }

      if (mode === "edit") {
        [
          [sc, "#58a6ff", "S"],
          [ec, "#ffa657", "E"],
        ].forEach(([pt, col, lbl]) => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
          ctx.fillStyle = col;
          ctx.fill();
          ctx.strokeStyle = "#0d1117";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = "#0d1117";
          ctx.font = "bold 9px Courier New";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(lbl, pt.x, pt.y + 1);
        });

        if (
          dragHandle &&
          (dragHandle.which === "start" || dragHandle.which === "end") &&
          dragHandle.id === s.id
        ) {
          const fixedW = dragHandle.which === "start" ? s.end : s.start;
          const movingW = dragHandle.which === "start" ? s.start : s.end;
          const fixedC = toC(fixedW.x, fixedW.y);
          const movingC = toC(movingW.x, movingW.y);
          const odx = dragHandle.origEnd.x - dragHandle.origStart.x;
          const ody = dragHandle.origEnd.y - dragHandle.origStart.y;
          const olen = Math.sqrt(odx * odx + ody * ody) || 1;
          const oux = odx / olen,
            ouy = ody / olen;
          const guideLen = Math.max(canvas.width, canvas.height) / zoom;
          const guideA = toC(
            fixedW.x - oux * guideLen,
            fixedW.y - ouy * guideLen,
          );
          const guideB = toC(
            fixedW.x + oux * guideLen,
            fixedW.y + ouy * guideLen,
          );
          ctx.save();
          ctx.setLineDash([6, 5]);
          ctx.strokeStyle = "#ffffff22";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(guideA.x, guideA.y);
          ctx.lineTo(guideB.x, guideB.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle = dragHandle.freeMode ? "#ffa657" : "#3fb950";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(fixedC.x, fixedC.y);
          ctx.lineTo(movingC.x, movingC.y);
          ctx.stroke();
          const midC = {
            x: (fixedC.x + movingC.x) / 2,
            y: (fixedC.y + movingC.y) / 2,
          };
          const modeLabel = dragHandle.freeMode ? "↗ LIBRE" : "→ EJE";
          const modeCol = dragHandle.freeMode ? "#ffa657" : "#3fb950";
          ctx.fillStyle = modeCol;
          ctx.font = "bold 10px Courier New";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(modeLabel, midC.x, midC.y - 6);
          ctx.restore();
        }
      }
    }
  }
  for (const [idxStr, seg] of Object.entries(mznSegments)) {
    const sc = toC(seg.p1.x, seg.p1.y),
      ec = toC(seg.p2.x, seg.p2.y);
    ctx.beginPath();
    ctx.moveTo(sc.x, sc.y);
    ctx.lineTo(ec.x, ec.y);
    ctx.strokeStyle = "#e3b341";
    ctx.lineWidth = 3.5;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#e3b341";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ec.x, ec.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#e3b341";
    ctx.fill();
  }
  if (pickingSegForMzn >= 0 && manzanos[pickingSegForMzn]) {
    const mzn = manzanos[pickingSegForMzn];
    const mcp = mzn.pts.map((p) => toC(p.x, p.y));
    ctx.beginPath();
    ctx.moveTo(mcp[0].x, mcp[0].y);
    for (let k = 1; k < mcp.length; k++) ctx.lineTo(mcp[k].x, mcp[k].y);
    ctx.closePath();
    ctx.strokeStyle = "#f78166";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    const wp = toW(mousePos.x, mousePos.y);
    const pts = mzn.pts,
      n = pts.length;
    let bestDist = Infinity,
      bestP1 = null,
      bestP2 = null;
    for (let i = 0; i < n; i++) {
      const a = pts[i],
        b = pts[(i + 1) % n];
      const d = distPtSeg(wp, a, b);
      if (d < bestDist) {
        bestDist = d;
        bestP1 = a;
        bestP2 = b;
      }
    }
    if (bestP1 && bestDist < 20 / zoom) {
      const sc = toC(bestP1.x, bestP1.y),
        ec = toC(bestP2.x, bestP2.y);
      ctx.beginPath();
      ctx.moveTo(sc.x, sc.y);
      ctx.lineTo(ec.x, ec.y);
      ctx.strokeStyle = "#e3b341cc";
      ctx.lineWidth = 6;
      ctx.setLineDash([]);
      ctx.stroke();
    }
  }
  if (!polyClosed && polyPts.length > 0) {
    const cp = polyPts.map((p) => toC(p.x, p.y));
    ctx.beginPath();
    ctx.moveTo(cp[0].x, cp[0].y);
    for (let i = 1; i < cp.length; i++) ctx.lineTo(cp[i].x, cp[i].y);
    ctx.lineTo(mousePos.x, mousePos.y);
    ctx.strokeStyle = "#58a6ff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of cp) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#58a6ff";
      ctx.fill();
    }
    if (
      polyPts.length >= 3 &&
      Math.hypot(mousePos.x - cp[0].x, mousePos.y - cp[0].y) < 14
    ) {
      ctx.beginPath();
      ctx.arc(cp[0].x, cp[0].y, 12, 0, Math.PI * 2);
      ctx.strokeStyle = "#3fb950";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    for (let i = 0; i < polyPts.length; i++) {
      const pA = polyPts[i];
      const pB = i < polyPts.length - 1 ? polyPts[i + 1] : null;
      if (!pB) continue;
      const dxW = pB.x - pA.x,
        dyW = pB.y - pA.y;
      const lenM = Math.sqrt(dxW * dxW + dyW * dyW) * MPP;
      if (lenM < 0.1) continue;
      const midC = {
        x: (cp[i].x + cp[i + 1].x) / 2,
        y: (cp[i].y + cp[i + 1].y) / 2,
      };

      let ang = Math.atan2(dyW, dxW);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      const segLen = Math.sqrt(dxW * dxW + dyW * dyW) || 1;
      const nxSeg = -dyW / segLen,
        nySeg = dxW / segLen;
      const offsetPx = 14;
      const label =
        lenM >= 100 ? lenM.toFixed(1) + " m" : lenM.toFixed(2) + " m";
      const fsSeg = Math.max(9, Math.min(13, 10 * zoom));
      ctx.save();
      ctx.translate(midC.x + nxSeg * offsetPx, midC.y + nySeg * offsetPx);
      ctx.rotate(ang);
      ctx.font = `600 ${fsSeg}px Courier New`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(13,17,23,0.80)";
      ctx.fillRect(-tw / 2 - 2, -fsSeg / 2 - 1, tw + 4, fsSeg + 2);
      ctx.fillStyle = "#58a6ffee";
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }

    if (polyPts.length >= 1) {
      const lastW = polyPts[polyPts.length - 1];
      const lastC = cp[cp.length - 1];
      const curW = toW(mousePos.x, mousePos.y);
      const dxW = curW.x - lastW.x,
        dyW = curW.y - lastW.y;
      const lenM = Math.sqrt(dxW * dxW + dyW * dyW) * MPP;
      if (lenM > 0.1) {
        const midC = {
          x: (lastC.x + mousePos.x) / 2,
          y: (lastC.y + mousePos.y) / 2,
        };
        let ang = Math.atan2(dyW, dxW);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        const segLen = Math.sqrt(dxW * dxW + dyW * dyW) || 1;
        const nxSeg = -dyW / segLen,
          nySeg = dxW / segLen;
        const offsetPx = 14;
        const label =
          lenM >= 100 ? lenM.toFixed(1) + " m" : lenM.toFixed(2) + " m";
        const fsSeg = Math.max(9, Math.min(13, 10 * zoom));
        ctx.save();
        ctx.translate(midC.x + nxSeg * offsetPx, midC.y + nySeg * offsetPx);
        ctx.rotate(ang);
        ctx.font = `600 ${fsSeg}px Courier New`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(13,17,23,0.80)";
        ctx.fillRect(-tw / 2 - 2, -fsSeg / 2 - 1, tw + 4, fsSeg + 2);
        ctx.fillStyle = "#ffa657ee";
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }

  if (
    showGuideLines &&
    mode === "street" &&
    polyClosed &&
    dxfGuideLines &&
    dxfGuideLines.length > 0
  ) {
    for (const guide of dxfGuideLines) {
      if (!guide.pts || guide.pts.length < 2) continue;
      for (const p of guide.pts) {
        const pc = toC(p.x, p.y);
        const isSnap =
          snapTarget &&
          snapTarget.type === "vertex" &&
          snapTarget.isGuide &&
          Math.hypot(p.x - snapTarget.x, p.y - snapTarget.y) < 1e-9;
        ctx.beginPath();
        ctx.arc(pc.x, pc.y, isSnap ? 8 : 3, 0, Math.PI * 2);
        ctx.fillStyle = isSnap ? "#79c0ff" : "rgba(121,192,255,0.35)";
        ctx.fill();
        ctx.strokeStyle = isSnap ? "#79c0ffcc" : "rgba(121,192,255,0.5)";
        ctx.lineWidth = isSnap ? 2 : 1;
        ctx.stroke();
        if (isSnap) {
          ctx.beginPath();
          ctx.moveTo(pc.x - 4, pc.y);
          ctx.lineTo(pc.x + 4, pc.y);
          ctx.moveTo(pc.x, pc.y - 4);
          ctx.lineTo(pc.x, pc.y + 4);
          ctx.strokeStyle = "#0d1117";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          const mp2 = ptWM(p);
          ctx.fillStyle = "#79c0ff";
          ctx.font = "9px Courier New";
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          ctx.fillText(
            `${mp2.x.toFixed(1)}, ${mp2.y.toFixed(1)}`,
            pc.x + 10,
            pc.y - 4,
          );
        }
      }
    }
  }
  if (
    mode === "street" &&
    polyClosed &&
    snapTarget &&
    snapTarget.type === "segExtend"
  ) {
    const anchor = snapTarget.anchor;
    const anchorC = toC(anchor.x, anchor.y);
    const snapC = toC(snapTarget.x, snapTarget.y);
    const rayLen = Math.hypot(snapC.x - anchorC.x, snapC.y - anchorC.y) + 10;
    const rayEndX = anchorC.x - snapTarget.dirX * rayLen;
    const rayEndY = anchorC.y - snapTarget.dirY * rayLen;
    ctx.save();
    ctx.setLineDash([4, 2]);
    ctx.strokeStyle = "rgba(88,166,255,0.65)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(anchorC.x, anchorC.y);
    ctx.lineTo(rayEndX, rayEndY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(anchorC.x, anchorC.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#58a6ff";
    ctx.fill();
    ctx.strokeStyle = "#0d1117";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(snapC.x, snapC.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(88,166,255,0.25)";
    ctx.fill();
    ctx.strokeStyle = "#58a6ff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(snapC.x - 4, snapC.y);
    ctx.lineTo(snapC.x + 4, snapC.y);
    ctx.moveTo(snapC.x, snapC.y - 4);
    ctx.lineTo(snapC.x, snapC.y + 4);
    ctx.strokeStyle = "#0d1117";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const distM = snapTarget.dot * MPP;
    const mp2 = ptWM(snapTarget);
    ctx.fillStyle = "#58a6ff";
    ctx.font = "9px Courier New";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(
      `ext ${distM.toFixed(1)}m  (${mp2.x.toFixed(1)}, ${mp2.y.toFixed(1)})`,
      snapC.x + 12,
      snapC.y - 4,
    );
    ctx.restore();
  }

  if (mode === "street" && polyClosed) {
    if (snapTarget && snapTarget.type === "perp" && snapTarget.segA) {
      const sa = toC(snapTarget.segA.x, snapTarget.segA.y);
      const sb = toC(snapTarget.segB.x, snapTarget.segB.y);
      const sp = toC(snapTarget.x, snapTarget.y);
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.strokeStyle = "#79c0ff88";
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(mousePos.x, mousePos.y);
      ctx.strokeStyle = "#79c0ff55";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      const dx = snapTarget.segB.x - snapTarget.segA.x;
      const dy = snapTarget.segB.y - snapTarget.segA.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len,
        uy = dy / len; // dirección del segmento
      const nx = -uy,
        ny = ux; // normal al segmento
      const SQ = 7; // tamaño del cuadradito en px
      const sq1 = { x: sp.x + ux * SQ, y: sp.y + uy * SQ };
      const sq2 = {
        x: sp.x + ux * SQ + nx * SQ,
        y: sp.y + uy * SQ + ny * SQ,
      };
      const sq3 = { x: sp.x + nx * SQ, y: sp.y + ny * SQ };
      ctx.beginPath();
      ctx.moveTo(sq1.x, sq1.y);
      ctx.lineTo(sq2.x, sq2.y);
      ctx.lineTo(sq3.x, sq3.y);
      ctx.strokeStyle = "#79c0ffcc";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.stroke();
    }
    for (const mzn of manzanos) {
      for (const p of mzn.pts) {
        const pc = toC(p.x, p.y);
        const isSnap =
          snapTarget &&
          snapTarget.type === "vertex" &&
          Math.hypot(p.x - snapTarget.x, p.y - snapTarget.y) < 1e-9;
        ctx.beginPath();
        ctx.arc(pc.x, pc.y, isSnap ? 8 : 4, 0, Math.PI * 2);
        ctx.fillStyle = isSnap ? "#3fb950" : "#58a6ff44";
        ctx.fill();
        ctx.strokeStyle = isSnap ? "#3fb950" : "#58a6ff88";
        ctx.lineWidth = isSnap ? 2 : 1;
        ctx.stroke();
        if (isSnap) {
          ctx.beginPath();
          ctx.moveTo(pc.x - 4, pc.y);
          ctx.lineTo(pc.x + 4, pc.y);
          ctx.moveTo(pc.x, pc.y - 4);
          ctx.lineTo(pc.x, pc.y + 4);
          ctx.strokeStyle = "#0d1117";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          const mp2 = ptWM(p);
          ctx.fillStyle = "#3fb950";
          ctx.font = "9px Courier New";
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          ctx.fillText(
            `${mp2.x.toFixed(1)}, ${mp2.y.toFixed(1)}`,
            pc.x + 10,
            pc.y - 4,
          );
        }
      }
    }
    if (snapTarget && snapTarget.type === "perp") {
      const sp = toC(snapTarget.x, snapTarget.y);
      const mp2 = ptWM(snapTarget);
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y - 9);
      ctx.lineTo(sp.x + 9, sp.y);
      ctx.lineTo(sp.x, sp.y + 9);
      ctx.lineTo(sp.x - 9, sp.y);
      ctx.closePath();
      ctx.fillStyle = "#79c0ff33";
      ctx.fill();
      ctx.strokeStyle = "#79c0ffcc";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sp.x - 4, sp.y);
      ctx.lineTo(sp.x + 4, sp.y);
      ctx.moveTo(sp.x, sp.y - 4);
      ctx.lineTo(sp.x, sp.y + 4);
      ctx.strokeStyle = "#0d1117";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#79c0ff";
      ctx.font = "9px Courier New";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        `⊥ ${mp2.x.toFixed(1)}, ${mp2.y.toFixed(1)}`,
        sp.x + 12,
        sp.y - 4,
      );
    }
  }

  if (mode === "street" && streetStart) {
    const snapC = snapTarget ? toC(snapTarget.x, snapTarget.y) : null;
    const mc = snapC || mousePos;
    const sc = toC(streetStart.x, streetStart.y);
    const ddx = mc.x - sc.x,
      ddy = mc.y - sc.y,
      dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
    const dnx = -ddy / dl,
      dny = ddx / dl,
      hw = mw(swVal / 2) * zoom;
    ctx.beginPath();
    ctx.moveTo(sc.x + dnx * hw, sc.y + dny * hw);
    ctx.lineTo(mc.x + dnx * hw, mc.y + dny * hw);
    ctx.lineTo(mc.x - dnx * hw, mc.y - dny * hw);
    ctx.lineTo(sc.x - dnx * hw, sc.y - dny * hw);
    ctx.closePath();
    ctx.fillStyle = "#f7816640";
    ctx.fill();
    ctx.strokeStyle = "#f78166";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sc.x, sc.y);
    ctx.lineTo(mc.x, mc.y);
    ctx.setLineDash([8, 4]);
    ctx.strokeStyle = "#f78166cc";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    const lenM = ((dl / zoom) * MPP).toFixed(1);
    ctx.fillStyle = "#f78166";
    ctx.font = "11px Courier New";
    ctx.textAlign = "center";
    ctx.fillText(
      `${swVal}m ancho · ${lenM}m largo`,
      (sc.x + mc.x) / 2,
      (sc.y + mc.y) / 2 - 14,
    );
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#58a6ff";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mc.x, mc.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffa657";
    ctx.fill();
  }

  if (showGuideLines && dxfGuideLines && dxfGuideLines.length > 0) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(121,192,255,0.45)";
    ctx.lineWidth = 1;
    for (const guide of dxfGuideLines) {
      if (!guide.pts || guide.pts.length < 2) continue;
      const gcp = guide.pts.map((p) => toC(p.x, p.y));
      ctx.beginPath();
      ctx.moveTo(gcp[0].x, gcp[0].y);
      for (let k = 1; k < gcp.length; k++) ctx.lineTo(gcp[k].x, gcp[k].y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawScaleBar();
}
function drawScaleBar() {
  const MARGIN = 16;
  const BAR_H = 5;
  const TARGET_PX = 120;
  const mPerPx = MPP / zoom;
  const rawM = TARGET_PX * mPerPx;
  const exp = Math.pow(10, Math.floor(Math.log10(rawM)));
  const steps = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000];
  let niceM = steps[0] * exp;
  for (const s of steps) {
    const candidate = s * (s < 10 ? exp : 1);
    if (candidate <= rawM * 1.6) niceM = candidate;
  }

  if (niceM < 0.01) niceM = 0.01;
  const barPx = niceM / mPerPx;
  const x2 = canvas.width - MARGIN;
  const x1 = x2 - barPx;
  const y = canvas.height - MARGIN;
  ctx.save();
  ctx.fillStyle = "rgba(13,17,23,0.72)";
  ctx.beginPath();
  ctx.roundRect
    ? ctx.roundRect(x1 - 10, y - BAR_H - 18, barPx + 20, BAR_H + 26, 4)
    : ctx.rect(x1 - 10, y - BAR_H - 18, barPx + 20, BAR_H + 26);
  ctx.fill();
  const SEGS = 4;
  const segW = barPx / SEGS;
  for (let s = 0; s < SEGS; s++) {
    ctx.fillStyle = s % 2 === 0 ? "#e6edf3" : "#58a6ff";
    ctx.fillRect(x1 + s * segW, y - BAR_H / 2, segW, BAR_H);
  }

  ctx.strokeStyle = "#e6edf3";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y - BAR_H / 2 - 3);
  ctx.lineTo(x1, y + BAR_H / 2 + 3);
  ctx.moveTo(x2, y - BAR_H / 2 - 3);
  ctx.lineTo(x2, y + BAR_H / 2 + 3);
  ctx.stroke();
  const label =
    niceM >= 1000
      ? (niceM / 1000).toLocaleString("es-BO") + " km"
      : niceM % 1 === 0
        ? niceM.toFixed(0) + " m"
        : niceM.toFixed(2) + " m";

  ctx.font = "bold 11px Courier New";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#e6edf3";
  ctx.fillText(label, (x1 + x2) / 2, y - BAR_H / 2 - 5);
  ctx.font = "10px Courier New";
  ctx.textAlign = "left";
  ctx.fillStyle = "#8b949e";
  ctx.fillText("0", x1, y - BAR_H / 2 - 5);

  ctx.restore();
}

function getStreetWidthForSide(mznPts, segA, segB) {
  const mx = (segA.x + segB.x) / 2,
    my = (segA.y + segB.y) / 2;
  const dx = segB.x - segA.x,
    dy = segB.y - segA.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = -dy / len,
    ny = dx / len;
  const cen = centroid(mznPts);
  const dot = (mx + nx - cen.x) * nx + (my + ny - cen.y) * ny;
  const outX = dot >= 0 ? nx : -nx,
    outY = dot >= 0 ? ny : -ny;
  let bestW = 0;
  const PROBE = mw(30); // hasta 30 m de búsqueda
  for (const s of streets) {
    const rect = streetRect(s);
    if (!rect) continue;
    const px = mx + outX,
      py = my + outY;
    if (slicePtInPoly(px, py, rect)) {
      if (s.width > bestW) bestW = s.width;
    }
    const px2 = mx + outX * mw(s.width / 2 + 2),
      py2 = my + outY * mw(s.width / 2 + 2);
    if (slicePtInPoly(px2, py2, rect)) {
      if (s.width > bestW) bestW = s.width;
    }
  }
  return bestW;
}

function streetWidthToOffset(w) {
  if (w <= 0) return 1.2;
  if (w <= 8) return 1.2 + (w / 8) * 0.2; // 1.2 → 1.4
  if (w <= 12) return 1.4 + ((w - 8) / 4) * 0.2; // 1.4 → 1.6
  if (w <= 16) return 1.6 + ((w - 12) / 4) * 0.4; // 1.6 → 2.0
  return 2.0 + ((w - 16) / 16) * 0.5; // > 16 m: sube levemente
}

function angleBetweenSegs(pPrev, pCur, pNext) {
  const ax = pPrev.x - pCur.x,
    ay = pPrev.y - pCur.y;
  const bx = pNext.x - pCur.x,
    by = pNext.y - pCur.y;
  const la = Math.sqrt(ax * ax + ay * ay) || 1e-9;
  const lb = Math.sqrt(bx * bx + by * by) || 1e-9;
  const dot = (ax * bx + ay * by) / (la * lb);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

function arcRadiusForAngle(angleDeg) {
  if (angleDeg < 45) return 2;
  if (angleDeg < 70) return 2.5;
  if (angleDeg < 120) return 3.1;
  if (angleDeg <= 160) return 4;
  return 6;
}
function buildSidewalkPath(mznPts) {
  const n = mznPts.length;
  if (n < 3) return null;
  const sideOffsets = [];
  for (let i = 0; i < n; i++) {
    const a = mznPts[i],
      b = mznPts[(i + 1) % n];
    const sw = getStreetWidthForSide(mznPts, a, b);
    sideOffsets.push(mw(streetWidthToOffset(sw)));
  }

  const cen = centroid(mznPts);
  const offsetLines = [];
  for (let i = 0; i < n; i++) {
    const a = mznPts[i],
      b = mznPts[(i + 1) % n];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    let nx = -dy / len,
      ny = dx / len;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((cen.x - mid.x) * nx + (cen.y - mid.y) * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const off = sideOffsets[i];
    offsetLines.push({
      ax: a.x + nx * off,
      ay: a.y + ny * off,
      bx: b.x + nx * off,
      by: b.y + ny * off,
      nx,
      ny,
    });
  }

  const corners = [];
  for (let i = 0; i < n; i++) {
    const l1 = offsetLines[i];
    const l2 = offsetLines[(i + 1) % n];
    const pt = lineLineIntersect(
      { x: l1.ax, y: l1.ay },
      { x: l1.bx, y: l1.by },
      { x: l2.ax, y: l2.ay },
      { x: l2.bx, y: l2.by },
    );
    corners.push(
      pt || {
        x: (l1.bx + l2.ax) / 2,
        y: (l1.by + l2.ay) / 2,
      },
    );
  }

  const path = new Path2D();
  for (let i = 0; i < n; i++) {
    const pPrev = mznPts[(i - 1 + n) % n];
    const pCur = mznPts[i];
    const pNext = mznPts[(i + 1) % n];
    const angleDeg = angleBetweenSegs(pPrev, pCur, pNext);
    const radiusM = arcRadiusForAngle(angleDeg);
    const radiusW = mw(radiusM);
    const vc = toC(corners[i].x, corners[i].y);
    const vPrev = toC(corners[(i - 1 + n) % n].x, corners[(i - 1 + n) % n].y);
    const vNext = toC(corners[(i + 1) % n].x, corners[(i + 1) % n].y);
    const dPx = vPrev.x - vc.x,
      dPy = vPrev.y - vc.y;
    const dNx = vNext.x - vc.x,
      dNy = vNext.y - vc.y;
    const lP = Math.sqrt(dPx * dPx + dPy * dPy) || 1;
    const lN = Math.sqrt(dNx * dNx + dNy * dNy) || 1;
    const radiusPx = radiusW * zoom;
    const tDist = Math.min(radiusPx, lP * 0.45, lN * 0.45);
    const tPx = vc.x + (dPx / lP) * tDist;
    const tPy = vc.y + (dPy / lP) * tDist;
    const tNx = vc.x + (dNx / lN) * tDist;
    const tNy = vc.y + (dNy / lN) * tDist;

    if (i === 0) {
      path.moveTo(tPx, tPy);
    } else {
      path.lineTo(tPx, tPy);
    }
    path.quadraticCurveTo(vc.x, vc.y, tNx, tNy);
  }
  {
    const vc = toC(corners[0].x, corners[0].y);
    const vPrev = toC(corners[n - 1].x, corners[n - 1].y);
    const vNext = toC(corners[1].x, corners[1].y);
    const dPx = vPrev.x - vc.x,
      dPy = vPrev.y - vc.y;
    const dNx = vNext.x - vc.x,
      dNy = vNext.y - vc.y;
    const lP = Math.sqrt(dPx * dPx + dPy * dPy) || 1;
    const lN = Math.sqrt(dNx * dNx + dNy * dNy) || 1;
    const radiusPx =
      mw(
        arcRadiusForAngle(
          angleBetweenSegs(mznPts[n - 1], mznPts[0], mznPts[1]),
        ),
      ) * zoom;
    const tDist = Math.min(radiusPx, lP * 0.45, lN * 0.45);
    const tPx = vc.x + (dPx / lP) * tDist;
    const tPy = vc.y + (dPy / lP) * tDist;
    path.lineTo(tPx, tPy);
  }
  path.closePath();
  return path;
}

function buildSidewalkWorldPts(mznPts) {
  const n = mznPts.length;
  if (n < 3) return null;

  const sideOffsets = [];
  for (let i = 0; i < n; i++) {
    const a = mznPts[i],
      b = mznPts[(i + 1) % n];
    const sw = getStreetWidthForSide(mznPts, a, b);
    sideOffsets.push(mw(streetWidthToOffset(sw)));
  }

  const cen = centroid(mznPts);
  const offsetLines = [];
  for (let i = 0; i < n; i++) {
    const a = mznPts[i],
      b = mznPts[(i + 1) % n];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    let nx = -dy / len,
      ny = dx / len;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((cen.x - mid.x) * nx + (cen.y - mid.y) * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    const off = sideOffsets[i];
    offsetLines.push({
      ax: a.x + nx * off,
      ay: a.y + ny * off,
      bx: b.x + nx * off,
      by: b.y + ny * off,
    });
  }

  const corners = [];
  for (let i = 0; i < n; i++) {
    const l1 = offsetLines[i];
    const l2 = offsetLines[(i + 1) % n];
    const pt = lineLineIntersect(
      { x: l1.ax, y: l1.ay },
      { x: l1.bx, y: l1.by },
      { x: l2.ax, y: l2.ay },
      { x: l2.bx, y: l2.by },
    );
    corners.push(pt || { x: (l1.bx + l2.ax) / 2, y: (l1.by + l2.ay) / 2 });
  }

  if (corners.length < 3) return null;
  const ARC_STEPS = 6;
  const result = [];
  for (let i = 0; i < n; i++) {
    const pPrev = mznPts[(i - 1 + n) % n];
    const pCur = mznPts[i];
    const pNext = mznPts[(i + 1) % n];
    const angleDeg = angleBetweenSegs(pPrev, pCur, pNext);
    const radiusM = arcRadiusForAngle(angleDeg);
    const radiusW = mw(radiusM);
    const vc = corners[i];
    const vPrev = corners[(i - 1 + n) % n];
    const vNext = corners[(i + 1) % n];
    const dPx = vPrev.x - vc.x,
      dPy = vPrev.y - vc.y;
    const dNx = vNext.x - vc.x,
      dNy = vNext.y - vc.y;
    const lP = Math.sqrt(dPx * dPx + dPy * dPy) || 1;
    const lN = Math.sqrt(dNx * dNx + dNy * dNy) || 1;
    const tDist = Math.min(radiusW, lP * 0.45, lN * 0.45);
    const tPx = vc.x + (dPx / lP) * tDist;
    const tPy = vc.y + (dPy / lP) * tDist;
    const tNx = vc.x + (dNx / lN) * tDist;
    const tNy = vc.y + (dNy / lN) * tDist;
    result.push({ x: tPx, y: tPy });
    for (let s = 1; s < ARC_STEPS; s++) {
      const t = s / ARC_STEPS;
      const mt = 1 - t;
      const qx = mt * mt * tPx + 2 * mt * t * vc.x + t * t * tNx;
      const qy = mt * mt * tPy + 2 * mt * t * vc.y + t * t * tNy;
      result.push({ x: qx, y: qy });
    }
    result.push({ x: tNx, y: tNy });
  }

  return result.length >= 3 ? result : null;
}

function drawGrid() {
  const step = 50,
    o = toC(0, 0);
  const x0 = Math.floor((0 - o.x) / zoom / step) * step,
    y0 = Math.floor((0 - o.y) / zoom / step) * step;
  ctx.strokeStyle = "#1c2128";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let x = x0; x < x0 + canvas.width / zoom + step; x += step) {
    const c = toC(x, 0);
    ctx.moveTo(c.x, 0);
    ctx.lineTo(c.x, canvas.height);
  }
  for (let y = y0; y < y0 + canvas.height / zoom + step; y += step) {
    const c = toC(0, y);
    ctx.moveTo(0, c.y);
    ctx.lineTo(canvas.width, c.y);
  }
  ctx.stroke();
  ctx.strokeStyle = "#2d333b";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(o.x, 0);
  ctx.lineTo(o.x, canvas.height);
  ctx.moveTo(0, o.y);
  ctx.lineTo(canvas.width, o.y);
  ctx.stroke();
}

