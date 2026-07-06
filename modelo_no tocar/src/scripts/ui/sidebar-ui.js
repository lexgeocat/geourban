// =====================================================================
// MÓDULO 11/17 · 11-sidebar-ui.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 03-state.js, 04-history.js, 09-polygon-engine.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [11] SIDEBAR / PANEL LATERAL (manzanos, calles, edición)
// (candidato a módulo: sidebar-ui.js · depende de: [3],[4],[9])
// =====================================================================
function updateSidebar() {
  const lp = document.getElementById("lotsPanel");
  lp.innerHTML = "";
  for (let i = 0; i < manzanos.length; i++) {
    const l = manzanos[i],
      c = MZN_COLORS[l.colorIdx],
      am = polyAreaM2(l.pts);
    const sub = lotSubdivisions.find((s) => s.mznIdx === i);
    const isEquip = !!mznEquipamiento[i];
    const dirVal = document.getElementById("lpDir").value;
    const hasSeg = mznSegments[i] !== undefined;
    const isPickingThis = pickingSegForMzn === i;
    const curMethod = mznMethods[i] || "auto";
    const equipColor = isEquip ? "#e3b341" : "#30363d";
    const equipBg = isEquip ? "#2d2200" : "transparent";
    const equipTxt = isEquip ? "#e3b341" : "#8b949e";
    const equipLabel = isEquip ? t("quitarEquip") : t("marcarEquip");
    const equipHtml = `
      <div style="margin-top:5px;">
        <button onclick="toggleEquipamiento(${i})"
          style="width:100%;padding:3px 0;border-radius:3px;font-size:9px;
            font-family:'Courier New',monospace;cursor:pointer;
            border:1px solid ${equipColor};background:${equipBg};color:${equipTxt};">
          ${equipLabel}
        </button>
      </div>`;

    let equipBadgeHtml = "";
    if (isEquip) {
      const { icon, label } = getEquipamientoInfo(am);
      equipBadgeHtml = `<div class="equip-badge">${icon} ${label}</div>`;
    }

    const methodHtml = isEquip
      ? ""
      : `
      <div style="margin-top:5px;">
        <div style="font-size:9px;color:#8b949e;margin-bottom:2px;">Método de división</div>
        <div style="display:flex;gap:3px;">
          <button onclick="setMznMethod(${i},'auto')"
            style="flex:1;padding:3px 0;border-radius:3px;font-size:9px;font-family:'Courier New',monospace;cursor:pointer;
              border:1px solid ${curMethod === "auto" ? "#58a6ff" : "#30363d"};
              background:${curMethod === "auto" ? "#1f3a5f" : "transparent"};
              color:${curMethod === "auto" ? "#58a6ff" : "#8b949e"};">
            ${t("metodoAuto")}<br><span style="font-size:8px;opacity:.7">${t("metodoAutoSub")}</span>
          </button>
          <button onclick="setMznMethod(${i},'exact')"
            style="flex:1;padding:3px 0;border-radius:3px;font-size:9px;font-family:'Courier New',monospace;cursor:pointer;
              border:1px solid ${curMethod === "exact" ? "#3fb950" : "#30363d"};
              background:${curMethod === "exact" ? "#1a3a1f" : "transparent"};
              color:${curMethod === "exact" ? "#3fb950" : "#8b949e"};">
            ${t("metodoExacto")}<br><span style="font-size:8px;opacity:.7">${t("metodoExactoSub")}</span>
          </button>
        </div>
      </div>`;

    const segBtnHtml =
      !isEquip && dirVal === "seg"
        ? `
      <div style="display:flex;gap:3px;margin-top:5px;align-items:center;">
        <button onclick="startPickSegment(${i})" style="flex:1;padding:3px 0;border-radius:3px;border:1px solid ${isPickingThis ? "#f78166" : hasSeg ? "#3fb950" : "#e3b341"};background:${isPickingThis ? "#3d1f1e" : "transparent"};cursor:pointer;font-size:9px;font-family:'Courier New',monospace;color:${isPickingThis ? "#f78166" : hasSeg ? "#3fb950" : "#e3b341"};">
          ${isPickingThis ? t("clicCanvas") : hasSeg ? t("cambiarEje") : t("definirEje")}
        </button>
        ${hasSeg ? `<button onclick="clearMznSegment(${i})" style="padding:3px 6px;border-radius:3px;border:1px solid #f85149;background:transparent;cursor:pointer;font-size:9px;font-family:'Courier New',monospace;color:#f85149;">✕</button>` : ""}
      </div>`
        : "";

    const allLotsForMzn = [];
    if (!isEquip) {
      if (sub && sub.lots.length > 0) {
        sub.lots.forEach((lt) => allLotsForMzn.push({ ...lt, _type: "auto" }));
      }
      const sliceSubs = sliceLots.filter((sd) => sd.mznIdx === i);
      sliceSubs.forEach((sliceSub, sliceSubIdx) => {
        sliceSub.lots.forEach((lt) =>
          allLotsForMzn.push({ ...lt, _type: "slice" }),
        );
      });
    }

    const sliceSubsForCard = sliceLots.filter((sd) => sd.mznIdx === i);
    let sliceSubBtnsHtml = "";
    if (!isEquip && sliceSubsForCard.length > 0) {
      sliceSubBtnsHtml += `<div style="margin-top:5px;border-top:1px solid #30363d;padding-top:5px;">`;
      sliceSubBtnsHtml += `<div style="font-size:9px;color:#8b949e;margin-bottom:3px;">Sub-manzanos manuales</div>`;
      sliceSubsForCard.forEach((sd, sdIdx) => {
        const subArea = sd.subMznPts
          ? polyAreaM2(sd.subMznPts).toFixed(1)
          : "?";
        const nLotes = sd.lots ? sd.lots.length : 0;
        sliceSubBtnsHtml += `
              <div style="display:flex;align-items:center;justify-content:space-between;
                background:#1c1028;border:1px solid #d2a8ff44;border-radius:3px;
                padding:3px 5px;margin-bottom:3px;">
                <span style="font-size:9px;color:#d2a8ff;">
                  ✂ Sub-Mzo.${sdIdx + 1} · ${subArea}m² · ${nLotes} ${nLotes !== 1 ? t("lotes") : t("lote")}
                </span>
                <button onclick="sliceDeleteSubMzn(${i},${sdIdx})"
                  style="padding:2px 6px;border-radius:3px;border:1px solid #f85149;
                    background:transparent;cursor:pointer;font-size:9px;
                    font-family:'Courier New',monospace;color:#f85149;">
                  ✕ ${t("eliminar")}
                </button>
              </div>`;
      });
      sliceSubBtnsHtml += `</div>`;
    }

    const nNormalAll = allLotsForMzn.filter((lt) => !lt.isRemnant).length;
    const nRemAll = allLotsForMzn.filter((lt) => lt.isRemnant).length;
    const cardBorderColor = isEquip ? "#e3b341" : c;
    let html = `<div class="card mzn" style="border-left-color:${cardBorderColor};${isEquip ? "background:#1c1800;" : ""}">
      <div class="cn"><span class="lc" style="background:${cardBorderColor}"></span>${isEquip ? `${t("equipPrefix")} ${i + 1}` : `${t("mzoPrefix")} ${i + 1}`}</div>
      <div class="ca">${am.toFixed(1)} m²  ·  ${(am / 10000).toFixed(4)} ha</div>
      <div class="cp">${l.pts.length} vértices</div>
      ${equipBadgeHtml}
      ${equipHtml}
      ${methodHtml}
${segBtnHtml}
      ${sliceSubBtnsHtml}`;

    if (!isEquip && allLotsForMzn.length > 0) {
      html += `<div class="cl" onclick="toggleLotList('lotlist-${i}')" style="cursor:pointer;user-select:none;display:flex;justify-content:space-between;align-items:center;">
            <span>${nNormalAll} ${nNormalAll !== 1 ? t("lotes") : t("lote")} · ${nRemAll} ${nRemAll !== 1 ? t("remanentes") : t("remanente")}</span>
            <span id="lotlist-arrow-${i}" style="font-size:9px;color:#8b949e;transition:transform 0.15s;">▶</span>
          </div>`;
      html += `<div class="lot-sub-list" id="lotlist-${i}" style="display:none;max-height:130px;overflow-y:auto;">`;
      allLotsForMzn.forEach((lt, j) => {
        const la = lt.areaM2 !== undefined ? lt.areaM2 : polyAreaM2(lt.pts);
        const typeIndicator = lt._type === "slice" ? " ✂" : "";
        html += `<div class="lot-sub-item${lt.isRemnant ? " rem" : ""}">
          <span class="lname">L${j + 1}${lt.isRemnant ? " ★rem" : ""}${typeIndicator}</span>
          <span class="larea">${la.toFixed(1)} m²</span>
        </div>`;
      });
      html += `</div>`;
    }

    html += `</div>`;
    lp.innerHTML += html;
  }

  const sp = document.getElementById("streetsPanel");
  sp.innerHTML = "";
  for (let i = 0; i < streets.length; i++) {
    const s = streets[i],
      dx = s.end.x - s.start.x,
      dy = s.end.y - s.start.y;
    const lenM = (Math.sqrt(dx * dx + dy * dy) * MPP).toFixed(1),
      sel = s.id === selStreetId;
    sp.innerHTML += `<div class="card${sel ? " sel" : ""}" onclick="selectStreet(${s.id})">
      <div class="cn" style="color:#f78166">${t("calleCard")} ${i + 1}</div>
      <div class="ca" style="color:#f78166">${s.width}m ${t("calleAncho")} · ${lenM}m ${t("calleLargo")}</div>
      <div class="cp">${t("clicEditar")}</div>
    </div>`;
  }

  const totMzn = manzanos.reduce((a, l) => a + polyAreaM2(l.pts), 0);
  const totLots = lotSubdivisions.reduce((a, s) => a + s.lots.length, 0);
  const totSliceLots = sliceLots.reduce((a, s) => a + s.lots.length, 0);
  let info = "";
  if (manzanos.length) info += `${t("totManzanos")} ${totMzn.toFixed(1)} m²`;
  if (totLots) info += `  ·  ${totLots} ${t("totLotesAuto")}`;
  if (totSliceLots) info += `  ·  ${totSliceLots} ${t("totLotesManuales")}`;
  document.getElementById("totalArea").textContent = info;
}

