// =====================================================================
// MÓDULO 14/17 · 14-project-actions.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 03-state.js, 04-history.js, 13-render.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [14] ACCIONES GLOBALES (borrar parcela / reiniciar proyecto)
// (candidato a módulo: project-actions.js · depende de: [3],[4],[13])
// =====================================================================
function deleteParcela() {
  if (!polyClosed && polyPts.length === 0) {
    alert(t("alertNoParcela"));
    return;
  }
  const msg = polyClosed ? t("confirmDelParcCerr") : t("confirmDelParcAb");
  if (!confirm(msg)) return;

  polyPts = [];
  polyClosed = false;
  streetStart = null;
  streets = [];
  manzanos = [];
  lotSubdivisions = [];
  selStreetId = null;
  dragHandle = null;
  dxfGuideLines = [];
  _dxfRawGeometries = [];
  showGuideLines = true;
  const guideLbl2 = document.getElementById("guideLinesLabel");
  if (guideLbl2) {
    guideLbl2.style.display = "none";
    const gc = document.getElementById("guideChk");
    if (gc) gc.checked = true;
  }
  mode = "polygon";
  if (_geoOrigin) {
    pan.x = canvas.width / 2;
    pan.y = canvas.height / 2;
    zoom = 2;
    if (_satVisible && _satMap) {
      setTimeout(() => {
        _satMap.invalidateSize();
        _alignLeafletToCanvas();
      }, 80);
    }
  } else {
    _geoOrigin = null;
  }

  document.getElementById("btnPolygon").classList.add("active");
  document.getElementById("btnStreet").classList.remove("active");
  document.getElementById("btnEdit").classList.remove("active");
  document.getElementById("btnSlice").classList.remove("active");
  document.getElementById("btnStreet").disabled = true;
  document.getElementById("btnSlice").disabled = true;
  document.getElementById("btnClose").style.display = "none";
  document.getElementById("modeLabel").textContent = t("modoParcela");
  document.getElementById("hintLabel").textContent = "";
  document.getElementById("editPanel").style.display = "none";
  mznSegments = {};
  mznMethods = {};
  mznEquipamiento = {};
  pickingSegForMzn = -1;
  sliceMznIdx = -1;
  sliceLots = [];
  sliceSubPhase = "none";
  sliceSelectingFrente = null;
  sliceSelectingAux = null;
  sliceAdjacentSegs = [];
  sliceSubMzn = null;
  slicePickingSeg = false;
  sliceCutDirX = null;
  sliceCutDirY = null;
  sliceFrenteMidX = null;
  sliceFrenteMidY = null;
  document.getElementById("slicePanel").style.display = "none";
  document.getElementById("segHint").style.display = "none";
  document.getElementById("lpDir").value = "auto";
  document.getElementById("lotsPanel").innerHTML = "";
  document.getElementById("streetsPanel").innerHTML = "";
  document.getElementById("totalArea").textContent = "";
  canvas.style.cursor = "crosshair";
  updateInstr();
  updateLpCalc();
  updateStatsPanel();
  render();
}

function resetAll() {
  if (!confirm(t("alertNuevoProy"))) return;
  window.location.reload();
}

//--------------------------------------------------------------------//

