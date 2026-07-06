// =====================================================================
// MÓDULO 04/17 · 04-history.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 03-state.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// [4] HISTORIAL (UNDO / REDO)
// (candidato a módulo: history.js · depende de: estado global [3])
// =====================================================================
function _snapshot() {
  if (_historyPaused) return;
  const snap = {
    polyPts: polyPts.map((p) => ({ ...p })),
    polyClosed: polyClosed,
    streets: JSON.parse(JSON.stringify(streets)),
    manzanos: JSON.parse(JSON.stringify(manzanos)),
    lotSubdivisions: JSON.parse(JSON.stringify(lotSubdivisions)),
    sliceLots: JSON.parse(JSON.stringify(sliceLots)),
    mznSegments: JSON.parse(JSON.stringify(mznSegments)),
    mznMethods: JSON.parse(JSON.stringify(mznMethods)),
    mznEquipamiento: JSON.parse(JSON.stringify(mznEquipamiento)),
    streetIdCtr: streetIdCtr,
  };
  _history.push(snap);
  if (_history.length > HISTORY_MAX) _history.shift();
  _updateUndoBtn();
}

function _restoreSnapshot(snap) {
  _historyPaused = true;
  polyPts = snap.polyPts.map((p) => ({ ...p }));
  polyClosed = snap.polyClosed;
  streets = JSON.parse(JSON.stringify(snap.streets));
  manzanos = JSON.parse(JSON.stringify(snap.manzanos));
  lotSubdivisions = JSON.parse(JSON.stringify(snap.lotSubdivisions));
  sliceLots = JSON.parse(JSON.stringify(snap.sliceLots));
  mznSegments = JSON.parse(JSON.stringify(snap.mznSegments));
  mznMethods = JSON.parse(JSON.stringify(snap.mznMethods));
  mznEquipamiento = JSON.parse(JSON.stringify(snap.mznEquipamiento));
  streetIdCtr = snap.streetIdCtr;
  _historyPaused = false;
}

function undoAction() {
  if (_history.length === 0) return;
  const snap = _history.pop();
  _restoreSnapshot(snap);
  const btnStreet = document.getElementById("btnStreet");
  const btnSlice = document.getElementById("btnSlice");
  btnStreet.disabled = !polyClosed;
  btnSlice.disabled = !polyClosed;
  document.getElementById("btnClose").style.display =
    !polyClosed && polyPts.length >= 3 ? "" : "none";

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
  streetStart = null;
  selStreetId = null;
  dragHandle = null;
  document.getElementById("slicePhaseA").style.display = "";
  document.getElementById("slicePhaseB").style.display = "none";
  document.getElementById("slicePhaseC").style.display = "none";
  document.getElementById("slicePhaseD").style.display = "none";
  document.getElementById("sliceSegHint").style.display = "none";
  document.getElementById("sliceSegInfo").style.display = "none";
  document.getElementById("segHint").style.display = "none";
  document.getElementById("editPanel").style.display = "none";
  document.getElementById("hintLabel").textContent = "";
  updateInstr();
  updateLpCalc();
  updateSidebar();
  updateStatsPanel();
  _updateUndoBtn();
  render();
}

function _updateUndoBtn() {
  const btn = document.getElementById("btnUndo");
  if (!btn) return;
  btn.disabled = _history.length === 0;
  btn.style.opacity = _history.length === 0 ? "0.4" : "1";
  btn.title =
    _history.length === 0
      ? "Sin acciones para deshacer"
      : `Deshacer (${_history.length} paso${_history.length !== 1 ? "s" : ""} guardado${_history.length !== 1 ? "s" : ""})`;
}
