// =====================================================================
// MÓDULO 17/17 · 17-plano-lote.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 03-state.js, 09-polygon-engine.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [17] PLANO POR LOTE — GENERACIÓN DE PLANO IMPRIMIBLE
// (candidato a módulo: plano-lote.js · depende de: [3],[9])
// =====================================================================
function abrirPlanoLote() {
  const todosLotes = _plGetAllLotes();
  if (manzanos.length === 0 || todosLotes.length === 0) {
    alert(t("alertNoLotes"));
    return;
  }
  document.getElementById("modalPlanoLote").style.display = "flex";
  plPopulateManzanos();
}

function cerrarModalPlanoLote() {
  document.getElementById("modalPlanoLote").style.display = "none";
}

function _plGetAllLotes() {
  const result = [];
  for (let mi = 0; mi < manzanos.length; mi++) {
    if (mznEquipamiento[mi]) continue;
    const sub = lotSubdivisions.find((s) => s.mznIdx === mi);
    if (sub && sub.lots.length > 0) {
      sub.lots.forEach((lt, j) =>
        result.push({ mznIdx: mi, loteIdx: j, lote: lt }),
      );
    }
    sliceLots
      .filter((sd) => sd.mznIdx === mi)
      .forEach((sd) => {
        sd.lots.forEach((lt, j) =>
          result.push({ mznIdx: mi, loteIdx: j, lote: lt }),
        );
      });
  }
  return result;
}

function plPopulateManzanos() {
  const sel = document.getElementById("plMznSel");
  sel.innerHTML = "";
  const vistos = new Set();
  _plGetAllLotes().forEach((it) => {
    if (!vistos.has(it.mznIdx)) {
      vistos.add(it.mznIdx);
      const o = document.createElement("option");
      o.value = it.mznIdx;
      o.textContent = `Manzano ${it.mznIdx + 1}`;
      sel.appendChild(o);
    }
  });
  plPopulateLotes();
}

function plPopulateLotes() {
  const mi = parseInt(document.getElementById("plMznSel").value);
  const sel = document.getElementById("plLoteSel");
  sel.innerHTML = "";
  _plGetAllLotes()
    .filter((it) => it.mznIdx === mi)
    .forEach((it, i) => {
      const area =
        it.lote.areaM2 !== undefined ? it.lote.areaM2 : polyAreaM2(it.lote.pts);
      const rem = it.lote.isRemnant ? " ★rem" : "";
      const o = document.createElement("option");
      o.value = i;
      o.textContent = `L${it.loteIdx + 1}${rem}  –  ${area.toFixed(1)} m²`;
      sel.appendChild(o);
    });
}
function _plToUTM(pts) {
  return pts.map((p) => {
    const mx = wm(p.x);
    const my = -wm(p.y);
    if (_geoOrigin) {
      return { este: _geoOrigin.utmX + mx, norte: _geoOrigin.utmY + my };
    }
    return { este: mx, norte: my };
  });
}

function _plDist(a, b) {
  return Math.sqrt(
    Math.pow(b.este - a.este, 2) + Math.pow(b.norte - a.norte, 2),
  );
}

function _plAzimut(a, b) {
  const dE = b.este - a.este,
    dN = b.norte - a.norte;
  let az = (Math.atan2(dE, dN) * 180) / Math.PI;
  if (az < 0) az += 360;
  const deg = Math.floor(az);
  const minTot = (az - deg) * 60;
  const min = Math.floor(minTot);
  const sec = Math.round((minTot - min) * 60);
  return `${deg}°${String(min).padStart(2, "0")}'${String(sec).padStart(2, "0")}"`;
}

