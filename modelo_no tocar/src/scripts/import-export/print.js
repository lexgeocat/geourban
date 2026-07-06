//===================INICIO IMPRIMIR===========================================================
let _planCanvas = null;
let _printPan = { x: 0, y: 0 };
let _printZoom = 1;

function printPlan() {
  if (manzanos.length === 0 && polyPts.length === 0) {
    alert("No hay datos para imprimir. Dibujá una parcela primero.");
    return;
  }
  document.getElementById("printModal").style.display = "flex";
  setTimeout(() => _renderPlanCanvas(), 120);
}

function closePrintModal() {
  document.getElementById("printModal").style.display = "none";
}

function regeneratePlan() {
  _renderPlanCanvas();
}

function downloadPlanoPDF() {
  if (!_planCanvas) return;
  _exportPlanPDF();
}

function _exportPlanPDF() {
  const imgData = _planCanvas.toDataURL("image/jpeg", 0.97);
  const W_MM = 1189,
    H_MM = 841; // A0 apaisado
  function tryPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: [1189, 841],
    });
    doc.addImage(imgData, "JPEG", 0, 0, W_MM, H_MM);
    const fecha = new Date().toISOString().slice(0, 10);
    doc.save(`plano_urbanizacion_${fecha}.pdf`);
  }

  if (window.jspdf) {
    tryPDF();
    return;
  }
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
  s.onload = tryPDF;
  s.onerror = () => {
    alert("No se pudo cargar jsPDF. Descargando como PNG en su lugar.");
    _downloadPlanoPNG();
  };
  document.head.appendChild(s);
}

function _downloadPlanoPNG() {
  if (!_planCanvas) return;
  const a = document.createElement("a");
  a.href = _planCanvas.toDataURL("image/png");
  a.download = `plano_urbanizacion_${new Date().toISOString().slice(0, 10)}.png`;
  a.click();
}

function _renderPlanCanvas() {
  const planEl = document.getElementById("planCanvas");
  _planCanvas = planEl;
  const DPI = 150;
  const PW = Math.round((1189 / 25.4) * DPI);
  const PH = Math.round((841 / 25.4) * DPI);
  planEl.width = PW;
  planEl.height = PH;
  const pc = planEl.getContext("2d");
  pc.fillStyle = "#ffffff";
  pc.fillRect(0, 0, PW, PH);
  const MARGIN = 120;
  const CAJW = 1200; // Ancho del cajeton derecho para info adicional (textos, escala gráfica, logo)
  const GAP = 30;
  const MAP_X = MARGIN;
  const MAP_Y = MARGIN;
  const MAP_W = PW - MARGIN * 2 - CAJW - GAP;
  const MAP_H = PH - MARGIN * 2;
  const CJX = PW - MARGIN - CAJW;

  let allPts = [];
  if (polyPts.length > 0) allPts = polyPts.slice();
  for (const mzn of manzanos) allPts = allPts.concat(mzn.pts);
  // Incluir también los vértices de los rectángulos de calles en el bounding box
  for (const s of streets) {
    const rect = streetRect(s);
    if (rect) allPts = allPts.concat(rect);
  }
  if (allPts.length === 0) return;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of allPts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const PAD = 80;
  const availW = MAP_W - PAD * 2;
  const availH = MAP_H - PAD * 2;
  const spanW = maxX - minX || 1;
  const spanH = maxY - minY || 1;
  const scaleF = Math.min(availW / spanW, availH / spanH);
  const drawW = spanW * scaleF;
  const drawH = spanH * scaleF;
  const baseOffX = MAP_X + PAD + (availW - drawW) / 2;
  const baseOffY = MAP_Y + PAD + (availH - drawH) / 2;
  _printZoom = scaleF;
  _printPan = {
    x: baseOffX - minX * scaleF,
    y: baseOffY - minY * scaleF,
  };
  window._textScale = PH / 4961;

  function pToC(wx, wy) {
    return {
      x: wx * _printZoom + _printPan.x,
      y: wy * _printZoom + _printPan.y,
    };
  }
  pc.save();
  pc.beginPath();
  pc.rect(MAP_X, MAP_Y, MAP_W, MAP_H);
  pc.clip();
  pc.fillStyle = "#ffffff";
  pc.fillRect(MAP_X, MAP_Y, MAP_W, MAP_H);
  _printRenderManzanos(pc, pToC, scaleF);
  _printRenderStreets(pc, pToC, scaleF);
  _printRenderMznSegments(pc, pToC);
  _printRenderPolyPts(pc, pToC, scaleF);
  _drawPlanScaleBar(
    pc,
    MAP_X + 36,
    MAP_Y + MAP_H - 120,
    scaleF,
    "#333333",
    PW,
    DPI,
  );
  const _logoSai = new Image();
  _logoSai.src = "assets/sai.png";
  _logoSai.onload = () => {
    const _logoH = 560; // solo controlás el alto
    const _logoW = (_logoSai.naturalWidth / _logoSai.naturalHeight) * _logoH;
    pc.drawImage(
      _logoSai,
      MAP_X + MAP_W - _logoW - 60,
      MAP_Y + 60,
      _logoW,
      _logoH,
    );
  };
  pc.restore();
  function roundRect(ctx, rx, ry, rw, rh, radius) {
    ctx.beginPath();
    ctx.moveTo(rx + radius, ry);
    ctx.lineTo(rx + rw - radius, ry);
    ctx.arcTo(rx + rw, ry, rx + rw, ry + radius, radius);
    ctx.lineTo(rx + rw, ry + rh - radius);
    ctx.arcTo(rx + rw, ry + rh, rx + rw - radius, ry + rh, radius);
    ctx.lineTo(rx + radius, ry + rh);
    ctx.arcTo(rx, ry + rh, rx, ry + rh - radius, radius);
    ctx.lineTo(rx, ry + radius);
    ctx.arcTo(rx, ry, rx + radius, ry, radius);
    ctx.closePath();
  }

  const CORNER_R = 55; // radio de esquinas redondeadas del mapa
  const INNER_GAP = 14; // separación borde exterior / interior decorativo
  pc.strokeStyle = "#111111";
  pc.lineWidth = 10;
  roundRect(pc, MARGIN, MARGIN, MAP_W, MAP_H, CORNER_R);
  pc.stroke();
  pc.strokeStyle = "#999999";
  pc.lineWidth = 2;
  roundRect(
    pc,
    MARGIN + INNER_GAP,
    MARGIN + INNER_GAP,
    MAP_W - INNER_GAP * 2,
    MAP_H - INNER_GAP * 2,
    CORNER_R - 8,
  );
  pc.stroke();
  pc.strokeStyle = "#111111";
  pc.lineWidth = 16;
  roundRect(pc, CJX, MARGIN, CAJW, MAP_H, CORNER_R);
  pc.stroke();
  pc.strokeStyle = "#999999";
  pc.lineWidth = 2;
  roundRect(
    pc,
    CJX + INNER_GAP,
    MARGIN + INNER_GAP,
    CAJW - INNER_GAP * 2,
    MAP_H - INNER_GAP * 2,
    CORNER_R - 8,
  );
  pc.stroke();

  _drawCajeton(pc, CJX, MARGIN, CAJW, MAP_H, scaleF);
}

