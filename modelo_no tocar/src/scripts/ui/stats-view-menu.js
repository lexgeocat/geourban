// =====================================================================
// MÓDULO 16/17 · 16-stats-view-menu.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 03-state.js, 09-polygon-engine.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [16] ESTADÍSTICAS Y MENÚS DE VISTA
// (candidato a módulo: stats-view-menu.js · depende de: [3],[9])
// =====================================================================
function getEquipamientoInfo(areaM2) {
  if (areaM2 < 200) {
    return { icon: "🌿", label: "Área Verde / Jardín", type: "jardin" };
  } else if (areaM2 < 600) {
    return { icon: "⚽", label: "Cancha Deportiva", type: "cancha" };
  } else if (areaM2 < 1500) {
    return { icon: "🌳", label: "Parque Vecinal", type: "parque" };
  } else if (areaM2 < 4000) {
    return { icon: "🏫", label: "Unidad Educativa", type: "educativo" };
  } else if (areaM2 < 10000) {
    return {
      icon: "🏥",
      label: "Centro de Salud / Equipamiento Urbano",
      type: "salud",
    };
  } else {
    return {
      icon: "🏛️",
      label: "Equipamiento Institucional Mayor",
      type: "institucional",
    };
  }
}

function toggleEquipamiento(mznIdx) {
  _snapshot();
  if (mznEquipamiento[mznIdx]) {
    delete mznEquipamiento[mznIdx];
  } else {
    mznEquipamiento[mznIdx] = true;
    const sub = lotSubdivisions.find((s) => s.mznIdx === mznIdx);
    if (sub) sub.lots = [];
    sliceLots = sliceLots.filter((sd) => sd.mznIdx !== mznIdx);
  }
  updateSidebar();
  updateStatsPanel();
  render();
}

function updateStatsPanel() {
  const body = document.getElementById("statsBody");
  if (!body) return;
  if (!polyClosed || polyPts.length < 3) {
    body.innerHTML = `<tr><td colspan="4" style="color:#8b949e;text-align:center;padding:4px 0;">${t("dibujaParcela")}</td></tr>`;
    document.getElementById("sbLots").style.width = "0%";
    document.getElementById("sbMzn").style.width = "0%";
    document.getElementById("sbVia").style.width = "0%";
    return;
  }

  const parcelaTotal = polyAreaM2(polyPts);
  let viaArea = 0;
  for (const s of streets) {
    const rect = streetRect(s);
    if (!rect) continue;
    const clipped = clipPolyToManzano(rect, polyPts);
    if (clipped && clipped.length >= 3) viaArea += polyAreaM2(clipped);
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
    const mznIdx = sub.mznIdx;
    if (mznEquipamiento[mznIdx]) continue;
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
  function fmtP(n) {
    return n.toFixed(2) + " %";
  }
  let html = "";
  if (lotCount > 0) {
    html += `<tr class="sp-lots">
          <td>${t("statLotes")}</td>
          <td>${lotCount}</td>
          <td>${fmt(lotArea)}</td>
          <td>${fmtP(pctLots)}</td>
        </tr>`;
  }

  if (mznCount > 0) {
    html += `<tr class="sp-mzn">
          <td>${t("statManzanos")}</td>
          <td>${mznCount}</td>
          <td>${fmt(mznArea)}</td>
          <td>${fmtP(pctMzn)}</td>
        </tr>`;
  }

  if (equipCount > 0) {
    html += `<tr class="sp-equip">
          <td>${t("statEquip")}</td>
          <td>${equipCount}</td>
          <td>${fmt(equipArea)}</td>
          <td>${fmtP(pctEquip)}</td>
        </tr>`;
  }

  if (nCalles > 0) {
    html += `<tr class="sp-via">
          <td>${t("statVias")}</td>
          <td>${nCalles}</td>
          <td>${fmt(viaArea)}</td>
          <td>${fmtP(pctVia)}</td>
        </tr>`;
  }

  html += `<tr class="sp-total">
        <td>${t("statParcela")}</td>
        <td>—</td>
        <td>${fmt(parcelaTotal)}</td>
        <td>100.00 %</td>
      </tr>`;
  body.innerHTML = html;
  const mznSinLotes = Math.max(0, pctMzn - pctLots);
  document.getElementById("sbLots").style.width = pctLots.toFixed(2) + "%";
  document.getElementById("sbMzn").style.width = mznSinLotes.toFixed(2) + "%";
  document.getElementById("sbVia").style.width = pctVia.toFixed(2) + "%";
}

//=============================================================================================

function zoomToFitPoly(pts) {
  if (!pts || pts.length === 0) return;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const W = canvas.width,
    H = canvas.height;
  const pw = maxX - minX || 1,
    ph = maxY - minY || 1;
  zoom = Math.min((W * 0.8) / pw, (H * 0.8) / ph);
  zoom = Math.max(0.04, Math.min(100, zoom));
  pan.x = W / 2 - ((minX + maxX) / 2) * zoom;
  pan.y = H / 2 - ((minY + maxY) / 2) * zoom;
  render();
}

//=============================================================================================

//=============================================================================================

function centerOnDrawing() {
  const pts = polyClosed ? polyPts : polyPts;
  if (!pts || pts.length === 0) {
    document.getElementById("hintLabel").textContent = t("hintCentrar");
    setTimeout(() => {
      document.getElementById("hintLabel").textContent = "";
    }, 2000);
    return;
  }
  zoomToFitPoly(pts);
  if (_satVisible && _geoOrigin && _satMap) {
    setTimeout(() => {
      _satMap.invalidateSize();
      _alignLeafletToCanvas();
    }, 80);
  }
}
function toggleVistaMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById("vistaMenu");
  const isOpen = menu.style.display === "block";
  menu.style.display = isOpen ? "none" : "block";
  if (!isOpen) {
    setTimeout(() => {
      document.addEventListener("click", _closeVistaMenuOnce);
    }, 0);
  }
}

function _closeVistaMenuOnce() {
  const menu = document.getElementById("vistaMenu");
  if (menu) menu.style.display = "none";
  document.removeEventListener("click", _closeVistaMenuOnce);
}

function toggleVistaPreviaMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById("vistaPreviaMenu");
  const isOpen = menu.style.display === "block";
  menu.style.display = isOpen ? "none" : "block";
  if (!isOpen) {
    setTimeout(() => {
      document.addEventListener("click", _closeVistaPreviaMenuOnce);
    }, 0);
  }
}

function _closeVistaPreviaMenuOnce() {
  closeVistaPreviaMenu();
  document.removeEventListener("click", _closeVistaPreviaMenuOnce);
}

function closeVistaPreviaMenu() {
  const menu = document.getElementById("vistaPreviaMenu");
  if (menu) menu.style.display = "none";
}

let _plVentana = null;