function _plPerimetro(pts) {
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

function _plBuildEsquemaSVG(mi, lotePts, ESQW, ESQH, ESQPAD) {
  let exMin = Infinity,
    exMax = -Infinity,
    eyMin = Infinity,
    eyMax = -Infinity;
  manzanos.forEach((mzn) => {
    mzn.pts.forEach((p) => {
      if (p.x < exMin) exMin = p.x;
      if (p.x > exMax) exMax = p.x;
      if (p.y < eyMin) eyMin = p.y;
      if (p.y > eyMax) eyMax = p.y;
    });
  });

  if (typeof streetPolygons !== "undefined") {
    streetPolygons.forEach((sp) => {
      sp.pts &&
        sp.pts.forEach((p) => {
          if (p.x < exMin) exMin = p.x;
          if (p.x > exMax) exMax = p.x;
          if (p.y < eyMin) eyMin = p.y;
          if (p.y > eyMax) eyMax = p.y;
        });
    });
  }

  if (typeof polyPts !== "undefined") {
    polyPts.forEach((p) => {
      if (p.x < exMin) exMin = p.x;
      if (p.x > exMax) exMax = p.x;
      if (p.y < eyMin) eyMin = p.y;
      if (p.y > eyMax) eyMax = p.y;
    });
  }

  const spanW = exMax - exMin || 1,
    spanH = eyMax - eyMin || 1;
  const esqScale = Math.min(
    (ESQW - ESQPAD * 2) / spanW,
    (ESQH - ESQPAD * 2) / spanH,
  );
  const esqOffX =
    ESQPAD + (ESQW - ESQPAD * 2 - spanW * esqScale) / 2 - exMin * esqScale;
  const esqOffY =
    ESQPAD + (ESQH - ESQPAD * 2 - spanH * esqScale) / 2 - eyMin * esqScale;
  function toE(wx, wy) {
    return { x: wx * esqScale + esqOffX, y: wy * esqScale + esqOffY };
  }
  let svg = "";
  if (typeof polyPts !== "undefined" && polyPts.length >= 3) {
    const parcelaPts = polyPts
      .map((p) => {
        const c = toE(p.x, p.y);
        return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
      })
      .join(" ");
    svg += `<polygon points="${parcelaPts}" fill="none" stroke="#000000" stroke-width="1" stroke-linejoin="round"/>`;
  }

  if (typeof streetPolygons !== "undefined" && streetPolygons.length > 0) {
    streetPolygons.forEach((sp) => {
      if (!sp.pts || sp.pts.length < 2) return;
      const sPts = sp.pts
        .map((p) => {
          const c = toE(p.x, p.y);
          return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
        })
        .join(" ");
      svg += `<polygon points="${sPts}" fill="#e8e8e8" stroke="#aaa" stroke-width="0.5"/>`;
    });
  }
  streets.forEach((s, idx) => {
    const sc = toE(s.start.x, s.start.y);
    const ec = toE(s.end.x, s.end.y);
    const rect = streetRect(s);
    svg += `<line x1="${sc.x.toFixed(1)}" y1="${sc.y.toFixed(1)}" x2="${ec.x.toFixed(1)}" y2="${ec.y.toFixed(1)}"
          stroke="#888888" stroke-width="0.8" stroke-dasharray="4,3"/>`;
    const midX = (sc.x + ec.x) / 2;
    const midY = (sc.y + ec.y) / 2;
    const dx = ec.x - sc.x,
      dy = ec.y - sc.y;
    let angDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angDeg > 90 || angDeg < -90) angDeg += 180;
    const nombreCalle = `Calle ${String.fromCharCode(64 + idx + 1)} (${s.width.toFixed(1)}m)`;
    svg += `<text x="${midX.toFixed(1)}" y="${midY.toFixed(1)}"
          text-anchor="middle" dominant-baseline="middle"
          font-family="Arial" font-size="5" fill="#666666"
          transform="rotate(${angDeg.toFixed(1)},${midX.toFixed(1)},${midY.toFixed(1)})">${nombreCalle}</text>`;
  });

  manzanos.forEach((mzn, idx) => {
    const esMiMzn = idx === mi;
    const mPts = mzn.pts
      .map((p) => {
        const c = toE(p.x, p.y);
        return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
      })
      .join(" ");
    if (mznEquipamiento && mznEquipamiento[idx]) {
      svg += `<polygon points="${mPts}" fill="#ddd" stroke="#888" stroke-width="0.7"/>`;
    } else {
      svg += `<polygon points="${mPts}" fill="none" stroke="#555" stroke-width="${esMiMzn ? 1.2 : 0.7}"/>`;
    }

    const swPtsEsq = buildSidewalkWorldPts(mzn.pts);
    if (swPtsEsq && swPtsEsq.length >= 3) {
      const vPtsEsq = swPtsEsq
        .map((p) => {
          const c = toE(p.x, p.y);
          return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
        })
        .join(" ");
      svg += `<polygon points="${vPtsEsq}" fill="none"
            stroke="${esMiMzn ? "#333333" : "#888888"}"
            stroke-width="${esMiMzn ? 0.9 : 0.6}"
            stroke-dasharray="3,2"/>`;
    }

    const cenMzn = centroid(mzn.pts);
    const cLbl = toE(cenMzn.x, cenMzn.y);
    const letraMzn = String.fromCharCode(65 + idx);
    svg += `<text x="${cLbl.x.toFixed(1)}" y="${cLbl.y.toFixed(1)}"
          text-anchor="middle" dominant-baseline="middle"
          font-family="Arial" font-size="7" font-weight="bold" fill="${esMiMzn ? "#000" : "#777"}"
          >MZO. ${letraMzn}</text>`;
  });

  _plGetAllLotes().forEach((it) => {
    const esMiMzn = it.mznIdx === mi;
    const ePts = it.lote.pts
      .map((p) => {
        const c = toE(p.x, p.y);
        return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
      })
      .join(" ");
    svg += `<polygon points="${ePts}" fill="none" stroke="${esMiMzn ? "#444" : "#888"}" stroke-width="${esMiMzn ? 0.6 : 0.4}"/>`;
  });

  const esqLotePts = lotePts
    .map((p) => {
      const c = toE(p.x, p.y);
      return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
    })
    .join(" ");
  const loteCenW = centroid(lotePts);
  const esqCen = toE(loteCenW.x, loteCenW.y);
  svg += `<polygon points="${esqLotePts}" fill="none" stroke="#000" stroke-width="2"/>`;
  if (typeof streets !== "undefined" && streets.length > 0) {
    streets.forEach((st) => {
      if (!st.name || !st.pts || st.pts.length < 2) return;
      // Punto medio de la calle
      const mid = st.pts[Math.floor(st.pts.length / 2)];
      const cMid = toE(mid.x, mid.y);
      // Ángulo de la calle
      const p0 = st.pts[0],
        p1 = st.pts[st.pts.length - 1];
      let ang = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
      if (ang > 90 || ang < -90) ang += 180;
      svg += `<text x="${cMid.x.toFixed(1)}" y="${cMid.y.toFixed(1)}"
            text-anchor="middle" dominant-baseline="middle"
            font-family="Arial" font-size="6" fill="#333"
            transform="rotate(${ang.toFixed(1)},${cMid.x.toFixed(1)},${cMid.y.toFixed(1)})"
            >${st.name}</text>`;
    });
  }

  const loteNum =
    _plGetAllLotes()
      .filter((it) => it.mznIdx === mi)
      .findIndex((it) => it.lote === lotePts) + 1;
  svg += `<text x="${esqCen.x.toFixed(1)}" y="${esqCen.y.toFixed(1)}"
        text-anchor="middle" dominant-baseline="middle"
        font-family="Arial" font-size="8" font-weight="bold" fill="#000"></text>`;
  return { svg, esqCen, toE };
}

