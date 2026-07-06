// =====================================================================
// MÓDULO 06/17 · 06-lot-params-ui.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 03-state.js, 04-history.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [6] PARÁMETROS DE LOTES (dirección / eje de subdivisión)
// (candidato a módulo: lot-params-ui.js · depende de: [3], [4])
// =====================================================================
function updateLpCalc() {
  const area = parseFloat(document.getElementById("lpArea").value) || 250;
  const front = parseFloat(document.getElementById("lpFront").value) || 12;
  const depth = area / front;
  const dirVal = document.getElementById("lpDir").value;
  const nSeg = Object.keys(mznSegments).length;
  const dirDesc =
    dirVal === "seg"
      ? nSeg > 0
        ? `${nSeg} manzano${nSeg !== 1 ? "s" : ""} con segmento definido`
        : "Sin segmentos definidos aún"
      : "Automático";
  document.getElementById("lpCalc").innerHTML =
    `<div class="g">Frente: <span class="r">${front.toFixed(2)} m</span></div>
     <div class="g">Fondo: <span class="r">${depth.toFixed(2)} m</span></div>
     <div class="g">Área: <span class="r">${area.toFixed(2)} m²</span></div>
     <div class="g">Eje: <span class="r">${dirDesc}</span></div>`;
}
updateLpCalc();

function onDirChange() {
  const val = document.getElementById("lpDir").value;
  if (val !== "seg") {
    mznSegments = {};
    pickingSegForMzn = -1;
    document.getElementById("segHint").style.display = "none";
  }
  updateLpCalc();
  updateSidebar();
  render();
}

function startPickSegment(mznIdx) {
  pickingSegForMzn = mznIdx;
  document.getElementById("segHint").style.display = "";
  render();
}

function cancelPickSegment() {
  pickingSegForMzn = -1;
  document.getElementById("segHint").style.display = "none";
  render();
}

function clearMznSegment(mznIdx) {
  delete mznSegments[mznIdx];
  updateLpCalc();
  updateSidebar();
  render();
}