function _printRenderManzanos(pc, pToC, scaleF) {
  const zoom = _printZoom;
  const TS = window._textScale || 1; // factor tipográfico automático
  const PRINT_MZN_COLORS = [
    "#444444",
    "#555555",
    "#333333",
    "#666666",
    "#777777",
    "#222222",
    "#888888",
    "#999999",
    "#111111",
    "#aaaaaa",
  ];
  let _mznLetraIdx = 0;
  let _equipNumIdx = 1;

  for (let i = 0; i < manzanos.length; i++) {
    const l = manzanos[i];
    const c = PRINT_MZN_COLORS[l.colorIdx] || "#444444";
    const sub = showLots ? lotSubdivisions.find((s) => s.mznIdx === i) : null;
    const unifiedLots = [];
    if (sub && sub.lots.length > 0) {
      sub.lots.forEach((lt) =>
        unifiedLots.push({ ...lt, _type: "auto", _color: c }),
      );
    }
    sliceLots
      .filter((sd) => sd.mznIdx === i)
      .forEach((sd) => {
        sd.lots.forEach((lt) =>
          unifiedLots.push({ ...lt, _type: "slice", _color: "#888888" }),
        );
      });
    if (unifiedLots.length > 0) {
      for (let j = 0; j < unifiedLots.length; j++) {
        const lt = unifiedLots[j];
        const lcp = lt.pts.map((p) => pToC(p.x, p.y));
        pc.beginPath();
        pc.moveTo(lcp[0].x, lcp[0].y);
        for (let k = 1; k < lcp.length; k++) pc.lineTo(lcp[k].x, lcp[k].y);
        pc.closePath();
        if (lt.isRemnant) {
          pc.setLineDash([4, 3]);
          pc.strokeStyle = "#999999";
          pc.lineWidth = 0.8;
          pc.stroke();
          pc.setLineDash([]);
        } else {
          pc.strokeStyle = lt._type === "slice" ? "#666666" : c;
          pc.lineWidth = 0.8;
          pc.stroke();
        }
        const lcen = centroid(lt.pts);
        const lcc = pToC(lcen.x, lcen.y);
        const la = lt.areaM2 !== undefined ? lt.areaM2 : polyAreaM2(lt.pts);
        const fs2 = Math.max(20 * TS, Math.min(38 * TS, 26 * zoom * TS));

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
        pc.save();
        pc.translate(lcc.x, lcc.y);
        pc.rotate(longestAngle);
        pc.fillStyle = lt.isRemnant ? "#888888" : "#222222";
        pc.font = `bold ${fs2}px Courier New`;
        pc.textAlign = "center";
        pc.textBaseline = "middle";
        pc.fillText(`L${j + 1}`, 0, 0);
        if (zoom > 0.45) {
          const fsArea = Math.max(16 * TS, Math.min(30 * TS, 20 * zoom * TS));
          pc.font = `${fsArea}px Courier New`;
          pc.fillStyle = "#666666";
          pc.fillText(`${la.toFixed(1)}m²`, 0, fs2 * 0.9);
        }
        pc.restore();
      }
      const cp = l.pts.map((p) => pToC(p.x, p.y));
      pc.beginPath();
      pc.moveTo(cp[0].x, cp[0].y);
      for (let j = 1; j < cp.length; j++) pc.lineTo(cp[j].x, cp[j].y);
      pc.closePath();
      pc.strokeStyle = "#111111";
      pc.lineWidth = 2.0;
      pc.stroke();
      sliceLots
        .filter((sd) => sd.mznIdx === i)
        .forEach((sd) => {
          if (sd.subMznPts && sd.subMznPts.length >= 3) {
            const scp = sd.subMznPts.map((p) => pToC(p.x, p.y));
            pc.beginPath();
            pc.moveTo(scp[0].x, scp[0].y);
            for (let k = 1; k < scp.length; k++) pc.lineTo(scp[k].x, scp[k].y);
            pc.closePath();
            pc.strokeStyle = "#777777";
            pc.lineWidth = 1.5;
            pc.setLineDash([4, 3]);
            pc.stroke();
            pc.setLineDash([]);
          }
        });

      if (zoom > 0.15) {
        const swPath = _buildSidewalkPathOffscreen(pc, l.pts, pToC, zoom);
        if (swPath) {
          pc.save();
          pc.strokeStyle = "#222222";
          pc.lineWidth = Math.max(2.5, 3.5 * zoom);
          pc.setLineDash([]);
          pc.stroke(swPath);
          pc.restore();
        }
      }
    } else if (mznEquipamiento[i]) {
      const cp = l.pts.map((p) => pToC(p.x, p.y));
      const { type: equipType } = getEquipamientoInfo(polyAreaM2(l.pts));
      pc.save();
      pc.beginPath();
      pc.moveTo(cp[0].x, cp[0].y);
      for (let j = 1; j < cp.length; j++) pc.lineTo(cp[j].x, cp[j].y);
      pc.closePath();
      pc.clip();
      const ccen = pToC(centroid(l.pts).x, centroid(l.pts).y);
      let bbMinX = Infinity,
        bbMaxX = -Infinity,
        bbMinY = Infinity,
        bbMaxY = -Infinity;
      for (const p of cp) {
        if (p.x < bbMinX) bbMinX = p.x;
        if (p.x > bbMaxX) bbMaxX = p.x;
        if (p.y < bbMinY) bbMinY = p.y;
        if (p.y > bbMaxY) bbMaxY = p.y;
      }
      const gradR = Math.max(bbMaxX - bbMinX, bbMaxY - bbMinY) * 0.65;
      const grad = pc.createRadialGradient(
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
      pc.fillStyle = grad;
      pc.fillRect(bbMinX, bbMinY, bbMaxX - bbMinX, bbMaxY - bbMinY);
      pc.restore();
      pc.beginPath();
      pc.moveTo(cp[0].x, cp[0].y);
      for (let j = 1; j < cp.length; j++) pc.lineTo(cp[j].x, cp[j].y);
      pc.closePath();
      pc.strokeStyle = "#333333";
      pc.lineWidth = 2;
      pc.setLineDash([6, 3]);
      pc.stroke();
      pc.setLineDash([]);
      if (zoom > 0.15) {
        const swPath = _buildSidewalkPathOffscreen(pc, l.pts, pToC, zoom);
        if (swPath) {
          pc.save();
          pc.strokeStyle = "#333333";
          pc.lineWidth = Math.max(2.5, 3.5 * zoom);
          pc.setLineDash([]);
          pc.stroke(swPath);
          pc.restore();
        }
      }
    } else {
      const cp = l.pts.map((p) => pToC(p.x, p.y));
      pc.beginPath();
      pc.moveTo(cp[0].x, cp[0].y);
      for (let j = 1; j < cp.length; j++) pc.lineTo(cp[j].x, cp[j].y);
      pc.closePath();
      pc.fillStyle = "rgba(210,210,210,0.30)";
      pc.fill();
      pc.strokeStyle = "#333333";
      pc.lineWidth = 1.8;
      pc.stroke();
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
        const midC = pToC(midW.x, midW.y);
        let ang = Math.atan2(dyW, dxW);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        const segLen = Math.sqrt(dxW * dxW + dyW * dyW) || 1;
        const nxSeg = -dyW / segLen,
          nySeg = dxW / segLen;
        const dotOut =
          (midW.x - mznCen.x) * nxSeg + (midW.y - mznCen.y) * nySeg;
        const outX = dotOut >= 0 ? nxSeg : -nxSeg;
        const outY = dotOut >= 0 ? nySeg : -nySeg;
        const offsetPx = Math.max(14 * TS, 18 * zoom * TS);
        const txC = midC.x + outX * offsetPx;
        const tyC = midC.y + outY * offsetPx;
        const fsSeg = Math.max(14 * TS, Math.min(26 * TS, 17 * zoom * TS));
        pc.save();
        pc.translate(txC, tyC);
        pc.rotate(ang);
        const label =
          lenM >= 100 ? lenM.toFixed(1) + " m" : lenM.toFixed(2) + " m";
        pc.font = `600 ${fsSeg}px Courier New`;
        pc.textAlign = "center";
        pc.textBaseline = "middle";
        const tw = pc.measureText(label).width;
        pc.fillStyle = "rgba(255,255,255,0.88)";
        pc.fillRect(-tw / 2 - 3, -fsSeg / 2 - 2, tw + 6, fsSeg + 4);
        pc.fillStyle = mznEquipamiento[i] ? "#444444" : "#111111";
        pc.fillText(label, 0, 0);
        pc.restore();
      }
    }

    if (zoom > 0.35 && showLots) {
      const allLotsForDim = [];
      const subDim = lotSubdivisions.find((s) => s.mznIdx === i);
      if (subDim && subDim.lots.length > 0)
        subDim.lots.forEach((lt) => allLotsForDim.push(lt));
      sliceLots
        .filter((sd) => sd.mznIdx === i)
        .forEach((sd) => sd.lots.forEach((lt) => allLotsForDim.push(lt)));
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
          const pAc = pToC(pA.x, pA.y);
          const pBc = pToC(pB.x, pB.y);
          const segPx = Math.hypot(pBc.x - pAc.x, pBc.y - pAc.y);
          if (segPx < 28) continue;
          const midW = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
          const midC = pToC(midW.x, midW.y);
          let ang = Math.atan2(dyW, dxW);
          if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
          const segLen = Math.sqrt(dxW * dxW + dyW * dyW) || 1;
          const nxSeg = -dyW / segLen,
            nySeg = dxW / segLen;
          const dotOut =
            (midW.x - ltCen.x) * nxSeg + (midW.y - ltCen.y) * nySeg;
          const inX = dotOut >= 0 ? -nxSeg : nxSeg;
          const inY = dotOut >= 0 ? -nySeg : nySeg;
          const offsetPx = Math.max(10 * TS, 12 * zoom * TS);
          const txC = midC.x + inX * offsetPx;
          const tyC = midC.y + inY * offsetPx;
          const fsDim = Math.max(16 * TS, Math.min(28 * TS, 20 * zoom * TS));
          const label =
            lenM >= 100 ? lenM.toFixed(1) + "m" : lenM.toFixed(2) + "m";
          pc.save();
          pc.translate(txC, tyC);
          pc.rotate(ang);
          pc.font = `500 ${fsDim}px Courier New`;
          pc.textAlign = "center";
          pc.textBaseline = "middle";
          pc.fillStyle = "#333333";
          pc.fillText(label, 0, 0);
          pc.restore();
        }
      }
    }
    const cen = centroid(l.pts);
    const cc = pToC(cen.x, cen.y);
    const fs = Math.max(32 * TS, Math.min(72 * TS, 44 * zoom * TS));
    const fsSmall = Math.max(13 * TS, Math.min(28 * TS, 18 * zoom * TS));
    let mznLongestAngle = 0;
    {
      let maxSegLen = -1;
      const mp = l.pts,
        mn = mp.length;
      for (let k = 0; k < mn; k++) {
        const a = mp[k],
          b = mp[(k + 1) % mn];
        const dl = Math.hypot(b.x - a.x, b.y - a.y);
        if (dl > maxSegLen) {
          maxSegLen = dl;
          mznLongestAngle = Math.atan2(b.y - a.y, b.x - a.x);
        }
      }

      if (mznLongestAngle > Math.PI / 2 || mznLongestAngle < -Math.PI / 2)
        mznLongestAngle += Math.PI;
    }

    if (mznEquipamiento[i]) {
      const { icon, label } = getEquipamientoInfo(polyAreaM2(l.pts));
      pc.save();
      pc.translate(cc.x, cc.y);
      pc.rotate(mznLongestAngle);
      pc.textAlign = "center";
      pc.textBaseline = "middle";
      pc.fillStyle = "#333333";
      pc.font = `900 ${fs}px 'Arial Black', Arial, sans-serif`;
      pc.fillText(`EQUIPAMIENTO - ${_equipNumIdx++}`, 0, -fs * 0.75);
      if (zoom > 0.18) {
        pc.font = `bold ${fsSmall}px 'Arial Black', Arial, sans-serif`;
        pc.fillStyle = "#444444";
        pc.fillText("EQUIPAMIENTO", 0, fs * 0.15);
        pc.fillStyle = "#666666";
        pc.font = `bold ${Math.max(11 * TS, Math.min(24 * TS, 15 * zoom * TS))}px Arial, sans-serif`;
        pc.fillText(label, 0, fs * 1.35);
        pc.fillText(`${polyAreaM2(l.pts).toFixed(0)}m²`, 0, fs * 2.25);
      }
      pc.restore();
    } else {
      pc.save();
      pc.translate(cc.x, cc.y);
      pc.rotate(mznLongestAngle);
      pc.textAlign = "center";
      pc.textBaseline = "middle";
      pc.shadowColor = "rgba(255,255,255,0.7)";
      pc.shadowBlur = Math.round(4 * TS);
      pc.fillStyle = "#111111";
      pc.font = `900 ${fs}px 'Arial Black', Arial, sans-serif`;
      pc.fillText(`MZO - ${String.fromCharCode(65 + _mznLetraIdx++)}`, 0, 0);
      pc.shadowBlur = 0;
      if (zoom > 0.28) {
        pc.font = `bold ${fsSmall}px Arial, sans-serif`;
        pc.fillStyle = "#555555";
        pc.fillText(`${polyAreaM2(l.pts).toFixed(0)}m²`, 0, fs * 1.55);
      }
      pc.restore();
    }
  }
}

