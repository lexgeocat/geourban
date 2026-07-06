// =====================================================================
// MÓDULO 12/17 · 12-equipamiento-render.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 09-polygon-engine.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [12] EQUIPAMIENTO — ELEMENTOS DECORATIVOS (árboles, canchas, senderos)
// (candidato a módulo: equipamiento-render.js · depende de: [9])
// =====================================================================
function eqRand(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function eqPtInMzn(x, y, mznPts) {
  return slicePtInPoly(x, y, mznPts);
}

function eqBBox(mznPts) {
  const cp = mznPts.map((p) => toC(p.x, p.y));
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of cp) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

function drawTree(x, y, r, colorTronco, colorCopa1, colorCopa2) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = colorCopa2;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.15, y - r * 0.15, r * 0.72, 0, Math.PI * 2);
  ctx.fillStyle = colorCopa1;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.13)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y + r * 0.3, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = colorTronco;
  ctx.fill();
}

function drawShrub(x, y, r, color) {
  for (let k = 0; k < 3; k++) {
    const ox = [-r * 0.4, r * 0.4, 0][k];
    const oy = [r * 0.2, r * 0.2, -r * 0.3][k];
    ctx.beginPath();
    ctx.arc(x + ox, y + oy, r * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function drawFlower(x, y, r, color) {
  const petals = 5;
  for (let k = 0; k < petals; k++) {
    const angle = (k / petals) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(
      x + Math.cos(angle) * r * 0.7,
      y + Math.sin(angle) * r * 0.7,
      r * 0.45,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = "#ffe066";
  ctx.fill();
}

function drawCanchaDentro(mznPts, mznIdx) {
  const cen = centroid(mznPts);
  const cc = toC(cen.x, cen.y);
  const pa = principalAxis(mznPts);
  const extL = projectExtents(mznPts, pa.ux, pa.uy);
  const extS = projectExtents(mznPts, -pa.uy, pa.ux);
  const largo = wm(extL.max - extL.min) * 0.55 * zoom;
  const ancho = wm(extS.max - extS.min) * 0.5 * zoom;
  ctx.save();
  ctx.translate(cc.x, cc.y);
  const angle = Math.atan2(pa.uy, pa.ux);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.rect(-largo / 2, -ancho / 2, largo, ancho);
  ctx.fillStyle = "rgba(34,100,40,0.55)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = Math.max(0.8, 1.2 * zoom);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -ancho / 2);
  ctx.lineTo(0, ancho / 2);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = Math.max(0.5, 0.8 * zoom);
  ctx.stroke();
  const cr = Math.min(largo, ancho) * 0.18;
  ctx.beginPath();
  ctx.arc(0, 0, cr, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.stroke();
  const ar = Math.min(largo, ancho) * 0.28;
  ctx.beginPath();
  ctx.rect(-largo / 2, -ar / 2, ar * 0.6, ar);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = Math.max(0.4, 0.6 * zoom);
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(largo / 2 - ar * 0.6, -ar / 2, ar * 0.6, ar);
  ctx.stroke();
  ctx.restore();
}

function drawSendero(mznPts, rand, color) {
  const cen = centroid(mznPts);
  const bb = eqBBox(mznPts);
  const cc = toC(cen.x, cen.y);
  const nSend = 2 + Math.floor(rand() * 2);
  for (let s = 0; s < nSend; s++) {
    const angle = rand() * Math.PI * 2;
    const len = ((bb.w + bb.h) / 2) * 0.6;
    const ex = cc.x + Math.cos(angle) * len;
    const ey = cc.y + Math.sin(angle) * len;
    const grad = ctx.createLinearGradient(cc.x, cc.y, ex, ey);
    grad.addColorStop(0, color + "cc");
    grad.addColorStop(1, color + "00");
    ctx.beginPath();
    ctx.moveTo(cc.x, cc.y);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(1.5, 2.5 * zoom);
    ctx.setLineDash([Math.max(3, 5 * zoom), Math.max(2, 3 * zoom)]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawEquipamientoContent(mznPts, mznIdx, tipo) {
  const rand = eqRand(mznIdx * 7919 + 13);
  const cen = centroid(mznPts);
  const cc = toC(cen.x, cen.y);
  const bb = eqBBox(mznPts);
  const areaM2 = polyAreaM2(mznPts);
  const baseR = Math.max(4, Math.min(bb.w, bb.h) / 10);
  if (bb.w < 20 || bb.h < 20) return;
  function samplePoints(n, margin) {
    const pts = [];
    const marg = margin || 0;
    const wx0 = mznPts.reduce((a, p) => Math.min(a, p.x), Infinity);
    const wx1 = mznPts.reduce((a, p) => Math.max(a, p.x), -Infinity);
    const wy0 = mznPts.reduce((a, p) => Math.min(a, p.y), Infinity);
    const wy1 = mznPts.reduce((a, p) => Math.max(a, p.y), -Infinity);
    let tries = 0;
    while (pts.length < n && tries < n * 40) {
      tries++;
      const wx = wx0 + margin + rand() * (wx1 - wx0 - margin * 2);
      const wy = wy0 + margin + rand() * (wy1 - wy0 - margin * 2);
      if (eqPtInMzn(wx, wy, mznPts)) {
        let minDist = Infinity;
        const np = mznPts.length;
        for (let i = 0; i < np; i++) {
          const a = mznPts[i],
            b = mznPts[(i + 1) % np];
          const d = distPtSeg({ x: wx, y: wy }, a, b);
          if (d < minDist) minDist = d;
        }
        if (minDist >= margin) pts.push({ wx, wy });
      }
    }
    return pts;
  }

  if (zoom > 0.3 && bb.w > 40 && bb.h > 40) {
    const nLines = Math.min(18, Math.floor((bb.w + bb.h) / 12));
    for (let l = 0; l < nLines; l++) {
      const t = (l + 0.5) / nLines;
      const wx0b = mznPts.reduce((a, p) => Math.min(a, p.x), Infinity);
      const wx1b = mznPts.reduce((a, p) => Math.max(a, p.x), -Infinity);
      const wy0b = mznPts.reduce((a, p) => Math.min(a, p.y), Infinity);
      const wy1b = mznPts.reduce((a, p) => Math.max(a, p.y), -Infinity);
      const yw = wy0b + t * (wy1b - wy0b);
      const ca = toC(wx0b, yw),
        cb = toC(wx1b, yw);
      ctx.save();
      const clipPath = new Path2D();
      const cp2 = mznPts.map((p) => toC(p.x, p.y));
      clipPath.moveTo(cp2[0].x, cp2[0].y);
      for (let k = 1; k < cp2.length; k++) clipPath.lineTo(cp2[k].x, cp2[k].y);
      clipPath.closePath();
      ctx.clip(clipPath);
      const alpha = l % 2 === 0 ? "18" : "08";
      ctx.beginPath();
      ctx.moveTo(ca.x, ca.y);
      ctx.lineTo(cb.x, cb.y);
      ctx.strokeStyle = "#3fb950" + alpha;
      ctx.lineWidth = Math.max(2, (bb.h / nLines) * 0.7);
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.save();
  const clipPath2 = new Path2D();
  const cp3 = mznPts.map((p) => toC(p.x, p.y));
  clipPath2.moveTo(cp3[0].x, cp3[0].y);
  for (let k = 1; k < cp3.length; k++) clipPath2.lineTo(cp3[k].x, cp3[k].y);
  clipPath2.closePath();
  ctx.clip(clipPath2);

  if (tipo === "jardin") {
    const margin = mw(0.8);
    const shrubPts = samplePoints(Math.min(6, Math.floor(areaM2 / 25)), margin);
    for (const p of shrubPts) {
      const pc = toC(p.wx, p.wy);
      const r = baseR * (0.5 + rand() * 0.5);
      drawShrub(
        pc.x,
        pc.y,
        r,
        `rgba(${34 + Math.floor(rand() * 30)},${120 + Math.floor(rand() * 40)},${40 + Math.floor(rand() * 20)},0.85)`,
      );
    }
    const flowerPts = samplePoints(
      Math.min(10, Math.floor(areaM2 / 15)),
      margin * 0.5,
    );
    const flowerColors = [
      "#ff6b9d",
      "#ff9e4a",
      "#ffe066",
      "#c084fc",
      "#60d8fa",
      "#ff6b6b",
      "#b4e255",
    ];
    for (const p of flowerPts) {
      const pc = toC(p.wx, p.wy);
      const r = baseR * (0.25 + rand() * 0.3);
      drawFlower(
        pc.x,
        pc.y,
        r,
        flowerColors[Math.floor(rand() * flowerColors.length)],
      );
    }
  } else if (tipo === "cancha") {
    drawCanchaDentro(mznPts, mznIdx);
    const margin = mw(1.5);
    const treePts = samplePoints(Math.min(4, Math.floor(areaM2 / 80)), margin);
    for (const p of treePts) {
      const pc = toC(p.wx, p.wy);
      const r = baseR * (0.6 + rand() * 0.5);
      drawTree(pc.x, pc.y, r, "#5a3a1a", "#2d7a2d", "#3aab3a");
    }
  } else if (tipo === "parque") {
    drawSendero(mznPts, rand, "#c8a86b");
    const margin = mw(1.5);
    const nArboles = Math.min(12, Math.max(3, Math.floor(areaM2 / 80)));
    const treePts = samplePoints(nArboles, margin);
    const treeColors = [
      ["#2d7a2d", "#3aab3a"],
      ["#1a6b1a", "#2d9e2d"],
      ["#4a8c2a", "#5aab3a"],
      ["#1a5c3a", "#2a8a5a"],
    ];
    for (let ti = 0; ti < treePts.length; ti++) {
      const p = treePts[ti];
      const pc = toC(p.wx, p.wy);
      const r = baseR * (0.7 + rand() * 0.8);
      const col = treeColors[ti % treeColors.length];
      drawTree(pc.x, pc.y, r, "#5a3a1a", col[0], col[1]);
    }
    const shrubPts = samplePoints(
      Math.min(8, Math.floor(areaM2 / 100)),
      margin * 0.4,
    );
    for (const p of shrubPts) {
      const pc = toC(p.wx, p.wy);
      const r = baseR * (0.35 + rand() * 0.35);
      drawShrub(
        pc.x,
        pc.y,
        r,
        `rgba(30,${100 + Math.floor(rand() * 60)},30,0.75)`,
      );
    }
  } else if (tipo === "educativo") {
    const pa2 = principalAxis(mznPts);
    const extL2 = projectExtents(mznPts, pa2.ux, pa2.uy);
    const extS2 = projectExtents(mznPts, -pa2.uy, pa2.ux);
    const largo2 = wm(extL2.max - extL2.min) * 0.42 * zoom;
    const ancho2 = wm(extS2.max - extS2.min) * 0.35 * zoom;
    ctx.save();
    ctx.translate(cc.x, cc.y);
    ctx.rotate(Math.atan2(pa2.uy, pa2.ux));
    ctx.beginPath();
    ctx.rect(-largo2 / 2 + 3, -ancho2 / 2 + 3, largo2, ancho2);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fill();
    ctx.beginPath();
    ctx.rect(-largo2 / 2, -ancho2 / 2, largo2, ancho2);
    ctx.fillStyle = "rgba(220,200,160,0.82)";
    ctx.fill();
    ctx.strokeStyle = "rgba(160,130,80,0.9)";
    ctx.lineWidth = Math.max(0.8, 1.2 * zoom);
    ctx.stroke();
    const nVentanas = Math.max(2, Math.floor(largo2 / (12 * zoom)));
    for (let v = 1; v < nVentanas; v++) {
      const vx = -largo2 / 2 + (v / nVentanas) * largo2;
      ctx.beginPath();
      ctx.moveTo(vx, -ancho2 / 2 + 3);
      ctx.lineTo(vx, ancho2 / 2 - 3);
      ctx.strokeStyle = "rgba(160,130,80,0.5)";
      ctx.lineWidth = Math.max(0.5, 0.7 * zoom);
      ctx.stroke();
    }
    ctx.restore();
    const margin3 = mw(2.0);
    const treePts2 = samplePoints(
      Math.min(10, Math.floor(areaM2 / 200)),
      margin3,
    );
    for (const p of treePts2) {
      const pc = toC(p.wx, p.wy);
      const r = baseR * (0.6 + rand() * 0.5);
      drawTree(pc.x, pc.y, r, "#5a3a1a", "#2d7a2d", "#3aab3a");
    }
  } else {
    const pa3 = principalAxis(mznPts);
    const extL3 = projectExtents(mznPts, pa3.ux, pa3.uy);
    const extS3 = projectExtents(mznPts, -pa3.uy, pa3.ux);
    const largo3 = wm(extL3.max - extL3.min) * 0.5 * zoom;
    const ancho3 = wm(extS3.max - extS3.min) * 0.45 * zoom;
    ctx.save();
    ctx.translate(cc.x, cc.y);
    ctx.rotate(Math.atan2(pa3.uy, pa3.ux));
    ctx.beginPath();
    ctx.rect(-largo3 / 2 + 4, -ancho3 / 2 + 4, largo3, ancho3);
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fill();
    ctx.beginPath();
    ctx.rect(-largo3 / 2, -ancho3 / 2, largo3, ancho3);
    ctx.fillStyle = "rgba(200,215,235,0.80)";
    ctx.fill();
    ctx.strokeStyle = "rgba(120,150,190,0.85)";
    ctx.lineWidth = Math.max(0.8, 1.2 * zoom);
    ctx.stroke();
    const cs = Math.min(largo3, ancho3) * 0.22;
    ctx.fillStyle =
      tipo === "salud" ? "rgba(220,50,50,0.75)" : "rgba(50,80,180,0.65)";
    ctx.fillRect(-cs * 0.18, -cs * 0.55, cs * 0.36, cs * 1.1);
    ctx.fillRect(-cs * 0.55, -cs * 0.18, cs * 1.1, cs * 0.36);
    ctx.restore();
    const margin4 = mw(2.5);
    const treePts3 = samplePoints(
      Math.min(8, Math.floor(areaM2 / 500)),
      margin4,
    );
    for (const p of treePts3) {
      const pc = toC(p.wx, p.wy);
      const r = baseR * (0.55 + rand() * 0.4);
      drawTree(pc.x, pc.y, r, "#5a3a1a", "#2d7a2d", "#3aab3a");
    }
  }
  ctx.restore();
}