function selectStreet(id) {
  selStreetId = id;
  const s = streets.find((s) => s.id === id);
  if (s) {
    fillPanel(s);
    setMode("edit");
  }
  updateSidebar();
  render();
}

function fillPanel(s) {
  const i = streets.indexOf(s) + 1;
  document.getElementById("epTitle").textContent = `${t("calleCard")} ${i}`;
  const sm = ptWM(s.start),
    em = ptWM(s.end);
  document.getElementById("epSX").value = sm.x.toFixed(2);
  document.getElementById("epSY").value = sm.y.toFixed(2);
  document.getElementById("epEX").value = em.x.toFixed(2);
  document.getElementById("epEY").value = em.y.toFixed(2);
  document.getElementById("epW").value = s.width;
  const dx = s.end.x - s.start.x,
    dy = s.end.y - s.start.y;
  document.getElementById("epLen").value = (
    Math.sqrt(dx * dx + dy * dy) * MPP
  ).toFixed(2);
  document.getElementById("editPanel").style.display = "block";
  // Devolver foco al canvas para que los atajos de teclado sigan funcionando
  setTimeout(() => {
    const cv = document.getElementById("mainCanvas");
    if (cv) cv.focus();
  }, 0);
}
function closePanel() {
  document.getElementById("editPanel").style.display = "none";
}
function closeEditPanel() {
  closePanel();
}
function applyEditPanel() {
  const s = streets.find((s) => s.id === selStreetId);
  if (!s) return;
  _snapshot();
  const sx = parseFloat(document.getElementById("epSX").value) || 0;
  const sy = parseFloat(document.getElementById("epSY").value) || 0;
  const ex = parseFloat(document.getElementById("epEX").value) || 0;
  const ey = parseFloat(document.getElementById("epEY").value) || 0;
  const w = Math.max(
    1,
    parseFloat(document.getElementById("epW").value) || s.width,
  );
  const lenInput = parseFloat(document.getElementById("epLen").value);
  const origDx = s.end.x - s.start.x,
    origDy = s.end.y - s.start.y;
  const origLen = Math.sqrt(origDx * origDx + origDy * origDy) || 1;
  const origUx = origDx / origLen,
    origUy = origDy / origLen;
  s.start = ptMW({ x: sx, y: sy });
  s.width = w;
  if (!isNaN(lenInput) && lenInput > 0) {
    const newLenW = mw(lenInput);
    s.end = {
      x: s.start.x + origUx * newLenW,
      y: s.start.y + origUy * newLenW,
    };
  } else {
    s.end = ptMW({ x: ex, y: ey });
  }
  fillPanel(s);
  recomputeManzanos();
  updateSidebar();
  render();
}

function deleteSelectedStreet() {
  if (!selStreetId) return;
  if (!confirm(t("eliminarCalle"))) return;
  _snapshot();
  streets = streets.filter((s) => s.id !== selStreetId);
  selStreetId = null;
  closePanel();
  recomputeManzanos();
  updateSidebar();
  render();
}

