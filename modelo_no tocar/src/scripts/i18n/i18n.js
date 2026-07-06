// =====================================================================
// MÓDULO 02/17 · 02-i18n.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 01-translations.js (TRANSLATIONS)
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [2] i18n — HELPERS DE TRADUCCIÓN Y APLICACIÓN AL DOM
// (candidato a módulo: i18n.js · depende de: TRANSLATIONS, _setTxt)
// =====================================================================
/** Función principal de traducción */
function t(key, ...args) {
  const val = TRANSLATIONS[key];
  if (val === undefined) return key;
  return typeof val === "function" ? val(...args) : val;
}

/** Aplica el idioma al DOM estático (llamar al cargar y al cambiar idioma) */
function applyLang() {
  // Botones del toolbar — modos de dibujo
  _setTxt("btnPolygon", t("btnParcela"));
  _setTxt("btnStreet", t("btnTrazarCalle"));
  _setTxt("btnEdit", t("btnEditarCalles"));
  _setTxt("btnSlice", t("btnSubdivision"));

  // Toolbar — botones sin SVG (Guardar, Cargar, Calc, Nuevo, Parcela, Exportar DXF, Vista Previa, Importar)
  document.querySelectorAll(".btn.green").forEach((btn) => {
    if (
      btn.getAttribute("onclick") &&
      btn.getAttribute("onclick").includes("saveProject")
    ) {
      const svg = btn.querySelector("svg");
      btn.innerHTML = "";
      if (svg) btn.appendChild(svg.cloneNode(true));
      btn.appendChild(document.createTextNode(" " + t("btnGuardar")));
    }
    if (
      btn.getAttribute("onclick") &&
      btn.getAttribute("onclick").includes("triggerLoadProject")
    ) {
      const svg = btn.querySelector("svg");
      btn.innerHTML = "";
      if (svg) btn.appendChild(svg.cloneNode(true));
      btn.appendChild(document.createTextNode(" " + t("btnCargar")));
    }
    if (
      btn.getAttribute("onclick") &&
      btn.getAttribute("onclick").includes("exportDXF")
    ) {
      const svg = btn.querySelector("svg");
      btn.innerHTML = "";
      if (svg) btn.appendChild(svg.cloneNode(true));
      btn.appendChild(document.createTextNode(" " + t("btnExportarDXF")));
    }
  });
  document.querySelectorAll(".btn.cyan").forEach((btn) => {
    if (
      btn.getAttribute("onclick") &&
      btn.getAttribute("onclick").includes("toggleCalc")
    ) {
      const svg = btn.querySelector("svg");
      btn.innerHTML = "";
      if (svg) btn.appendChild(svg.cloneNode(true));
      btn.appendChild(document.createTextNode(" " + t("btnCalc")));
    }
  });
  document.querySelectorAll(".btn.red").forEach((btn) => {
    const svg = btn.querySelector("svg");
    btn.innerHTML = "";
    if (svg) btn.appendChild(svg.cloneNode(true));
    // Nota: se simplificó un ternario que por precedencia de operadores
    // (" " + t(x)) === t(x)) siempre evaluaba a false; el botón "Parcela"
    // (deleteParcela) se corrige más abajo en su propio bloque dedicado.
    btn.appendChild(document.createTextNode(" " + t("btnNuevo")));
  });
  // Botón Nuevo (resetAll)
  document.querySelectorAll(".btn.blue").forEach((btn) => {
    const oc = btn.getAttribute("onclick") || "";
    if (oc.includes("resetAll")) {
      const svg = btn.querySelector("svg");
      btn.innerHTML = "";
      if (svg) btn.appendChild(svg.cloneNode(true));
      btn.appendChild(document.createTextNode(" " + t("btnNuevo")));
    }
    if (oc.includes("toggleImportMenu")) {
      const svgs = btn.querySelectorAll("svg");
      btn.innerHTML = "";
      svgs.forEach((s) => btn.appendChild(s.cloneNode(true)));
      // reinserta texto entre los dos SVG
      btn.childNodes[0].after(
        document.createTextNode(" " + t("btnImportar") + " "),
      );
    }
    if (oc.includes("toggleVistaPreviaMenu")) {
      const svgs = btn.querySelectorAll("svg");
      btn.innerHTML = "";
      svgs.forEach((s) => btn.appendChild(s.cloneNode(true)));
      btn.childNodes[0].after(
        document.createTextNode(" " + t("btnVistaPrevia") + " "),
      );
    }
  });
  // Botón Parcela (deleteParcela) — clase btn red
  document.querySelectorAll(".btn.red").forEach((btn) => {
    const oc = btn.getAttribute("onclick") || "";
    if (oc.includes("deleteParcela")) {
      const svg = btn.querySelector("svg");
      btn.innerHTML = "";
      if (svg) btn.appendChild(svg.cloneNode(true));
      btn.appendChild(document.createTextNode(" " + t("btnParcela")));
    }
  });

  // Toolbar — label "Calle:"
  document.querySelectorAll(".sc > span").forEach((span) => {
    if (
      span.textContent.trim() === "Calle:" ||
      span.textContent.trim() === "Street:" ||
      span.textContent.trim() === "Rua:"
    ) {
      span.textContent = t("labelCalle");
    }
  });

  // Menú Importar (dropdown)
  const importMenuBtns = document.querySelectorAll("#importMenu button");
  if (importMenuBtns.length >= 3) {
    // DXF
    const svgDXF = importMenuBtns[0].querySelector("svg");
    importMenuBtns[0].innerHTML = "";
    if (svgDXF) importMenuBtns[0].appendChild(svgDXF.cloneNode(true));
    importMenuBtns[0].appendChild(document.createTextNode(" " + t("impDXF")));
    // KMZ/KML
    const svgKMZ = importMenuBtns[1].querySelector("svg");
    importMenuBtns[1].innerHTML = "";
    if (svgKMZ) importMenuBtns[1].appendChild(svgKMZ.cloneNode(true));
    importMenuBtns[1].appendChild(document.createTextNode(" " + t("impKMZ")));
    // Ortofoto
    const svgOrto = importMenuBtns[2].querySelector("svg");
    importMenuBtns[2].innerHTML = "";
    if (svgOrto) importMenuBtns[2].appendChild(svgOrto.cloneNode(true));
    importMenuBtns[2].appendChild(
      document.createTextNode(" " + t("impOrtofoto")),
    );
  }

  // Menú Vista Previa (dropdown)
  const vpBtns = document.querySelectorAll("#vistaPreviaMenu button");
  if (vpBtns.length >= 2) {
    const svgVP1 = vpBtns[0].querySelector("svg");
    vpBtns[0].innerHTML = "";
    if (svgVP1) vpBtns[0].appendChild(svgVP1.cloneNode(true));
    vpBtns[0].appendChild(document.createTextNode(" " + t("vpPlanoGeneral")));

    const svgVP2 = vpBtns[1].querySelector("svg");
    vpBtns[1].innerHTML = "";
    if (svgVP2) vpBtns[1].appendChild(svgVP2.cloneNode(true));
    vpBtns[1].appendChild(document.createTextNode(" " + t("vpPlanoPorLote")));
  }

  // Sidebar — instrucción
  _setTxt(
    "instrBox",
    `<div class="s">${t("instrP1")}</div><div class="s" style="color:#8b949e">${t("instrP1b")}</div>`,
  );

  // Sidebar — encabezados h3 (Manzanos / Calles)
  document.querySelectorAll(".sidebar h3").forEach((el, i) => {
    el.textContent = i === 0 ? t("h3Manzanos") : t("h3Calles");
  });

  // Sidebar — enlace YouTube
  const ytLink = document.querySelector('.sidebar a[href*="youtube"]');
  if (ytLink) {
    const svg = ytLink.querySelector("svg");
    ytLink.innerHTML = "";
    if (svg) ytLink.appendChild(svg.cloneNode(true));
    ytLink.appendChild(document.createTextNode(" " + t("tutorialYT")));
  }

  // Sidebar — Parámetros de Lotes
  const lpTitleEl = document.querySelector(".lp-title");
  if (lpTitleEl) lpTitleEl.textContent = t("lpTitle");
  const lpLabels = document.querySelectorAll(".lot-params label");
  if (lpLabels.length >= 3) {
    lpLabels[0].textContent = t("lpAreaLabel");
    lpLabels[1].textContent = t("lpFrenteLabel");
    lpLabels[2].textContent = t("lpDirLabel");
  }
  const lpDirSel = document.querySelector("#lpDir");
  if (lpDirSel && lpDirSel.options.length >= 2) {
    lpDirSel.options[0].textContent = t("lpDirAuto");
    lpDirSel.options[1].textContent = t("lpDirSeg");
  }
  const segHintEl = document.getElementById("segHint");
  if (segHintEl) segHintEl.textContent = t("segHintTxt");
  const segInfoEl = document.getElementById("segInfo");
  if (segInfoEl) segInfoEl.textContent = t("segInfoTxt");

  // Sidebar — botones Generar Lotes y Limpiar dentro de .lp-actions
  const lpActionBtns = document.querySelectorAll(".lp-actions button");
  if (lpActionBtns.length >= 2) {
    lpActionBtns[0].textContent = t("btnGenerarLotes");
    lpActionBtns[1].textContent = t("btnLimpiarLotes");
  }

  // Canvas — botón flotante "Generar Lotes"
  document.querySelectorAll("#canvasQuickPanel button").forEach((btn) => {
    const oc = btn.getAttribute("onclick") || "";
    if (oc.includes("applyLots") && !oc.includes("clearSlice")) {
      btn.textContent = t("btnGenerarLotes");
    }
    if (oc.includes("closePolygon")) {
      btn.textContent =
        "▲ " +
        (t("instrP1b").includes("Cerrar")
          ? "Cerrar Parcela"
          : t("instrP1b").includes("Close")
            ? "Close Parcel"
            : "Fechar Parcela");
    }
    if (oc.includes("undoAction")) {
      // se maneja desde JS ya, no tocar
    }
  });
  // Botón flotante "Deshacer/Undo/Desfazer"
  const btnUndo = document.getElementById("btnUndo");
  if (btnUndo) {
    btnUndo.textContent = "↺ Deshacer";
  }

  // Canvas — menú Vista (Lotes, Grilla, Satélite, Guías DXF, Ortofoto)
  const vistaMenuLabels = document.querySelectorAll("#vistaMenu label");
  const vistaTexts = ["Lotes", "Grilla", "Satélite", "Guías DXF", "Ortofoto"];
  vistaMenuLabels.forEach((lbl, i) => {
    const chk = lbl.querySelector("input");
    const sq = lbl.querySelector("span");
    if (chk && sq && vistaTexts[i]) {
      lbl.innerHTML = "";
      lbl.appendChild(chk.cloneNode(true));
      lbl.appendChild(sq.cloneNode(true));
      lbl.appendChild(document.createTextNode(" " + vistaTexts[i]));
      // Restaurar onchange del checkbox
      const newChk = lbl.querySelector("input");
      if (newChk) newChk.onchange = chk.onchange;
    }
  });
  // Botón "Vista ▼"
  const btnVista = document.getElementById("btnVista");
  if (btnVista) {
    btnVista.innerHTML = `▶ Vista &#9660;`;
  }

  // Panel subdivisión manual (slicePanel) — títulos y labels
  const sliceTitleEl = document.querySelector(
    '#slicePanel > div[style*="d2a8ff"]',
  );
  if (sliceTitleEl && !sliceTitleEl.id)
    sliceTitleEl.textContent = t("sliceTitle");

  // slicePhaseA labels
  const slicePhaseA = document.getElementById("slicePhaseA");
  if (slicePhaseA) {
    const divs = slicePhaseA.querySelectorAll('div[style*="8b949e"]');
    if (divs[0]) divs[0].textContent = t("sliceMznBase");
    if (divs[1]) divs[1].textContent = t("sliceAreaSub");
    const btn1 = slicePhaseA.querySelector("button");
    if (btn1) btn1.textContent = t("sliceBtnPaso1");
  }

  // slicePhaseB
  const slicePhaseB = document.getElementById("slicePhaseB");
  if (slicePhaseB) {
    const hint = slicePhaseB.querySelector('div[style*="d2a8ff"]');
    if (hint) hint.textContent = t("sliceHintFrente");
    const btn = slicePhaseB.querySelector("button");
    if (btn) btn.textContent = t("sliceBtnCancelar");
  }

  // slicePhaseC
  const slicePhaseC = document.getElementById("slicePhaseC");
  if (slicePhaseC) {
    const hintAux = document.getElementById("slicePhaseCHintAux");
    if (hintAux) hintAux.textContent = t("sliceHintLateral");
    const hintLine = document.getElementById("slicePhaseCHintLine");
    if (hintLine) {
      const stepTxt = document.getElementById("sliceCutLineStepTxt");
      if (stepTxt) stepTxt.textContent = t("sliceHintLinea");
      const noteSpan = hintLine.querySelector('span[style*="8b949e"]');
      if (noteSpan) noteSpan.textContent = t("sliceSnapNote");
    }
    const btnLine = document.getElementById("btnSliceCutLine");
    if (btnLine) btnLine.textContent = t("sliceBtnLinea");
    const btnCancelC = slicePhaseC.querySelectorAll("button")[1];
    if (btnCancelC) btnCancelC.textContent = t("sliceBtnCancelar");
  }

  // slicePhaseD
  const slicePhaseD = document.getElementById("slicePhaseD");
  if (slicePhaseD) {
    const paso2Lbl = slicePhaseD.querySelector('div[style*="d2a8ff"]');
    if (paso2Lbl) paso2Lbl.textContent = t("slicePaso2Lbl");
    const segHintD = document.getElementById("sliceSegHint");
    if (segHintD) segHintD.textContent = t("sliceSegHintTxt");
    const segInfoD = document.getElementById("sliceSegInfo");
    if (segInfoD) segInfoD.textContent = t("sliceSegInfoTxt");
    const modeLabel = slicePhaseD.querySelector('div[style*="color:#8b949e"]');
    if (modeLabel) modeLabel.textContent = t("sliceModeLbl");
    const sliceModeSel = document.getElementById("sliceMode");
    if (sliceModeSel && sliceModeSel.options.length >= 2) {
      sliceModeSel.options[0].textContent = t("sliceModeEqual");
      sliceModeSel.options[1].textContent = t("sliceModeCustom");
    }
    const nGroupDivs = document.querySelector("#sliceNGroup div");
    if (nGroupDivs) nGroupDivs.textContent = t("sliceNLbl");
    const areasGroupDivs = document.querySelector("#sliceAreasGroup div");
    if (areasGroupDivs) areasGroupDivs.textContent = t("sliceAreasLbl");
    const sliceAreasInput = document.getElementById("sliceAreas");
    if (sliceAreasInput) sliceAreasInput.placeholder = t("sliceAreasPlh");
    const frenteDivs = slicePhaseD.querySelectorAll('div[style*="8b949e"]');
    // el último div con color 8b949e antes del input sliceFrente
    frenteDivs.forEach((d) => {
      if (
        d.textContent.includes("rente") ||
        d.textContent.includes("ront") ||
        d.textContent.includes("estada")
      )
        d.textContent = t("sliceFrenteLbl");
    });

    const sliceBtns = slicePhaseD.querySelectorAll('div[style*="flex"] button');
    if (sliceBtns[0]) sliceBtns[0].textContent = t("sliceBtnDefinirDir");
    if (sliceBtns[1]) sliceBtns[1].textContent = t("sliceBtnEjecutar");
    const btnNuevoSub = slicePhaseD.querySelector(
      'button[onclick*="sliceNewSubManzano"]',
    );
    if (btnNuevoSub) btnNuevoSub.textContent = t("sliceBtnNuevoSub");
  }

  // Edit Panel labels
  const epLabels = document.querySelectorAll("#editPanel label");
  if (epLabels.length >= 4) {
    epLabels[0].textContent = t("epInicioXY");
    epLabels[1].textContent = t("epFinXY");
    epLabels[2].textContent = t("epLongitud");
    epLabels[3].textContent = t("epAncho");
  }
  const epLen = document.getElementById("epLen");
  if (epLen) epLen.placeholder = t("epPlhLongitud");
  const epW = document.getElementById("epW");
  if (epW) epW.placeholder = t("epPlhAncho");
  // Edit Panel botones
  const epBtns = document.querySelectorAll(".ep-actions button");
  if (epBtns.length >= 3) {
    epBtns[0].textContent = t("epBtnAplicar");
    epBtns[1].textContent = t("epBtnCerrar");
    epBtns[2].textContent = t("epBtnBorrar");
  }

  // Stats panel header
  const spTitleEl = document.querySelector(".sp-title");
  if (spTitleEl) spTitleEl.textContent = t("spTitle");
  const ths = document.querySelectorAll("#statsPanel thead th");
  if (ths.length >= 4) {
    ths[0].textContent = t("thDesc");
    ths[1].textContent = t("thCant");
    ths[2].textContent = t("thArea");
    ths[3].textContent = t("thPct");
  }

  // Modal Importar DXF
  const imTitleEl = document.querySelector("#importModalBox h2");
  if (imTitleEl) imTitleEl.textContent = t("imTitle");
  const imDropSpan = document.querySelector("#imDrop");
  if (imDropSpan) {
    const icon = imDropSpan.querySelector(".im-icon");
    imDropSpan.innerHTML =
      (icon ? icon.outerHTML : "") +
      t("imDropTxt") +
      '<br><span style="font-size:9px;color:#484f58">LWPOLYLINE · POLYLINE · LINE · ARC · CIRCLE · SPLINE</span>';
  }
  const imUtmZonaLbl = document.querySelector(
    '#importModalBox [style*="Zona UTM"], #importModalBox div[style*="9px"]',
  );
  document
    .querySelectorAll('#importModalBox div[style*="9px"]')
    .forEach((d) => {
      if (
        d.textContent.trim() === "Zona UTM" ||
        d.textContent.trim() === "UTM Zone" ||
        d.textContent.trim() === "Zona UTM"
      )
        d.textContent = t("imUtmZonaLbl");
      if (
        d.textContent.trim() === "Hemisferio" ||
        d.textContent.trim() === "Hemisphere"
      )
        d.textContent = t("imHemisferioLbl");
    });
  const imHemiSel = document.getElementById("imUtmHemi");
  if (imHemiSel && imHemiSel.options.length >= 2) {
    imHemiSel.options[0].textContent = t("imHemiSur");
    imHemiSel.options[1].textContent = t("imHemiNorte");
  }
  const imNoteEl = document.querySelector(".im-note");
  if (imNoteEl) imNoteEl.innerHTML = t("imNotaTxt");
  const imBtnImport = document.getElementById("imBtnImport");
  if (imBtnImport) imBtnImport.textContent = t("imBtnImportar");
  const imBtnCancel = document.querySelector(".im-actions .cancel");
  if (imBtnCancel) imBtnCancel.textContent = t("imBtnCancelar");

  // Modal KMZ — textos hardcodeados
  const kmzDropDiv = document.getElementById("kmzDrop");
  if (kmzDropDiv) {
    const globo = kmzDropDiv.querySelector('span[style*="26px"]');
    kmzDropDiv.innerHTML =
      (globo
        ? globo.outerHTML
        : '<span style="font-size:26px;display:block;margin-bottom:6px;">🌎</span>') +
      "Clic aquí o arrastrá un archivo <b>.KMZ</b> o <b>.KML</b>" +
      '<br><span style="font-size:9px;color:#484f58;">Google Earth · Google Maps · GPS dispositivos</span>';
  }
  const kmzBtnImport = document.getElementById("kmzBtnImport");
  if (kmzBtnImport) kmzBtnImport.textContent = t("imBtnImportar");
  const kmzBtnCancel =
    kmzBtnImport && kmzBtnImport.parentElement
      ? kmzBtnImport.parentElement.querySelector("button:last-child")
      : null;
  if (kmzBtnCancel) kmzBtnCancel.textContent = t("imBtnCancelar");

  // Modal Ortofoto KMZ — textos hardcodeados
  const orthoDropDiv = document.getElementById("orthoKmzDrop");
  if (orthoDropDiv) {
    const mapa = orthoDropDiv.querySelector('span[style*="26px"]');
    orthoDropDiv.innerHTML =
      (mapa
        ? mapa.outerHTML
        : '<span style="font-size:26px;display:block;margin-bottom:6px;">🗺️</span>') +
      "Clic aquí o arrastrá un archivo <b>.KMZ</b>" +
      '<br><span style="font-size:9px;color:#484f58;">' +
      "Ortofoto georeferenciada con GroundOverlay" +
      "</span>";
  }
  const orthoOpacityLabel = document.querySelector(
    '#orthoKmzModal span[style*="color:#8b949e"]',
  );
  if (orthoOpacityLabel) orthoOpacityLabel.textContent = "Opacidad:";
  const orthoLoadBtn = document.getElementById("orthoKmzBtnLoad");
  if (orthoLoadBtn) orthoLoadBtn.textContent = "🛰️ Cargar Ortofoto";
  const orthoKmzCancelBtn =
    orthoLoadBtn && orthoLoadBtn.parentElement
      ? orthoLoadBtn.parentElement.querySelector("button:last-child")
      : null;
  if (orthoKmzCancelBtn) orthoKmzCancelBtn.textContent = t("imBtnCancelar");
  const orthoRemoveBtn = document.querySelector(
    '#orthoKmzModal button[onclick*="removeOrthoLayer"]',
  );
  if (orthoRemoveBtn) orthoRemoveBtn.textContent = "🗑 Quitar ortofoto actual";

  // Modal Plano por Lote
  const plModalTitle = document.querySelector(
    '#modalPlanoLote span[style*="d2a8ff"]',
  );
  if (plModalTitle) plModalTitle.textContent = t("plTitulo");
  const plCloseBtn = document.querySelector(
    '#modalPlanoLote button[onclick*="cerrarModalPlanoLote"]',
  );
  if (plCloseBtn) plCloseBtn.textContent = t("plBtnCerrar");
  const plLabels = document.querySelectorAll(
    '#modalPlanoLote div[style*="8b949e"]',
  );
  const plLabelMap = [
    t("plManzanoLbl"),
    t("plLoteLbl"),
    t("plPropietarioLbl"),
    t("plArqLbl"),
    t("plUrbLbl"),
    t("plLaminaLbl"),
  ];
  plLabels.forEach((lbl, i) => {
    if (plLabelMap[i]) lbl.textContent = plLabelMap[i];
  });
  const plAbrirBtn = document.querySelector(
    '#modalPlanoLote button[onclick*="generarPlanoLote"]',
  );
  if (plAbrirBtn) plAbrirBtn.textContent = t("plBtnAbrir");

  // Modal Plano de Impresión (printModal)
  const printModalTitle = document.querySelector(
    '#printModal span[style*="79c0ff"][style*="font-size:13px"]',
  );
  if (printModalTitle) printModalTitle.textContent = "⊟ PLANO DE IMPRESIÓN";
  document.querySelectorAll("#printModal button").forEach((btn) => {
    const oc = btn.getAttribute("onclick") || "";
    if (oc.includes("downloadPlanoPDF")) btn.textContent = "↓ Descargar PDF";
    if (oc.includes("_downloadPlanoPNG")) btn.textContent = "↓ Descargar PNG";
    if (oc.includes("closePrintModal")) btn.textContent = t("plBtnCerrar");
    if (oc.includes("regeneratePlan")) btn.textContent = "▶ Regenerar";
  });
  document.querySelectorAll('#printModal div[style*="8b949e"]').forEach((d) => {
    if (d.textContent.trim() === "Título:") d.textContent = "Título:";
    if (d.textContent.trim() === "Propietario:")
      d.textContent = "Propietario:";
    if (d.textContent.trim() === "Arq.:") d.textContent = t("plArqLbl");
  });

  // Calculadora — título
  const calcHeaderSpan = document.querySelector("#calcHeader span");
  if (calcHeaderSpan) calcHeaderSpan.textContent = t("calcTitulo");

  // Idioma del html
  document.documentElement.lang = "es";
}

function _setTxt(id, html) {
  const el = document.getElementById(id);
  if (!el) return;
  const svg = el.querySelector("svg");
  if (svg) {
    // Guardar el SVG, limpiar, reponer SVG + texto nuevo
    const svgClone = svg.cloneNode(true);
    el.innerHTML = "";
    el.appendChild(svgClone);
    el.appendChild(document.createTextNode(" " + html));
  } else {
    el.innerHTML = html;
  }
}