/* ── Helpers math para fillets (versión print, opera en canvas-print px) ── */
function _pNormPx(a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = Math.hypot(dx, dy);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: -dy / l, y: dx / l };
}
function _pLineLineIx(p1, p2, p3, p4) {
  const dx1 = p2.x - p1.x,
    dy1 = p2.y - p1.y;
  const dx2 = p4.x - p3.x,
    dy2 = p4.y - p3.y;
  const d = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3.x - p1.x) * dy2 - (p3.y - p1.y) * dx2) / d;
  return { x: p1.x + t * dx1, y: p1.y + t * dy1 };
}
function _pAdd(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}
function _pSub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}
function _pScl(a, s) {
  return { x: a.x * s, y: a.y * s };
}
function _pDot(a, b) {
  return a.x * b.x + a.y * b.y;
}
function _pLen(a) {
  return Math.hypot(a.x, a.y);
}
function _pNorm(a) {
  const l = _pLen(a);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}
function _pOnSeg(p, s, e, tol) {
  const dir = _pSub(e, s),
    len = _pLen(dir);
  if (len < 1e-9) return false;
  const proj = _pDot(_pSub(p, s), _pNorm(dir));
  return proj >= -tol && proj <= len + tol;
}
function _pInSweep(ang, a, b) {
  const TAU = Math.PI * 2;
  const sweep = (((b - a) % TAU) + TAU) % TAU;
  const rel = (((ang - a) % TAU) + TAU) % TAU;
  return rel <= sweep;
}
function _pFilletR(angleDeg) {
  if (angleDeg <= 60) return 2;
  if (angleDeg <= 95) return 3;
  if (angleDeg <= 180) return 4;
  return 6;
}
function _pInsideStreet(pt, seg, pToC, zoom) {
  const halfPx = mw(seg.width / 2) * zoom;
  const a = pToC(seg.start.x, seg.start.y);
  const b = pToC(seg.end.x, seg.end.y);
  const dir = _pSub(b, a),
    len = _pLen(dir);
  if (len < 1e-9) return false;
  const dirN = _pNorm(dir),
    n = _pNormPx(a, b);
  const rel = _pSub(pt, a);
  const proj = _pDot(rel, dirN);
  const perp = Math.abs(_pDot(rel, n));
  return proj >= -halfPx && proj <= len + halfPx && perp <= halfPx;
}

