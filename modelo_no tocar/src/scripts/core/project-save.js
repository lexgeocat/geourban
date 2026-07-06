//===================INICIO GUARDAR PROYECTO===================================================
const PROJECT_VERSION = 2;

function saveProject() {
  _saveProjectInternal();
}

function _saveProjectInternal() {
  if (!polyClosed && polyPts.length === 0) {
    alert("No hay proyecto para guardar. Dibujá una parcela primero.");
    return;
  }

  const uiState = {
    lpArea: document.getElementById("lpArea").value,
    lpFront: document.getElementById("lpFront").value,
    lpDir: document.getElementById("lpDir").value,
    swVal: swVal,
    showLots: showLots,
    pan: { x: pan.x, y: pan.y },
    zoom: zoom,
  };

  const project = {
    _version: PROJECT_VERSION,
    _savedAt: new Date().toISOString(),
    _appName: "Lotes Sai",
    polyPts: polyPts.map((p) => ({ x: p.x, y: p.y })),
    polyClosed: polyClosed,
    streets: JSON.parse(JSON.stringify(streets)),
    streetIdCtr: streetIdCtr,
    manzanos: JSON.parse(JSON.stringify(manzanos)),
    mznSegments: JSON.parse(JSON.stringify(mznSegments)),
    mznMethods: JSON.parse(JSON.stringify(mznMethods)),
    mznEquipamiento: JSON.parse(JSON.stringify(mznEquipamiento)),
    lotSubdivisions: JSON.parse(JSON.stringify(lotSubdivisions)),
    sliceLots: JSON.parse(JSON.stringify(sliceLots)),
    geoOrigin: _geoOrigin ? JSON.parse(JSON.stringify(_geoOrigin)) : null,
    uiState: uiState,
  };

  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  const fecha = new Date().toISOString().slice(0, 10);
  a.href = URL.createObjectURL(blob);
  a.download = `proyecto_lotes_${fecha}.lsai`;
  a.click();
  URL.revokeObjectURL(a.href);
  document.getElementById("hintLabel").textContent =
    "✓ Proyecto guardado correctamente";
  setTimeout(() => {
    document.getElementById("hintLabel").textContent = "";
  }, 3000);
}

function triggerLoadProject() {
  document.getElementById("projectFileInput").click();
}

function handleProjectFileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".lsai")) {
    alert("El archivo debe tener extensión .lsai");
    input.value = "";
    return;
  }

  if (polyClosed || polyPts.length > 0) {
    if (!confirm("Cargar un proyecto reemplazará el trabajo actual. ¿Continuar?")) {
      input.value = "";
      return;
    }
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      loadProjectData(data);
    } catch (err) {
      alert("Error al leer el archivo: " + err.message);
      console.error(err);
    }
  };
  reader.onerror = () => alert("No se pudo leer el archivo.");
  reader.readAsText(file);
  input.value = "";
}

function loadProjectData(data) {
  if (!data || data._appName !== "Lotes Sai") {
    alert("El archivo no es un proyecto válido de Lotes Sai.");
    return;
  }
  if (!data.polyPts || data.polyPts.length < 3) {
    alert("El proyecto no contiene una parcela válida.");
    return;
  }

  _history = [];
  _historyPaused = true;
  polyPts = data.polyPts.map((p) => ({ x: p.x, y: p.y }));
  polyClosed = !!data.polyClosed;
  streets = JSON.parse(JSON.stringify(data.streets || []));
  streetIdCtr = data.streetIdCtr || 0;
  manzanos = JSON.parse(JSON.stringify(data.manzanos || []));
  mznSegments = JSON.parse(JSON.stringify(data.mznSegments || {}));
  mznMethods = JSON.parse(JSON.stringify(data.mznMethods || {}));
  mznEquipamiento = JSON.parse(JSON.stringify(data.mznEquipamiento || {}));
  lotSubdivisions = JSON.parse(JSON.stringify(data.lotSubdivisions || []));
  sliceLots = JSON.parse(JSON.stringify(data.sliceLots || []));
  _geoOrigin = data.geoOrigin
    ? JSON.parse(JSON.stringify(data.geoOrigin))
    : null;
  const ui = data.uiState || {};
  if (ui.lpArea !== undefined)
    document.getElementById("lpArea").value = ui.lpArea;
  if (ui.lpFront !== undefined)
    document.getElementById("lpFront").value = ui.lpFront;
  if (ui.lpDir !== undefined) document.getElementById("lpDir").value = ui.lpDir;
  if (ui.swVal !== undefined) {
    swVal = parseFloat(ui.swVal) || 8;
    const rng = document.getElementById("swRange");
    const disp = document.getElementById("swDisp");
    if (rng) rng.value = swVal;
    if (disp) disp.textContent = swVal;
  }
  if (ui.showLots !== undefined) {
    showLots = !!ui.showLots;
    const chk = document.getElementById("lotsChk");
    if (chk) chk.checked = showLots;
  }
  if (ui.pan && ui.zoom) {
    pan = { x: ui.pan.x, y: ui.pan.y };
    zoom = ui.zoom;
  } else if (polyPts.length > 0) {
    zoomToFitPoly(polyPts);
  }
  selStreetId = null;
  dragHandle = null;
  streetStart = null;
  snapTarget = null;
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
  pickingSegForMzn = -1;
  mode = "polygon";
  document.getElementById("btnPolygon").classList.add("active");
  document.getElementById("btnStreet").classList.remove("active");
  document.getElementById("btnEdit").classList.remove("active");
  document.getElementById("btnSlice").classList.remove("active");
  document.getElementById("btnStreet").disabled = !polyClosed;
  document.getElementById("btnSlice").disabled = !polyClosed;
  document.getElementById("btnClose").style.display = "none";
  document.getElementById("modeLabel").textContent = "MODO: PARCELA";
  document.getElementById("hintLabel").textContent = "";
  document.getElementById("editPanel").style.display = "none";
  document.getElementById("slicePanel").style.display = "none";
  document.getElementById("segHint").style.display = "none";
  document.getElementById("slicePhaseA").style.display = "";
  document.getElementById("slicePhaseB").style.display = "none";
  document.getElementById("slicePhaseC").style.display = "none";
  document.getElementById("slicePhaseD").style.display = "none";
  document.getElementById("sliceSegHint").style.display = "none";
  document.getElementById("sliceSegInfo").style.display = "none";
  canvas.style.cursor = "crosshair";
  _historyPaused = false;
  _updateUndoBtn();
  if (manzanos.length > 0 && lotSubdivisions.length === 0) {
    for (let i = 0; i < manzanos.length; i++) {
      lotSubdivisions.push({ mznIdx: i, lots: [] });
    }
  }
  updateInstr();
  updateLpCalc();
  updateSidebar();
  updateStatsPanel();
  render();
  document.getElementById("hintLabel").textContent =
    "✓ Proyecto cargado correctamente";
  setTimeout(() => {
    document.getElementById("hintLabel").textContent = "";
  }, 3000);
}

//===================   FIN GUARDAR PROYECTO===================================================