function generarPlanoLote() {
  const mi = parseInt(document.getElementById("plMznSel").value);
  const listaIdx = parseInt(document.getElementById("plLoteSel").value);
  const propiet =
    document.getElementById("plPropietario").value || "XXXXXXXXXXXXXXX";
  const arq =
    document.getElementById("plArquitecto").value || "XXXXXXXXXXXXXXX";
  const urb =
    document.getElementById("plUrbanizacion").value || "URB. SAI SOLUCIONES";
  const lamina = document.getElementById("plLamina").value || "PP-01";
  const listaMi = _plGetAllLotes().filter((it) => it.mznIdx === mi);
  if (listaIdx < 0 || listaIdx >= listaMi.length) return;
  const item = listaMi[listaIdx];
  const lote = item.lote;
  const lotePts = lote.pts;
  const nVerts = lotePts.length;
  const areaM2 = lote.areaM2 !== undefined ? lote.areaM2 : polyAreaM2(lotePts);
  const perimM = _plPerimetro(lotePts);
  const utmPts = _plToUTM(lotePts);
  const mznLetra = String.fromCharCode(65 + mi);
  const loteNum = item.loteIdx + 1;
  const fecha = new Date()
    .toLocaleDateString("es-BO", { month: "short", year: "numeric" })
    .toUpperCase();
  const fechaIso = new Date().toISOString().slice(0, 10);
  const zonaTxt = _geoOrigin
    ? `${_geoOrigin.zone} ${_geoOrigin.hemi === "south" ? "SUR" : "NORTE"}`
    : "19 SUR";

  const refEste = utmPts[0].este.toFixed(4);
  const refNorte = utmPts[0].norte.toFixed(4);

  let filasCoords = "";
  for (let i = 0; i < nVerts; i++) {
    const u1 = utmPts[i];
    const u2 = utmPts[(i + 1) % nVerts];
    const dist = _plDist(u1, u2).toFixed(2);
    const angGradInterno = _angInternoGrad(lotePts, i);
    const angInt = _fmtDMS(angGradInterno);

    filasCoords += `
      <tr>
        <td>P${i + 1}</td>
        <td>P${i + 1} - P${((i + 1) % nVerts) + 1}</td>
        <td>${dist}</td>
        <td>${angInt}</td>
        <td>${u1.este.toFixed(4)}</td>
        <td>${u1.norte.toFixed(4)}</td>
      </tr>`;
  }

  let lxMin = Infinity,
    lxMax = -Infinity,
    lyMin = Infinity,
    lyMax = -Infinity;
  for (const p of lotePts) {
    if (p.x < lxMin) lxMin = p.x;
    if (p.x > lxMax) lxMax = p.x;
    if (p.y < lyMin) lyMin = p.y;
    if (p.y > lyMax) lyMax = p.y;
  }

  const SVGW = 860,
    SVGH = 650,
    SVGPAD = 70;
  const spanW = lxMax - lxMin || 1,
    spanH = lyMax - lyMin || 1;
  const scaleF = Math.min(
    (SVGW - SVGPAD * 2) / spanW,
    (SVGH - SVGPAD * 2) / spanH,
  );
  const drawW = spanW * scaleF,
    drawH = spanH * scaleF;
  const offX = SVGPAD + (SVGW - SVGPAD * 2 - drawW) / 2 - lxMin * scaleF;
  const offY = SVGPAD + (SVGH - SVGPAD * 2 - drawH) / 2 - lyMin * scaleF;

  function toSVG(wx, wy) {
    return { x: wx * scaleF + offX, y: wy * scaleF + offY };
  }

  const svgLotePts = lotePts
    .map((p) => {
      const c = toSVG(p.x, p.y);
      return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
    })
    .join(" ");
  let svgVecinos = "";
  _plGetAllLotes()
    .filter((it) => it.mznIdx === mi)
    .forEach((it) => {
      const vPts = it.lote.pts
        .map((p) => {
          const c = toSVG(p.x, p.y);
          return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
        })
        .join(" ");
      svgVecinos += `<polygon points="${vPts}" fill="none" stroke="#999999" stroke-width="0.6" stroke-dasharray="3,2"/>`;
    });

  let svgManzano = "";
  manzanos.forEach((mzn, idx) => {
    const esMiMzn = idx === mi;
    const mPts = mzn.pts
      .map((p) => {
        const c = toSVG(p.x, p.y);
        return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
      })
      .join(" ");
    svgManzano += `<polygon points="${mPts}" fill="none" stroke="${esMiMzn ? "#333333" : "#aaaaaa"}" stroke-width="${esMiMzn ? 1.5 : 0.8}" stroke-dasharray="${esMiMzn ? "none" : "5,3"}"/>`;
    const cenMzn = centroid(mzn.pts);
    const cLblMzn = toSVG(cenMzn.x, cenMzn.y);
    const letraMzn = String.fromCharCode(65 + idx);
    svgManzano += `<text x="${cLblMzn.x.toFixed(1)}" y="${cLblMzn.y.toFixed(1)}"
          text-anchor="middle" dominant-baseline="middle"
          font-family="Arial" font-size="11" font-weight="bold"
          fill="${esMiMzn ? "#222222" : "#aaaaaa"}">MZO. ${letraMzn}</text>`;
    const swPtsVereda = buildSidewalkWorldPts(mzn.pts);
    if (swPtsVereda && swPtsVereda.length >= 3) {
      const vPtsSVG = swPtsVereda
        .map((p) => {
          const c = toSVG(p.x, p.y);
          return `${c.x.toFixed(1)},${c.y.toFixed(1)}`;
        })
        .join(" ");
      svgManzano += `<polygon points="${vPtsSVG}" fill="none"
            stroke="${esMiMzn ? "#555555" : "#cccccc"}"
            stroke-width="${esMiMzn ? 1.0 : 0.6}"
            stroke-dasharray="4,3"/>`;
    }
  });

  let svgCalles = "";
  streets.forEach((s, idx) => {
    const sc = toSVG(s.start.x, s.start.y);
    const ec = toSVG(s.end.x, s.end.y);
    const rect = streetRect(s);

    svgCalles += `<line x1="${sc.x.toFixed(1)}" y1="${sc.y.toFixed(1)}" x2="${ec.x.toFixed(1)}" y2="${ec.y.toFixed(1)}"
        stroke="#444444" stroke-width="2" stroke-dasharray="7,5"/>`;
    const dx = s.end.x - s.start.x,
      dy = s.end.y - s.start.y;
    const lenSq = dx * dx + dy * dy || 1;
    const loteCen = centroid(lotePts);
    let t =
      ((loteCen.x - s.start.x) * dx + (loteCen.y - s.start.y) * dy) / lenSq;
    t = Math.max(0.1, Math.min(0.9, t));
    const nearW = { x: s.start.x + t * dx, y: s.start.y + t * dy };
    const nearC = toSVG(nearW.x, nearW.y);
    let angDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angDeg > 90 || angDeg < -90) angDeg += 180;
    const streetIdx = idx + 1;
    const nombreCalle = `--- Calle ${String.fromCharCode(64 + streetIdx)} (Ancho de Vía ${s.width.toFixed(2)}m) ---`;
    const ejeTexto = "E    J    E         D    E         V    Í    A";
    svgCalles += `
          <text x="${nearC.x.toFixed(1)}" y="${(nearC.y - 10).toFixed(1)}"
            text-anchor="middle" dominant-baseline="middle"
            font-family="Courier New" font-size="11" font-weight="bold" fill="#333333"
            transform="rotate(${angDeg.toFixed(1)},${nearC.x.toFixed(1)},${nearC.y.toFixed(1)})">${nombreCalle}</text>
          <text x="${nearC.x.toFixed(1)}" y="${(nearC.y + 8).toFixed(1)}"
            text-anchor="middle" dominant-baseline="middle"
            font-family="Courier New" font-size="9" fill="#666666"
            transform="rotate(${angDeg.toFixed(1)},${nearC.x.toFixed(1)},${nearC.y.toFixed(1)})">${ejeTexto}</text>`;
  });

  const loteCenW = centroid(lotePts);
  let svgCotas = "";
  let svgVertices = "";

  function _rumbo(dxW, dyW) {
    const dE = dxW * MPP;
    const dN = -dyW * MPP;
    let az = (Math.atan2(dE, dN) * 180) / Math.PI;
    if (az < 0) az += 360;
    const cuad =
      az <= 90
        ? ["N", "E", az]
        : az <= 180
          ? ["S", "E", 180 - az]
          : az <= 270
            ? ["S", "W", az - 180]
            : ["N", "W", 360 - az];
    const grados = Math.floor(cuad[2]);
    const minTot = (cuad[2] - grados) * 60;
    const min = Math.floor(minTot);
    const sec = ((minTot - min) * 60).toFixed(2);
    return `${cuad[0]} ${grados}° ${String(min).padStart(2, "0")}' ${String(sec).padStart(5, "0")}" ${cuad[1]}`;
  }

  function _angInternoGrad(pts, i) {
    const n = pts.length;
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const ax = prev.x - curr.x,
      ay = prev.y - curr.y;
    const bx = next.x - curr.x,
      by = next.y - curr.y;
    const dot = ax * bx + ay * by;
    const lenA = Math.sqrt(ax * ax + ay * ay) || 1;
    const lenB = Math.sqrt(bx * bx + by * by) || 1;
    const cosA = Math.max(-1, Math.min(1, dot / (lenA * lenB)));
    const angEntre = (Math.acos(cosA) * 180) / Math.PI;

    let area2 = 0;
    for (let k = 0; k < n; k++) {
      const p0 = pts[k],
        p1 = pts[(k + 1) % n];
      area2 += p0.x * p1.y - p1.x * p0.y;
    }

    const cross = ax * by - ay * bx;
    const esInterior = area2 > 0 ? cross < 0 : cross > 0;
    return esInterior ? angEntre : 360 - angEntre;
  }

  function _fmtDMS(ang) {
    const deg = Math.floor(ang);
    const minTot = (ang - deg) * 60;
    const min = Math.floor(minTot);
    const sec = Math.round((minTot - min) * 60);
    return `${deg}°${String(min).padStart(2, "0")}'${String(sec).padStart(2, "0")}"`;
  }

  function _svgAngulo(pts, i, toSVGfn, R, angStr) {
    const n = pts.length;
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const vc = toSVGfn(curr.x, curr.y);
    const ang1 = Math.atan2(
      toSVGfn(prev.x, prev.y).y - vc.y,
      toSVGfn(prev.x, prev.y).x - vc.x,
    );
    const ang2 = Math.atan2(
      toSVGfn(next.x, next.y).y - vc.y,
      toSVGfn(next.x, next.y).x - vc.x,
    );
    const x1 = vc.x + R * Math.cos(ang1);
    const y1 = vc.y + R * Math.sin(ang1);
    const x2 = vc.x + R * Math.cos(ang2);
    const y2 = vc.y + R * Math.sin(ang2);
    const angInterno = _angInternoGrad(pts, i);
    const largeArc = angInterno > 180 ? 1 : 0;
    let area2 = 0;
    for (let k = 0; k < n; k++) {
      const p0 = pts[k],
        p1 = pts[(k + 1) % n];
      area2 += p0.x * p1.y - p1.x * p0.y;
    }
    const sweep = area2 > 0 ? 0 : 1;
    const tangAng = ang2 + (sweep === 1 ? -Math.PI / 2 : Math.PI / 2);
    const arrowSize = 5;
    const ax1 = x2 + arrowSize * Math.cos(tangAng - 0.4);
    const ay1 = y2 + arrowSize * Math.sin(tangAng - 0.4);
    const ax2 = x2 + arrowSize * Math.cos(tangAng + 0.4);
    const ay2 = y2 + arrowSize * Math.sin(tangAng + 0.4);

    let angMid;
    if (sweep === 1) {
      let a1 = ang1,
        a2 = ang2;
      if (a2 > a1) a2 -= 2 * Math.PI;
      angMid = (a1 + a2) / 2;
      if (largeArc) angMid += Math.PI;
    } else {
      let a1 = ang1,
        a2 = ang2;
      if (a2 < a1) a2 += 2 * Math.PI;
      angMid = (a1 + a2) / 2;
      if (largeArc) angMid -= Math.PI;
    }
    const labelR = R + 18;
    const lx = vc.x - labelR * Math.cos(angMid);
    const ly = vc.y - labelR * Math.sin(angMid);

    return `
      <path d="M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 ${largeArc} ${sweep} ${x2.toFixed(1)} ${y2.toFixed(1)}"
            fill="none" stroke="#e67e22" stroke-width="1.5"/>
      <polygon points="${x2.toFixed(1)},${y2.toFixed(1)} ${ax1.toFixed(1)},${ay1.toFixed(1)} ${ax2.toFixed(1)},${ay2.toFixed(1)}"
            fill="#e67e22"/>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}"
            text-anchor="middle" dominant-baseline="middle"
            font-family="Arial" font-size="9" font-weight="bold" fill="#e67e22">${angStr}</text>`;
  }

  for (let i = 0; i < nVerts; i++) {
    const pA = lotePts[i],
      pB = lotePts[(i + 1) % nVerts];
    const dxW = pB.x - pA.x,
      dyW = pB.y - pA.y;
    const lenM = Math.sqrt(dxW * dxW + dyW * dyW) * MPP;
    if (lenM < 0.1) continue;
    const midW = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
    const midC = toSVG(midW.x, midW.y);
    let ang = (Math.atan2(dyW, dxW) * 180) / Math.PI;
    if (ang > 90 || ang < -90) ang += 180;
    const segLen = Math.sqrt(dxW * dxW + dyW * dyW) || 1;
    const nxSeg = -dyW / segLen,
      nySeg = dxW / segLen;
    const dotOut =
      (midW.x - loteCenW.x) * nxSeg + (midW.y - loteCenW.y) * nySeg;
    const outX = dotOut >= 0 ? nxSeg : -nxSeg;
    const outY = dotOut >= 0 ? nySeg : -nySeg;
    const inX = -outX,
      inY = -outY;
    const offsetPx = 10;
    const offsetRumboPx = 10;
    const tx = midC.x + outX * offsetPx;
    const ty = midC.y + outY * offsetPx;
    const rx = midC.x + inX * offsetRumboPx;
    const ry = midC.y + inY * offsetRumboPx;
    const label = lenM >= 100 ? lenM.toFixed(1) + " m" : lenM.toFixed(2) + " m";
    const rumbo = _rumbo(dxW, dyW);

    svgCotas += `
      <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}"
            text-anchor="middle" dominant-baseline="middle"
            font-family="Arial" font-size="12" font-weight="bold" fill="#111111"
            transform="rotate(${ang.toFixed(2)},${tx.toFixed(1)},${ty.toFixed(1)})">${label}</text>`;

    svgCotas += `
      <text x="${rx.toFixed(1)}" y="${ry.toFixed(1)}"
            text-anchor="middle" dominant-baseline="middle"
            font-family="Arial" font-size="10" fill="#1a5276"
            transform="rotate(${ang.toFixed(2)},${rx.toFixed(1)},${ry.toFixed(1)})">${rumbo}</text>`;

    const vc = toSVG(pA.x, pA.y);
    svgVertices += `
      <circle cx="${vc.x.toFixed(1)}" cy="${vc.y.toFixed(1)}" r="5" fill="#c0392b" stroke="white" stroke-width="1.2"/>
      <text x="${(vc.x + 8).toFixed(1)}" y="${(vc.y - 5).toFixed(1)}"
            font-family="Arial" font-size="12" font-weight="bold" fill="#c0392b">P${i + 1}</text>`;

    const R = 20;
    const angGrad = _angInternoGrad(lotePts, i);
    const angStr = angGrad.toFixed(2) + "°";
    svgVertices += _svgAngulo(lotePts, i, toSVG, R, angStr);
  }

  const loteCenC = toSVG(loteCenW.x, loteCenW.y);
  const svgEtiqueta = `
          <text x="${loteCenC.x.toFixed(1)}" y="${(loteCenC.y - 22).toFixed(1)}"
          text-anchor="middle" font-family="Arial" font-size="13" font-weight="bold" fill="#222">N° Lote: ${loteNum}</text>
          <text x="${loteCenC.x.toFixed(1)}" y="${(loteCenC.y - 6).toFixed(1)}"
          text-anchor="middle" font-family="Arial" font-size="12" font-weight="bold" fill="#222">Mzo: ${mznLetra}</text>
          <text x="${loteCenC.x.toFixed(1)}" y="${(loteCenC.y + 12).toFixed(1)}"
          text-anchor="middle" font-family="Arial" font-size="12" fill="#333">Sup: ${areaM2.toFixed(2)} m²</text>`;

  const mPerPx = MPP / scaleF;
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  const rawM = 100 * mPerPx;
  let niceM = steps[0];
  steps.forEach((s) => {
    if (s <= rawM * 1.5) niceM = s;
  });
  const barPx = niceM / mPerPx;
  const bx = 20,
    by = SVGH - 8;
  const scaleNum = Math.round(96 / 0.0254 / (scaleF / MPP));
  const svgScaleBar = `
        <rect x="${bx}" y="${by - 6}" width="${barPx / 2}" height="6" fill="#333"/>
        <rect x="${bx + barPx / 2}" y="${by - 6}" width="${barPx / 2}" height="6" fill="#aaa"/>
        <rect x="${bx}" y="${by - 6}" width="${barPx}" height="6" fill="none" stroke="#333" stroke-width="0.8"/>
        <text x="${bx}" y="${by + 7}" font-family="Arial" font-size="9" fill="#333">0</text>
        <text x="${(bx + barPx).toFixed(1)}" y="${by + 7}" font-family="Arial" font-size="9" fill="#333">${niceM}m</text>
        <text x="${bx}" y="${by + 17}" font-family="Arial" font-size="8" fill="#555">ESCALA 1:${scaleNum.toLocaleString("es-BO")}</text>`;

  const ESQW = 240,
    ESQH = 220,
    ESQPAD = 12;
  const _esq = _plBuildEsquemaSVG(mi, lotePts, ESQW, ESQH, ESQPAD);
  const svgEsqVecinos = _esq.svg;
  const svgEsqLote = "";
  const esqCen = _esq.esqCen;

  function _axisLabels(min, max, n, toUTM_fn) {
    const labels = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const worldVal = min + t * (max - min);
      const utmVal = toUTM_fn(worldVal);
      labels.push(Math.round(utmVal));
    }
    return labels;
  }
  const axisXLabels = _axisLabels(lxMin, lxMax, 3, (v) => {
    const mx = wm(v);
    return _geoOrigin ? _geoOrigin.utmX + mx : mx;
  });
  const axisYLabels = _axisLabels(lyMin, lyMax, 3, (v) => {
    const my = -wm(v);
    return _geoOrigin ? _geoOrigin.utmY + my : my;
  });

  const htmlPlano = `<!DOCTYPE html>
        <html lang="es">
        <head>
        <meta charset="UTF-8">
        <title>Plano Perimétrico — ${urb} · L-${loteNum} · Mzo. ${mznLetra}</title>
        <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:Arial,sans-serif;background:#ccc;display:flex;justify-content:center;padding:20px;}
        .page{background:white;width:1250px;min-height:816px;padding:28px 32px;display:flex;flex-direction:column;gap:10px;color:black;border:2px solid black;}
        .toolbar{display:flex;gap:8px;align-items:center;padding:4px 0;flex-shrink:0;}
        .toolbar button{padding:4px 12px;font-size:11px;font-family:Arial,sans-serif;border:1.5px solid #333;background:white;cursor:pointer;font-weight:bold;}
        .toolbar button:hover{background:#eee;}
        .top-row{display:flex;gap:10px;align-items:stretch;flex:1;}
        .main-canvas-wrapper{display:flex;flex-direction:column;border:2px solid black;flex:1;}
        .main-axis-top,.main-axis-bottom{display:flex;justify-content:space-around;padding:2px 22px;font-size:10px;font-weight:bold;flex-shrink:0;}
        .main-map-middle{display:flex;align-items:stretch;flex:1;}
        .main-axis-left,.main-axis-right{width:20px;flex-shrink:0;display:flex;flex-direction:column;justify-content:space-around;align-items:center;background:transparent;overflow:visible;}
        .main-axis-left span,.main-axis-right span{font-size:10px;font-weight:bold;white-space:nowrap;display:block;transform:rotate(-90deg);transform-origin:center center;background:white;padding:0 2px;}
        .main-map-canvas{flex:1;border:1.5px solid black;position:relative;background:white;overflow:hidden;min-height:560px;}
        .main-map-canvas::before{content:none;}
        .main-footer{display:flex;justify-content:space-between;padding:3px 8px;border-top:1.5px solid black;font-size:9px;font-weight:bold;flex-shrink:0;}
        .right-col{display:flex;flex-direction:column;gap:8px;width:340px;flex-shrink:0;justify-content:space-between;}
        .map-wrapper{display:flex;flex-direction:column;border:2px solid black;}
        .axis-top,.axis-bottom{display:flex;justify-content:space-between;padding:2px 22px;font-size:10px;font-weight:bold;}
        .map-middle{display:flex;align-items:stretch;}
        .axis-left,.axis-right{width:20px;flex-shrink:0;display:flex;flex-direction:column;justify-content:space-around;align-items:center;background:transparent;overflow:visible;}
        .axis-left span,.axis-right span{font-size:10px;font-weight:bold;white-space:nowrap;display:block;transform:rotate(-90deg);transform-origin:center center;background:white;padding:0 2px;}
        .map-canvas{flex:1;border:1.5px solid black;position:relative;height:220px;background:white;overflow:hidden;}
        .map-canvas::before{content:none;}
        .compass{position:absolute;top:8px;left:8px;width:48px;height:48px;z-index:2;}
        .map-footer{display:flex;justify-content:space-between;align-items:center;padding:3px 6px;border-top:1.5px solid black;font-size:9px;font-weight:bold;}
        .tbl2{border-collapse:collapse;width:100%;}
        .tbl2 td,.tbl2 th{border:1.5px solid black;padding:2px 3px;font-size:9px;text-align:center;}
        .tbl2 th{font-weight:bold;}
        .tbl2 .title-row td{font-weight:bold;font-size:9px;}
        .area-info{font-size:9px;padding-left:4px;line-height:1.7;margin-top:3px;}
        .tbl{border-collapse:collapse;width:100%;}
        .tbl td{border:1.5px solid black;padding:2px 4px;font-size:9px;vertical-align:top;}
        .lbl{font-size:7.5px;font-weight:bold;display:block;}
        .val{font-size:8.5px;display:block;text-align:center;}
        .draw-svg{position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;}
        .compass-svg{position:absolute;top:10px;left:10px;width:58px;height:58px;z-index:4;pointer-events:none;}
        @media print{
          body{background:white;padding:0;}
          .page{border:none;}
          .toolbar{display:none;}
          * { -webkit-print-color-adjust: exact; color-adjust: exact; }
          svg polygon, svg rect, svg circle { fill: white !important; }
          svg polygon[stroke], svg polyline[stroke] { stroke: black !important; }
          .main-map-canvas::before, .map-canvas::before { display: none; }
        }
        </style>
        </head>
        <body>
        <div class="page">

          <div class="toolbar">
            <button onclick="window.print()">&#9112; Imprimir</button>
            <button onclick="window.close()">&#10005; Cerrar</button>
            <button onclick="descargarPNG()">&#11015; Descargar PNG</button>

            <span style="display:flex;align-items:center;gap:4px;margin-left:8px;">
              <span style="font-size:10px;font-weight:bold;color:#333;">MZO:</span>
              <button onclick="nav(-1,0)" title="Manzano anterior">&#9664;</button>
              <span id="lblMzn" style="font-size:11px;font-weight:900;min-width:24px;text-align:center;">${mznLetra}</span>
              <button onclick="nav(+1,0)" title="Manzano siguiente">&#9654;</button>
            </span>

            <span style="display:flex;align-items:center;gap:4px;margin-left:6px;">
              <span style="font-size:10px;font-weight:bold;color:#333;">LOTE:</span>
              <button onclick="nav(0,-1)" title="Lote anterior">&#9664;</button>
              <span id="lblLot" style="font-size:11px;font-weight:900;min-width:28px;text-align:center;">L-${loteNum}</span>
              <button onclick="nav(0,+1)" title="Lote siguiente">&#9654;</button>
            </span>

            <span style="font-size:10px;color:#555;margin-left:8px;">${urb} &nbsp;·&nbsp; ${areaM2.toFixed(2)} m² &nbsp;·&nbsp; Perímetro: ${perimM.toFixed(2)} ml</span>
          </div>

          <div class="top-row">
            <!-- MAPA PRINCIPAL -->
            <div class="main-canvas-wrapper">
              <div class="main-axis-top">
                <span>${axisXLabels[0]}</span><span>${axisXLabels[1]}</span><span>${axisXLabels[2]}</span>
              </div>
              <div class="main-map-middle">
                <div class="main-axis-left">
                  <span>${axisYLabels[2]}</span>
                  <span>${axisYLabels[1]}</span>
                  <span>${axisYLabels[0]}</span>
                </div>
                <div class="main-map-canvas">
                  <img src="assets/sai.png"
                  style="position:absolute;top:10px;left:10px;width:90px;height:90px;
                  object-fit:contain;z-index:4;pointer-events:none;" />
                  <svg class="draw-svg" viewBox="0 0 ${SVGW} ${SVGH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
                    <!-- Líneas de grilla solo en posiciones de los ejes -->
                    ${[0, 0.5, 1]
                      .map((t) => {
                        const px = (SVGPAD + t * (SVGW - SVGPAD * 2)).toFixed(
                          1,
                        );
                        return `<line x1="${px}" y1="0" x2="${px}" y2="${SVGH}" stroke="#d0d0d0" stroke-width="0.5" stroke-dasharray="4,4"/>`;
                      })
                      .join("")}
                    ${[0, 0.5, 1]
                      .map((t) => {
                        const py = (SVGPAD + t * (SVGH - SVGPAD * 2)).toFixed(
                          1,
                        );
                        return `<line x1="0" y1="${py}" x2="${SVGW}" y2="${py}" stroke="#d0d0d0" stroke-width="0.5" stroke-dasharray="4,4"/>`;
                      })
                      .join("")}
                    ${svgCalles}
                    ${svgManzano}
                    ${svgVecinos}
                    <polygon points="${svgLotePts}" fill="none" stroke="#000000" stroke-width="2.2" stroke-linejoin="round"/>
                    ${svgCotas}
                    ${svgVertices}
                    ${svgEtiqueta}
                    ${svgScaleBar}
                  </svg>
                  <div style="position:absolute;bottom:4px;right:8px;font-size:14px;color:#666;z-index:2;">&#8991;&nbsp;&#8991;</div>
                </div>
                <div class="main-axis-right">
                  <span>${axisYLabels[0]}</span>
                  <span>${axisYLabels[1]}</span>
                  <span>${axisYLabels[2]}</span>
                </div>
              </div>
              <div class="main-axis-bottom">
                <span>${axisXLabels[0]}</span><span>${axisXLabels[1]}</span><span>${axisXLabels[2]}</span>
              </div>
              <div class="main-footer">
                <span>PLANO PERIMÉTRICO</span><span>ESCALA 1:${scaleNum.toLocaleString("es-BO")}</span>
              </div>
            </div>
            <!-- COLUMNA DERECHA -->
            <div class="right-col">
              <!-- ESQUEMA DE UBICACIÓN -->
              <div class="map-wrapper">
                <div class="axis-top">
                  <span>${axisXLabels[0]}</span><span>${axisXLabels[2]}</span>
                </div>
                <div class="map-middle">
                  <div class="axis-left">
                    <span>${axisYLabels[0]}</span>
                    <span>${axisYLabels[2]}</span>
                  </div>
                  <div class="map-canvas">
                    <img src="assets/sai.png"
                    style="position:absolute;top:8px;left:8px;width:48px;height:48px;
                    object-fit:contain;z-index:2;pointer-events:none;" />
                    <svg class="draw-svg" viewBox="0 0 ${ESQW} ${ESQH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" style="pointer-events:none;">
                      <!-- Líneas de grilla solo en posiciones de los ejes -->
                      ${[0, 1]
                        .map((t) => {
                          const px = (12 + t * (ESQW - 24)).toFixed(1);
                          return `<line x1="${px}" y1="0" x2="${px}" y2="${ESQH}" stroke="#d0d0d0" stroke-width="0.5" stroke-dasharray="3,3"/>`;
                        })
                        .join("")}
                      ${[0, 1]
                        .map((t) => {
                          const py = (12 + t * (ESQH - 24)).toFixed(1);
                          return `<line x1="0" y1="${py}" x2="${ESQW}" y2="${py}" stroke="#d0d0d0" stroke-width="0.5" stroke-dasharray="3,3"/>`;
                        })
                        .join("")}
                      ${svgEsqVecinos}
                    </svg>
                    <div style="position:absolute;bottom:4px;right:6px;font-size:12px;color:#666;z-index:2;">&#8991;&nbsp;&#8991;</div>
                  </div>
                  <div class="axis-right">
                    <span>${axisYLabels[0]}</span>
                    <span>${axisYLabels[2]}</span>
                  </div>
                </div>
                <div class="axis-bottom">
                  <span>${axisXLabels[0]}</span><span>${axisXLabels[2]}</span>
                </div>
                <div class="map-footer">
                  <span>ESQUEMA DE UBICACIÓN</span><span>ESCALA: 1/5,000</span>
                </div>
              </div>
              <!-- TABLA DE COORDENADAS -->
              <div>
                <table class="tbl2">
                  <tr class="title-row">
                    <td colspan="6">CUADRO DE COORDENADAS UTM - DATUM: WGS 84 - ZONA: ${zonaTxt}</td>
                  </tr>
                  <tr>
                    <th>VERT.</th><th>LADO SEG.</th><th>DIST.</th><th>ANGULO</th><th>ESTE</th><th>NORTE</th>
                  </tr>
                  ${filasCoords}
                </table>
                <div class="area-info">
                  Area: ${areaM2.toFixed(2)} m²&nbsp;&nbsp;|&nbsp;&nbsp;Perimetro: ${perimM.toFixed(2)} ml
                </div>
              </div>
              <!-- CAJETÓN DE DATOS -->
              <table class="tbl">
                <tr>
                  <td colspan="6" style="padding:2px 4px;">
                    <span class="lbl">PROYECTO:</span>
                    <div style="border:1.5px solid black;margin:2px 0;padding:2px 0;text-align:center;">
                      <span style="font-size:14px;font-weight:900;letter-spacing:0.5px;">LEVANTAMIENTO TOPOGRÁFICO</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td colspan="4" style="padding:2px 4px;">
                    <span class="lbl">PROPIETARIO:</span>
                    <span style="font-size:9px;display:block;text-align:center;padding-top:2px;">${propiet}</span>
                  </td>
                  <td colspan="2" rowspan="2" style="text-align:center;vertical-align:middle;padding:3px;">
                    <span class="lbl">LAMINA N.°:</span>
                    <span style="font-size:26px;font-weight:900;display:block;line-height:1.1;">${lamina}</span>
                    <span style="font-size:7.5px;display:block;text-align:right;padding-right:3px;">1 DE 1</span>
                  </td>
                </tr>
                <tr>
                  <td colspan="4" style="padding:2px 4px;">
                    <span class="lbl">PLANO:</span>
                    <span style="font-size:14px;font-weight:900;display:block;text-align:center;">PERIMÉTRICO</span>
                  </td>
                </tr>
                <tr>
                  <td><span class="lbl">DATUM:</span><span class="val">WGS84</span></td>
                  <td><span class="lbl">PROYECCIÓN:</span><span class="val">UTM</span></td>
                  <td><span class="lbl">ZONA:</span><span class="val">${zonaTxt}</span></td>
                  <td><span class="lbl">BANDA:</span><span class="val">L</span></td>
                  <td colspan="2"><span class="lbl">ESCALA:</span><span class="val">1:${scaleNum.toLocaleString("es-BO")}</span></td>
                </tr>
                <tr>
                  <td colspan="2"><span class="lbl">DEPARTAMENTO:</span><span class="val">${_geoOrigin ? "GEO-REF" : "LOCAL"}</span></td>
                  <td><span class="lbl">PROVINCIA:</span><span class="val">—</span></td>
                  <td><span class="lbl">MANZANO:</span><span class="val">"${mznLetra}"</span></td>
                  <td colspan="2"><span class="lbl">LOTE N.°:</span><span class="val">${String(loteNum).padStart(2, "0")}</span></td>
                </tr>
                <tr>
                  <td colspan="2"><span class="lbl">URBANIZACION:</span><span class="val">"${urb}"</span></td>
                  <td><span class="lbl">SECTOR:</span><span class="val">"MZO. ${mznLetra}"</span></td>
                  <td><span class="lbl">ÁREA:</span><span class="val">${areaM2.toFixed(2)} m²</span></td>
                  <td colspan="2"><span class="lbl">FECHA:</span><span class="val">${fecha}</span></td>
                </tr>
                <tr>
                  <td colspan="2">
                    <span class="lbl">PROFESIONAL:</span>
                    <span style="font-size:8px;font-weight:900;display:block;text-align:center;line-height:1.5;">${arq}</span>
                  </td>
                  <td colspan="2" style="text-align:center;vertical-align:middle;">
                    <span class="lbl">DISEÑO:</span>
                    <span style="font-size:9px;font-weight:900;font-style:italic;display:block;text-align:center;">LOTES SAI V23.05</span>
                  </td>
                  <td colspan="2">
                    <span class="lbl">PERÍMETRO:</span>
                    <span style="font-size:8px;display:block;text-align:center;line-height:1.4;font-weight:bold;">${perimM.toFixed(2)} ml</span>
                  </td>
                </tr>
              </table>
            </div>
          </div>
        </div>

        <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
        <script>

        function nav(dMzn, dLot) {
          if (window.opener && !window.opener.closed) {
            // Llamar plNavegar en el opener — la ventana se reescribe en sí misma
            window.opener.plNavegar(dMzn, dLot);
          } else {
            document.querySelector('.toolbar').innerHTML +=
              '<span style="color:red;font-size:10px;margin-left:8px;">⚠ Ventana principal cerrada — cerrá y regenerá el plano.</span>';
          }
        }

        function descargarPNG() {
          const btn = document.querySelector('button[onclick="descargarPNG()"]');
          btn.textContent = '⏳ Generating...';
          btn.disabled = true;
          const toolbar = document.querySelector('.toolbar');
          toolbar.style.display = 'none';
          const page = document.querySelector('.page');
          html2canvas(page, {
            scale: 3,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false
          }).then(canvas => {
            toolbar.style.display = '';
            btn.textContent = '⬇ Descargar PNG';
            btn.disabled = false;
            const link = document.createElement('a');
            link.download = 'plano_${urb.replace(/[^a-zA-Z0-9]/g, "_")}_Mzo${mznLetra}_L${loteNum}_${fechaIso}.png';
            link.href = canvas.toDataURL('image/png');
            link.click();
          }).catch(err => {
            toolbar.style.display = '';
            btn.textContent = '⬇ Descargar PNG';
            btn.disabled = false;
            alert('Error al generar PNG: ' + err.message);
          });
        }
        <\/script>
        <\/body>
        <\/html>`;

  if (!_plVentana || _plVentana.closed) {
    _plVentana = window.open(
      "",
      "_blank",
      "width=1320,height=900,scrollbars=yes",
    );
    if (!_plVentana) {
      alert(t("alertPopupBlq"));
      return;
    }
  }
  _plVentana.document.open();
  _plVentana.document.write(htmlPlano);
  _plVentana.document.close();
  _plVentana.focus();
}

function plNavegar(dMzn, dLot) {
  const selMzn = document.getElementById("plMznSel");
  const selLot = document.getElementById("plLoteSel");
  if (!selMzn || !selLot) return;

  if (dMzn !== 0) {
    let idx = selMzn.selectedIndex + dMzn;
    idx = Math.max(0, Math.min(selMzn.options.length - 1, idx));
    selMzn.selectedIndex = idx;
    plPopulateLotes();
    selLot.selectedIndex = 0;
  }

  if (dLot !== 0) {
    let idx = selLot.selectedIndex + dLot;
    idx = Math.max(0, Math.min(selLot.options.length - 1, idx));
    selLot.selectedIndex = idx;
  }

  generarPlanoLote();
}