/* ── computeStreetFillets (print) ── */
function _pComputeFillets(sA, sB, pToC, zoom) {
  const results = [];
  const a0 = pToC(sA.start.x, sA.start.y),
    a1 = pToC(sA.end.x, sA.end.y);
  const b0 = pToC(sB.start.x, sB.start.y),
    b1 = pToC(sB.end.x, sB.end.y);
  const ip = _pLineLineIx(a0, a1, b0, b1);
  if (!ip) return results;
  const halfA = mw(sA.width / 2) * zoom;
  const halfB = mw(sB.width / 2) * zoom;
  const nA = _pNormPx(a0, a1),
    dA = _pNorm(_pSub(a1, a0));
  const nB = _pNormPx(b0, b1),
    dB = _pNorm(_pSub(b1, b0));
  for (const sAs of [1, -1]) {
    for (const sBs of [1, -1]) {
      const eA0 = _pAdd(a0, _pScl(nA, sAs * halfA)),
        eA1 = _pAdd(a1, _pScl(nA, sAs * halfA));
      const eB0 = _pAdd(b0, _pScl(nB, sBs * halfB)),
        eB1 = _pAdd(b1, _pScl(nB, sBs * halfB));
      const corner = _pLineLineIx(eA0, eA1, eB0, eB1);
      if (!corner) continue;
      const cRel = _pSub(corner, ip);
      if (sAs * _pDot(nA, cRel) <= 0) continue;
      if (sBs * _pDot(nB, cRel) <= 0) continue;
      if (_pLen(cRel) < 1) continue;
      const ipRel = _pSub(ip, corner);
      const projA = _pDot(ipRel, dA),
        projB = _pDot(ipRel, dB);
      const outA = projA >= 0 ? { x: -dA.x, y: -dA.y } : { x: dA.x, y: dA.y };
      const outB = projB >= 0 ? { x: -dB.x, y: -dB.y } : { x: dB.x, y: dB.y };
      const cosT = Math.max(-1, Math.min(1, _pDot(outA, outB)));
      const theta = Math.acos(cosT);
      if (theta < 0.05 || theta > Math.PI - 0.05) continue;
      const filletM = _pFilletR((theta * 180) / Math.PI);
      const filletPx = mw(filletM) * zoom;
      const tol = halfA + halfB + filletPx;
      if (!_pOnSeg(ip, a0, a1, tol)) continue;
      if (!_pOnSeg(ip, b0, b1, tol)) continue;
      if (_pLen(cRel) > tol * 3) continue;
      const t = filletPx / Math.tan(theta / 2);
      if (t <= 0 || !isFinite(t)) continue;
      const tangA = _pAdd(corner, _pScl(outA, t));
      const tangB = _pAdd(corner, _pScl(outB, t));
      if (!_pOnSeg(tangA, eA0, eA1, filletPx + 2)) continue;
      if (!_pOnSeg(tangB, eB0, eB1, filletPx + 2)) continue;
      const bisRaw = _pAdd(outA, outB),
        bisLen = _pLen(bisRaw);
      if (bisLen < 1e-9) continue;
      const bis = _pScl(bisRaw, 1 / bisLen);
      const distToCtr = filletPx / Math.sin(theta / 2);
      const acx = corner.x + bis.x * distToCtr;
      const acy = corner.y + bis.y * distToCtr;
      const angA = Math.atan2(tangA.y - acy, tangA.x - acx);
      const angB = Math.atan2(tangB.y - acy, tangB.x - acx);
      const caRel = Math.atan2(-bis.y, -bis.x);
      const acw = !_pInSweep(caRel, angA, angB);
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

/* ── filterStreetFillets (print) ── */
function _pFilterFillets(fillets, allStreets, pToC, zoom) {
  return fillets.filter((f) => {
    for (const seg of allStreets) {
      if (seg === f.segA || seg === f.segB) continue;
      if (_pInsideStreet(f.corner, seg, pToC, zoom)) return false;
      if (_pInsideStreet({ x: f.acx, y: f.acy }, seg, pToC, zoom)) return false;
    }
    return true;
  });
}

/* ── mergeIntervals (print) ── */
function _pMergeIv(ivs) {
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

/* ── drawStreetEdgeWithFillets (print) ── */
function _pDrawEdge(pc, s, side, allFillets, otherStreets, pToC, zoom) {
  const halfPx = mw(s.width / 2) * zoom;
  const a = pToC(s.start.x, s.start.y);
  const b = pToC(s.end.x, s.end.y);
  const n = _pNormPx(a, b);
  const ox = n.x * side * halfPx,
    oy = n.y * side * halfPx;
  const pa = { x: a.x + ox, y: a.y + oy };
  const pb = { x: b.x + ox, y: b.y + oy };
  const segDir = _pNorm(_pSub(pb, pa));
  const segLen = _pLen(_pSub(pb, pa));
  if (segLen < 1e-6) return;
  const suppress = [];

  // 1) zonas de fillet
  for (const f of allFillets) {
    const isA = f.segA === s,
      isB = f.segB === s;
    if (!isA && !isB) continue;
    const mySide = isA ? f.sAs : f.sBs;
    if (mySide !== side) continue;
    const myTang = isA ? f.tangA : f.tangB;
    const cornerProj = _pDot(_pSub(f.corner, pa), segDir);
    const tangProj = _pDot(_pSub(myTang, pa), segDir);
    const t0 = Math.max(0, Math.min(tangProj, cornerProj) - 1);
    const t1 = Math.min(segLen, Math.max(tangProj, cornerProj) + 1);
    if (t1 > t0) suppress.push([t0, t1]);
  }

  // 2) zonas dentro de otro segmento
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
    const pt = _pAdd(pa, _pScl(segDir, tc));
    let inside = false;
    for (const other of otherStreets) {
      if (other === s) continue;
      if (_pInsideStreet(pt, other, pToC, zoom)) {
        inside = true;
        break;
      }
    }
    if (inside) {
      if (inStart === null) inStart = tc;
    } else flushIn(tc);
  }
  flushIn(segLen);

  // Dibujar tramos libres
  const gaps = _pMergeIv(suppress);
  let cur = 0;
  const stroke = (t0, t1) => {
    if (t1 - t0 < 0.5) return;
    const p0 = _pAdd(pa, _pScl(segDir, t0));
    const p1 = _pAdd(pa, _pScl(segDir, t1));
    pc.beginPath();
    pc.moveTo(p0.x, p0.y);
    pc.lineTo(p1.x, p1.y);
    pc.stroke();
  };
  for (const [g0, g1] of gaps) {
    if (g0 > cur) stroke(cur, g0);
    cur = g1;
  }
  if (cur < segLen) stroke(cur, segLen);
}

/* ════════════════════════════════════════════════════════════
     _printRenderStreets  — versión con fillets + supresión
  ════════════════════════════════════════════════════════════ */
function _printRenderStreets(pc, pToC, scaleF) {
  const zoom = _printZoom;
  const TS = window._textScale || 1;
  if (streets.length === 0) return;

  /* 1 ── Calcular y filtrar todos los fillets */
  const _allFillets = [];
  for (let i = 0; i < streets.length; i++)
    for (let j = i + 1; j < streets.length; j++)
      _allFillets.push(..._pComputeFillets(streets[i], streets[j], pToC, zoom));
  const _fillets = _pFilterFillets(_allFillets, streets, pToC, zoom);

  /* 2 ── Relleno + eje de cada calle */
  for (const s of streets) {
    const sc = pToC(s.start.x, s.start.y);
    const ec = pToC(s.end.x, s.end.y);
    pc.beginPath();
    pc.moveTo(sc.x, sc.y);
    pc.lineTo(ec.x, ec.y);
    // patrón: línea larga · punto · línea larga
    const dash = Math.max(14, 18 * zoom);
    const dot = Math.max(2, 3 * zoom);
    const gap = Math.max(5, 7 * zoom);
    pc.setLineDash([dash, gap, dot, gap]);
    pc.lineCap = "round";
    pc.strokeStyle = "#444444";
    pc.lineWidth = Math.max(1.5, 2.2 * zoom);
    pc.stroke();
    pc.setLineDash([]);
    pc.lineCap = "butt";
  }

  /* 3 ── Bordes laterales con supresión de fillets e intersecciones */
  const bw = Math.max(1, 0.8 * zoom);
  pc.strokeStyle = "#222222";
  pc.lineWidth = bw;
  pc.setLineDash([]);
  for (const s of streets) {
    _pDrawEdge(pc, s, +1, _fillets, streets, pToC, zoom);
    _pDrawEdge(pc, s, -1, _fillets, streets, pToC, zoom);
  }

  /* 4 ── Arcos de fillet */
  pc.strokeStyle = "#222222";
  pc.lineWidth = bw;
  pc.lineCap = "round";
  pc.setLineDash([]);
  for (const f of _fillets) {
    pc.beginPath();
    pc.arc(f.acx, f.acy, f.filletPx, f.angA, f.angB, f.acw);
    pc.stroke();
  }
  pc.lineCap = "butt";

  /* 5 ── Texto de nombre/ancho de vía (igual que antes) */
  for (const s of streets) {
    if (zoom > 0.3) {
      const dy = s.end.y - s.start.y,
        dx = s.end.x - s.start.x;
      const mid = pToC((s.start.x + s.end.x) / 2, (s.start.y + s.end.y) / 2);
      let ang = Math.atan2(dy, dx);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      const streetIdx = streets.indexOf(s) + 1;
      const nombreCalle = `--- Calle ${String.fromCharCode(64 + streetIdx)} (Ancho de Vía ${s.width.toFixed(2)}m) ---`;
      const ejeTexto = "E    J    E         D    E         V    Í    A";
      const fs1 = Math.max(18 * TS, Math.min(38 * TS, 27 * zoom * TS));
      const fs2 = Math.max(15 * TS, Math.min(29 * TS, 21.5 * zoom * TS));
      pc.save();
      pc.translate(mid.x, mid.y);
      pc.rotate(ang);
      pc.textAlign = "center";
      pc.textBaseline = "middle";
      pc.fillStyle = "#333333";
      pc.font = `bold ${fs1}px Courier New`;
      pc.fillText(nombreCalle, 0, -fs1 * 0.7);
      pc.fillStyle = "#666666";
      pc.font = `${fs2}px Courier New`;
      pc.fillText(ejeTexto, 0, fs2 * 0.9);
      pc.restore();
    }
  }
}

function _printRenderMznSegments(pc, pToC) {
  for (const [idxStr, seg] of Object.entries(mznSegments)) {
    const sc = pToC(seg.p1.x, seg.p1.y);
    const ec = pToC(seg.p2.x, seg.p2.y);
    pc.beginPath();
    pc.moveTo(sc.x, sc.y);
    pc.lineTo(ec.x, ec.y);
    pc.strokeStyle = "#555555";
    pc.lineWidth = 2.5;
    pc.setLineDash([]);
    pc.stroke();
    pc.beginPath();
    pc.arc(sc.x, sc.y, 5, 0, Math.PI * 2);
    pc.fillStyle = "#555555";
    pc.fill();
    pc.beginPath();
    pc.arc(ec.x, ec.y, 5, 0, Math.PI * 2);
    pc.fillStyle = "#555555";
    pc.fill();
  }
}

function _printRenderPolyPts(pc, pToC, scaleF) {
  if (!polyClosed || polyPts.length < 3) return;
  const TS = window._textScale || 1;
  const cp = polyPts.map((p) => pToC(p.x, p.y));
  const dash = Math.max(9 * TS, 12 * _printZoom * TS);
  const dot = Math.max(2 * TS, 2 * _printZoom * TS);
  const space = Math.max(4 * TS, 5 * _printZoom * TS);
  const GROSOR = 4;
  pc.save();
  pc.beginPath();
  pc.moveTo(cp[0].x, cp[0].y);
  for (let k = 1; k < cp.length; k++) pc.lineTo(cp[k].x, cp[k].y);
  pc.closePath();
  pc.strokeStyle = "#111111";
  pc.lineWidth = Math.max(GROSOR * TS, GROSOR * _printZoom * TS);
  pc.setLineDash([dash, space, dot, space]);
  pc.lineCap = "round";
  pc.lineJoin = "round";
  pc.stroke();
  pc.setLineDash([]);
  pc.restore();
}

function _buildSidewalkPathOffscreen(pc, mznPts, pToC, zoom) {
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
    corners.push(pt || { x: (l1.bx + l2.ax) / 2, y: (l1.by + l2.ay) / 2 });
  }
  const path = new Path2D();
  for (let i = 0; i < n; i++) {
    const pPrev = mznPts[(i - 1 + n) % n];
    const pCur = mznPts[i];
    const pNext = mznPts[(i + 1) % n];
    const angleDeg = angleBetweenSegs(pPrev, pCur, pNext);
    const radiusW = mw(arcRadiusForAngle(angleDeg));
    const vc = pToC(corners[i].x, corners[i].y);
    const vPrev = pToC(corners[(i - 1 + n) % n].x, corners[(i - 1 + n) % n].y);
    const vNext = pToC(corners[(i + 1) % n].x, corners[(i + 1) % n].y);
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
    if (i === 0) path.moveTo(tPx, tPy);
    else path.lineTo(tPx, tPy);
    path.quadraticCurveTo(vc.x, vc.y, tNx, tNy);
  }
  {
    const vc = pToC(corners[0].x, corners[0].y);
    const vPrev = pToC(corners[n - 1].x, corners[n - 1].y);
    const dPx = vPrev.x - vc.x,
      dPy = vPrev.y - vc.y;
    const lP = Math.sqrt(dPx * dPx + dPy * dPy) || 1;
    const radiusPx =
      mw(
        arcRadiusForAngle(
          angleBetweenSegs(mznPts[n - 1], mznPts[0], mznPts[1]),
        ),
      ) * zoom;
    const tDist = Math.min(radiusPx, lP * 0.45);
    path.lineTo(vc.x + (dPx / lP) * tDist, vc.y + (dPy / lP) * tDist);
  }
  path.closePath();
  return path;
}

function _drawPlanScaleBar(ctx, x, y, scaleF, color, PW, DPI) {
  const TS = window._textScale || 1;
  const pixelsPerMeter = scaleF / MPP;
  const targetPx = PW * 0.12; // 12% del ancho del canvas A0
  const rawM = targetPx / pixelsPerMeter;
  const steps = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000];
  let niceM = steps[0];
  for (const s of steps) {
    if (s <= rawM * 1.6) niceM = s;
  }
  const barPx = niceM * pixelsPerMeter;
  const SEGS = 4;
  const segW = barPx / SEGS;
  const barH = Math.round(60 * TS);
  const tickH = Math.round(40 * TS);
  for (let s = 0; s < SEGS; s++) {
    ctx.fillStyle = s % 2 === 0 ? color : "#30363d";
    ctx.fillRect(x + s * segW, y - barH, segW, barH);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y - barH, barPx, barH);
  ctx.beginPath();
  ctx.moveTo(x, y - barH - tickH);
  ctx.lineTo(x, y + Math.round(4 * TS));
  ctx.moveTo(x + barPx / 2, y - barH - tickH);
  ctx.lineTo(x + barPx / 2, y + Math.round(4 * TS));
  ctx.moveTo(x + barPx, y - barH - tickH);
  ctx.lineTo(x + barPx, y + Math.round(4 * TS));
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const fsBar = Math.round(38 * TS);
  const fsEsc = Math.round(32 * TS);
  ctx.fillStyle = color;
  ctx.font = `bold ${fsBar}px Courier New`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("0", x, y + Math.round(6 * TS));
  ctx.fillText(`${niceM / 2}m`, x + barPx / 2, y + Math.round(6 * TS));
  ctx.fillText(`${niceM}m`, x + barPx, y + Math.round(6 * TS));
  const pixPorMetro = scaleF / MPP;
  const pixPorMetroPapel = DPI / 0.0254;
  const scaleNum = Math.round(pixPorMetroPapel / pixPorMetro);
  ctx.font = `${fsEsc}px Courier New`;
  ctx.textAlign = "left";
  ctx.fillText(
    `ESCALA 1:${Math.round(scaleNum).toLocaleString("es-BO")}`,
    x,
    y + Math.round(6 * TS) + fsBar + Math.round(4 * TS),
  );
}

function _drawCajeton(ctx, x, y, w, h, scaleF) {
  const TS = window._textScale || 1;
  const T = TS * 2.9;
  const pad = Math.round(32 * T);
  const C_BG = "#ffffff";
  const C_TITLE = "#111111";
  const C_TEXT = "#111111";
  const C_MUTED = "#555555";
  const C_LINE = "#aaaaaa";
  const C_GREEN = "#222222";
  const C_AMBER = "#444444";
  const titleEl = document.getElementById("planTitle");
  const ownerEl = document.getElementById("planOwner");
  const archEl = document.getElementById("planArch");
  const titulo = titleEl
    ? titleEl.value || "URB. SAI SOLUCIONES"
    : "URB. SAI SOLUCIONES";
  const propiet = ownerEl ? ownerEl.value || "XXXXXXXXXX" : "XXXXXXXXXX";
  const arquit = archEl ? archEl.value || "XXXXXXXXXX" : "XXXXXXXXXX";
  const fecha = new Date().toISOString().slice(0, 10);
  const _cajonR = 55;
  ctx.fillStyle = C_BG;
  ctx.beginPath();
  ctx.moveTo(x + _cajonR, y);
  ctx.lineTo(x + w - _cajonR, y);
  ctx.arcTo(x + w, y, x + w, y + _cajonR, _cajonR);
  ctx.lineTo(x + w, y + h - _cajonR);
  ctx.arcTo(x + w, y + h, x + w - _cajonR, y + h, _cajonR);
  ctx.lineTo(x + _cajonR, y + h);
  ctx.arcTo(x, y + h, x, y + h - _cajonR, _cajonR);
  ctx.lineTo(x, y + _cajonR);
  ctx.arcTo(x, y, x + _cajonR, y, _cajonR);
  ctx.closePath();
  ctx.fill();
  let cy = y + pad;
  const titleBlockH = Math.round(80 * T);
  ctx.fillStyle = "#dddddd";
  ctx.fillRect(x, cy, w, titleBlockH);
  ctx.strokeStyle = "#aaaaaa";
  ctx.lineWidth = 0.8;
  ctx.strokeRect(x, cy, w, titleBlockH);
  const fsUrbLabel = Math.round(16 * T);
  const fsTituloGrande = Math.round(26 * T);
  ctx.fillStyle = "#111111";
  ctx.font = `bold ${fsUrbLabel}px Courier New`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("URBANIZACIÓN", x + w / 2, cy + titleBlockH * 0.28);
  ctx.font = `bold ${fsTituloGrande}px Courier New`;
  ctx.fillText(titulo, x + w / 2, cy + titleBlockH * 0.72);
  cy += titleBlockH + Math.round(10 * T);
  _cajLine(ctx, x, cy, w, C_LINE);
  cy += Math.round(14 * T);
  const fsSubtitulo = Math.round(14 * T);
  ctx.fillStyle = C_TITLE;
  ctx.font = `bold ${fsSubtitulo}px Courier New`;
  ctx.textAlign = "center";
  ctx.fillText("PLANIMETRÍA GENERAL", x + w / 2, cy + Math.round(8 * T));
  cy += Math.round(28 * T);
  _cajLine(ctx, x, cy, w, C_LINE);
  cy += Math.round(14 * T);
  const fsFieldLabel = Math.round(13 * T);
  const fsFieldValue = Math.round(18 * T);
  const fieldRowH = Math.round(46 * T);

  function field(label, value, valueColor) {
    ctx.fillStyle = C_MUTED;
    ctx.font = `${fsFieldLabel}px Courier New`;
    ctx.textAlign = "left";
    ctx.fillText(label.toUpperCase(), x + pad, cy);
    ctx.fillStyle = valueColor || C_TEXT;
    ctx.font = `bold ${fsFieldValue}px Courier New`;
    ctx.fillText(value, x + pad, cy + Math.round(17 * T));
    cy += fieldRowH;
    ctx.strokeStyle = C_LINE;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x + pad, cy - Math.round(4 * T));
    ctx.lineTo(x + w - pad, cy - Math.round(4 * T));
    ctx.stroke();
  }

  field("Propietario", propiet);
  field("Profesional", arquit);
  field("Fecha", fecha);
  if (_geoOrigin) {
    field(
      "Zona UTM",
      `WGS-84 Zona ${_geoOrigin.zone}${_geoOrigin.hemi === "south" ? "S" : "N"}`,
    );
    field("Coordenada E", _geoOrigin.utmX.toFixed(2) + " m");
    field("Coordenada N", _geoOrigin.utmY.toFixed(2) + " m");
  } else {
    field("Sistema de Ref.", "Sin georeferencia");
  }

  _cajLine(ctx, x, cy, w, C_LINE);
  cy += Math.round(14 * T);
  const fsSectionTitle = Math.round(13 * T);
  ctx.fillStyle = C_TITLE;
  ctx.font = `bold ${fsSectionTitle}px Courier New`;
  ctx.textAlign = "center";
  ctx.fillText("PORCENTUAL DE ÁREAS", x + w / 2, cy + Math.round(10 * T));
  cy += Math.round(28 * T);

  const parcelaTotal = polyClosed ? polyAreaM2(polyPts) : 0;
  let viaArea = 0;
  for (const s of streets) {
    const rect = streetRect(s);
    if (!rect) continue;
    const cl = clipPolyToManzano(rect, polyPts);
    if (cl && cl.length >= 3) viaArea += polyAreaM2(cl);
  }
  let equipArea = 0,
    equipCount = 0;
  for (let i = 0; i < manzanos.length; i++) {
    if (mznEquipamiento[i]) {
      equipArea += polyAreaM2(manzanos[i].pts);
      equipCount++;
    }
  }
  let mznArea = 0,
    mznCount = 0;
  for (let i = 0; i < manzanos.length; i++) {
    if (!mznEquipamiento[i]) {
      mznArea += polyAreaM2(manzanos[i].pts);
      mznCount++;
    }
  }
  let lotCount = 0,
    lotArea = 0;
  for (const sub of lotSubdivisions) {
    if (mznEquipamiento[sub.mznIdx]) continue;
    for (const lt of sub.lots) {
      lotCount++;
      lotArea += lt.areaM2 !== undefined ? lt.areaM2 : polyAreaM2(lt.pts);
    }
  }
  for (const sd of sliceLots) {
    if (mznEquipamiento[sd.mznIdx]) continue;
    for (const lt of sd.lots) {
      lotCount++;
      lotArea += lt.areaM2 !== undefined ? lt.areaM2 : polyAreaM2(lt.pts);
    }
  }

  const pTotal = parcelaTotal > 0 ? parcelaTotal : 1;
  const pctVia = Math.min(100, (viaArea / pTotal) * 100);
  const pctMzn = Math.min(100, (mznArea / pTotal) * 100);
  const pctLots = Math.min(100, (lotArea / pTotal) * 100);
  const pctEquip = Math.min(100, (equipArea / pTotal) * 100);
  const nCalles = streets.length;
  function fmt(n) {
    return n.toLocaleString("es-BO", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  const fsTableHeader = Math.round(11 * T);
  const fsTableRow = Math.round(13 * T);
  const tableRowH = Math.round(24 * T);
  const tableHeaderH = Math.round(22 * T);
  ctx.fillStyle = "#eeeeee";
  ctx.fillRect(x + pad - 4, cy - 2, w - pad * 2 + 8, tableHeaderH);
  ctx.strokeStyle = "#cccccc";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x + pad - 4, cy - 2, w - pad * 2 + 8, tableHeaderH);
  ctx.fillStyle = C_MUTED;
  ctx.font = `bold ${fsTableHeader}px Courier New`;
  ctx.textAlign = "left";
  ctx.fillText("USO", x + pad, cy + Math.round(12 * T));
  ctx.textAlign = "right";
  ctx.fillText(
    "ÁREA m²",
    x + w - pad - Math.round(50 * T),
    cy + Math.round(12 * T),
  );
  ctx.fillText("%", x + w - pad, cy + Math.round(12 * T));
  cy += tableHeaderH + Math.round(4 * T);
  const BAR_LOTS = "#333333";
  const BAR_MZN = "#777777";
  const BAR_EQUIP = "#999999";
  const BAR_VIA = "#bbbbbb";
  function tableRow(label, area, pct, barColor) {
    ctx.fillStyle = barColor;
    ctx.fillRect(x + pad - 4, cy - 1, Math.round(5 * T), Math.round(15 * T));
    ctx.fillStyle = C_TEXT;
    ctx.font = `${fsTableRow}px Courier New`;
    ctx.textAlign = "left";
    ctx.fillText(label, x + pad + Math.round(8 * T), cy + Math.round(11 * T));
    ctx.textAlign = "right";
    ctx.fillText(
      area.toFixed(1),
      x + w - pad - Math.round(50 * T),
      cy + Math.round(11 * T),
    );
    ctx.fillStyle = C_MUTED;
    ctx.fillText(pct.toFixed(2) + "%", x + w - pad, cy + Math.round(11 * T));
    cy += tableRowH;
    ctx.strokeStyle = C_LINE;
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(x + pad, cy - Math.round(2 * T));
    ctx.lineTo(x + w - pad, cy - Math.round(2 * T));
    ctx.stroke();
  }

  if (lotCount > 0)
    tableRow(`Residencial (${lotCount} lotes)`, lotArea, pctLots, BAR_LOTS);
  if (mznCount > 0)
    tableRow(`Manzanos (${mznCount})`, mznArea, pctMzn, BAR_MZN);
  if (equipCount > 0)
    tableRow(`Equipamiento (${equipCount})`, equipArea, pctEquip, BAR_EQUIP);
  if (nCalles > 0) tableRow(`Vías (${nCalles})`, viaArea, pctVia, BAR_VIA);
  const totalRowH = Math.round(26 * T);
  ctx.fillStyle = "#eeeeee";
  ctx.fillRect(x + pad - 4, cy - 1, w - pad * 2 + 8, totalRowH);
  ctx.strokeStyle = "#cccccc";
  ctx.lineWidth = 0.4;
  ctx.strokeRect(x + pad - 4, cy - 1, w - pad * 2 + 8, totalRowH);
  ctx.fillStyle = C_TEXT;
  ctx.font = `bold ${fsTableRow}px Courier New`;
  ctx.textAlign = "left";
  ctx.fillText("TOTAL", x + pad + Math.round(8 * T), cy + Math.round(14 * T));
  ctx.textAlign = "right";
  ctx.fillText(
    `${parcelaTotal.toFixed(1)}`,
    x + w - pad - Math.round(50 * T),
    cy + Math.round(14 * T),
  );
  ctx.fillStyle = C_MUTED;
  ctx.fillText("100.00%", x + w - pad, cy + Math.round(14 * T));
  cy += totalRowH + Math.round(6 * T);
  const fsMuted = Math.round(11 * T);
  ctx.fillStyle = C_MUTED;
  ctx.font = `${fsMuted}px Courier New`;
  ctx.textAlign = "center";
  ctx.fillText(
    `${(parcelaTotal / 10000).toFixed(4)} Ha`,
    x + w / 2,
    cy + Math.round(7 * T),
  );
  ctx.fillText(
    `Perímetro parcela: ${_calcPerimetro().toFixed(2)} ml`,
    x + w / 2,
    cy + Math.round(7 * T) + fsMuted + Math.round(4 * T),
  );
  cy += Math.round(38 * T);
  _cajLine(ctx, x, cy, w, C_LINE);
  cy += Math.round(14 * T);
  ctx.fillStyle = C_TITLE;
  ctx.font = `bold ${fsSectionTitle}px Courier New`;
  ctx.textAlign = "center";
  ctx.fillText("RELACIÓN DE ÁREAS", x + w / 2, cy + Math.round(10 * T));
  cy += Math.round(26 * T);
  const fsMznHeader = Math.round(11 * T);
  const fsMznRow = Math.round(10 * T);
  const mznHeaderH = Math.round(20 * T);
  const mznSubHeaderH = Math.round(16 * T);
  const mznRowH = Math.round(16 * T);
  for (let i = 0; i < manzanos.length; i++) {
    if (cy > y + h - Math.round(100 * T)) {
      ctx.fillStyle = C_MUTED;
      ctx.font = `${fsMznRow}px Courier New`;
      ctx.textAlign = "center";
      ctx.fillText(
        "(ver tabla completa en DXF)",
        x + w / 2,
        cy + Math.round(10 * T),
      );
      break;
    }
    const mzn = manzanos[i];
    const isEquip = !!mznEquipamiento[i];
    const mznAreaV = polyAreaM2(mzn.pts);
    const sub = lotSubdivisions.find((s) => s.mznIdx === i);
    const sliceSubs2 = sliceLots.filter((sd) => sd.mznIdx === i);
    const allLots = [];
    if (sub) sub.lots.forEach((lt) => allLots.push(lt));
    sliceSubs2.forEach((sd) => sd.lots.forEach((lt) => allLots.push(lt)));
    ctx.fillStyle = "#eeeeee";
    ctx.fillRect(x + pad - 4, cy - 1, w - pad * 2 + 8, mznHeaderH);
    ctx.strokeStyle = "#cccccc";
    ctx.lineWidth = 0.4;
    ctx.strokeRect(x + pad - 4, cy - 1, w - pad * 2 + 8, mznHeaderH);
    ctx.fillStyle = isEquip ? C_AMBER : C_TITLE;
    ctx.font = `bold ${fsMznHeader}px Courier New`;
    ctx.textAlign = "left";
    ctx.fillText(
      `MZO. ${i + 1}${isEquip ? " ★ EQUIP." : ""}`,
      x + pad,
      cy + Math.round(12 * T),
    );
    ctx.textAlign = "right";
    ctx.fillText(
      `${mznAreaV.toFixed(1)} m²`,
      x + w - pad,
      cy + Math.round(12 * T),
    );
    cy += mznHeaderH + Math.round(2 * T);
    ctx.fillStyle = C_MUTED;
    ctx.font = `${fsMznRow}px Courier New`;
    ctx.textAlign = "left";
    ctx.fillText("LOTE", x + pad + Math.round(4 * T), cy + Math.round(8 * T));
    ctx.textAlign = "center";
    ctx.fillText("ÁREA (m²)", x + w * 0.55, cy + Math.round(8 * T));
    ctx.textAlign = "right";
    ctx.fillText("PERÍM. (ml)", x + w - pad, cy + Math.round(8 * T));
    cy += mznSubHeaderH;
    ctx.strokeStyle = C_LINE;
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(x + pad, cy - Math.round(2 * T));
    ctx.lineTo(x + w - pad, cy - Math.round(2 * T));
    ctx.stroke();

    if (!isEquip && allLots.length > 0) {
      const maxShow = Math.min(allLots.length, 8);
      for (let j = 0; j < maxShow; j++) {
        const lt = allLots[j];
        const la = lt.areaM2 !== undefined ? lt.areaM2 : polyAreaM2(lt.pts);
        const peri = _calcLotPerimetro(lt.pts);
        ctx.fillStyle = lt.isRemnant ? C_AMBER : C_TEXT;
        ctx.font = `${fsMznRow}px Courier New`;
        ctx.textAlign = "left";
        ctx.fillText(
          `L${j + 1}${lt.isRemnant ? " ★" : ""}`,
          x + pad + Math.round(4 * T),
          cy + Math.round(8 * T),
        );
        ctx.textAlign = "center";
        ctx.fillText(`${la.toFixed(2)}`, x + w * 0.55, cy + Math.round(8 * T));
        ctx.textAlign = "right";
        ctx.fillText(`${peri.toFixed(2)}`, x + w - pad, cy + Math.round(8 * T));
        cy += mznRowH;
        if (cy > y + h - Math.round(80 * T)) break;
      }
      if (allLots.length > maxShow) {
        ctx.fillStyle = C_MUTED;
        ctx.font = `${fsMznRow}px Courier New`;
        ctx.textAlign = "center";
        ctx.fillText(
          `... ${allLots.length - maxShow} lotes más`,
          x + w / 2,
          cy + Math.round(8 * T),
        );
        cy += mznRowH;
      }
      const totalLotArea = allLots.reduce(
        (acc, lt) =>
          acc + (lt.areaM2 !== undefined ? lt.areaM2 : polyAreaM2(lt.pts)),
        0,
      );
      const totalRowH2 = Math.round(17 * T);
      ctx.fillStyle = "#eeeeee";
      ctx.fillRect(x + pad - 4, cy - 1, w - pad * 2 + 8, totalRowH2);
      ctx.fillStyle = C_GREEN;
      ctx.font = `bold ${fsMznRow}px Courier New`;
      ctx.textAlign = "left";
      ctx.fillText(
        `TOTAL ${allLots.length} lotes`,
        x + pad + Math.round(4 * T),
        cy + Math.round(10 * T),
      );
      ctx.textAlign = "center";
      ctx.fillText(
        `${totalLotArea.toFixed(1)}`,
        x + w * 0.55,
        cy + Math.round(10 * T),
      );
      cy += totalRowH2 + Math.round(4 * T);
    }
    cy += Math.round(6 * T);
  }
  const pieY = y + h - Math.round(60 * T);
  _cajLine(ctx, x, pieY, w, C_LINE);

  const pixM = scaleF / MPP;
  const barM = 50;
  const barPx2 = barM * pixM;
  const bx = x + pad;
  const by2 = pieY + Math.round(14 * T);
  const fsPie = Math.round(10 * T);
  if (barPx2 < w - pad * 2) {
    ctx.fillStyle = "#333333";
    ctx.fillRect(bx, by2, barPx2, Math.round(4 * T));
    ctx.font = `${fsPie}px Courier New`;
    ctx.textAlign = "left";
    ctx.fillStyle = C_MUTED;
    ctx.fillText(
      `${barM}m`,
      bx + barPx2 + Math.round(4 * T),
      by2 + Math.round(4 * T),
    );
    const scaleN = Math.round(DPI / 0.0254 / (scaleF / MPP));
    ctx.fillText(
      `ESCALA 1:${scaleN.toLocaleString("es-BO")}`,
      bx,
      by2 + Math.round(16 * T),
    );
  }

  const fsCredito = Math.round(10 * T);
  ctx.fillStyle = C_MUTED;
  ctx.font = `${fsCredito}px Courier New`;
  ctx.textAlign = "center";
  ctx.fillText("Generado con Lotes Sai", x + w / 2, y + h - Math.round(20 * T));
  ctx.fillText(fecha, x + w / 2, y + h - Math.round(8 * T));
}

function _cajLine(ctx, x, cy, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(x, cy);
  ctx.lineTo(x + w, cy);
  ctx.stroke();
}

function _calcPerimetro() {
  if (!polyPts || polyPts.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < polyPts.length; i++) {
    const a = polyPts[i],
      b = polyPts[(i + 1) % polyPts.length];
    p += Math.sqrt(
      Math.pow((b.x - a.x) * MPP, 2) + Math.pow((b.y - a.y) * MPP, 2),
    );
  }
  return p;
}

function _calcLotPerimetro(pts) {
  if (!pts || pts.length < 2) return 0;
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i],
      b = pts[(i + 1) % pts.length];
    p += Math.sqrt(
      Math.pow((b.x - a.x) * MPP, 2) + Math.pow((b.y - a.y) * MPP, 2),
    );
  }
  return p;
}
//===================FIN IMPRIMIR==============================================================
