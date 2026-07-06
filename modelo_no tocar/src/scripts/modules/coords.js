// =====================================================================
// MÓDULO 05/17 · 05-coords.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): 03-state.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [5] TRANSFORMACIÓN DE COORDENADAS (mundo ↔ canvas/pantalla)
// (candidato a módulo: coords.js · depende de: estado global [3])
// =====================================================================
function resize() {
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  if (!polyClosed && polyPts.length === 0)
    pan = { x: canvas.width / 2, y: canvas.height / 2 };
  render();
}
window.addEventListener("resize", resize);
resize();
function toC(wx, wy) {
  return { x: wx * zoom + pan.x, y: wy * zoom + pan.y };
}
function toW(cx, cy) {
  return { x: (cx - pan.x) / zoom, y: (cy - pan.y) / zoom };
}
function wm(d) {
  return d * MPP;
}
function mw(m) {
  return m / MPP;
}
function ptWM(p) {
  return { x: wm(p.x), y: -wm(p.y) };
}
function ptMW(p) {
  return { x: mw(p.x), y: -mw(p.y) };
}
