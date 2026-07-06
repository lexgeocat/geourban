// =====================================================================
// MÓDULO 03/17 · 03-state.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): (ninguna) — casi todos los demás módulos leen/escriben este estado
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// =====================================================================
// [3] ESTADO GLOBAL DE LA APLICACIÓN (variables compartidas)
// (candidato a módulo: state.js · sin dependencias propias;
//  todo lo demás lee/escribe estas variables)
// Nota: hay más estado global "satélite" cerca de la línea ~2340
// (mznMethods, mznEquipamiento, _sat*, _geoOrigin, _rendering) que
// debería unirse aquí al modularizar.
// =====================================================================
const canvas = document.getElementById("mainCanvas");
const ctx = canvas.getContext("2d");
const wrap = document.getElementById("canvasWrap");
const MPP = 0.1; // 1 unidad mundo = 0.1 metros → 10 u.m. = 1 metro

// Aplicar textos de interfaz al cargar
document.addEventListener("DOMContentLoaded", () => {
  applyLang();
});

const MZN_COLORS = [
  "#1f6feb",
  "#3fb950",
  "#ff7b72",
  "#d2a8ff",
  "#ffa657",
  "#79c0ff",
  "#56d364",
  "#f78166",
  "#e3b341",
  "#a5d6ff",
];
let showGrid = true;
let showLots = true;
let mode = "polygon";
let polyPts = [];
let polyClosed = false;
let mousePos = { x: 0, y: 0 };
let swVal = 8;
let streetStart = null;
let streets = [];
let streetIdCtr = 0;
let manzanos = [];
let lotSubdivisions = [];
let pan = { x: 0, y: 0 };
let zoom = 1;
let isPanning = false,
  panStart = { x: 0, y: 0 };
let selStreetId = null;
let dragHandle = null;
let snapTarget = null;
let mznSegments = {};
let pickingSegForMzn = -1;
let sliceMznIdx = -1;
let sliceSubPhase = "none";
let sliceSelectingFrente = null;
let sliceSelectingAux = null;
let sliceAdjacentSegs = [];
let sliceSubMzn = null;
let slicePickingSeg = false;
let sliceCutDirX = null;
let sliceCutDirY = null;
let sliceFrenteMidX = null;
let sliceFrenteMidY = null;
let sliceCutLineMode = false;
let sliceCutLineStep = 0;
let sliceCutLineP1 = null;
let sliceCutLineP2 = null;
let sliceLots = [];
let dxfGuideLines = [];
let showGuideLines = true;
let _dxfRawGeometries = [];
let _orthoCanvas = null;
let _orthoExtentM = null;
let _orthoOpacity = 0.85;
let _orthoVisible = true;
let _orthoTileUrls = [];
const HISTORY_MAX = 30;
let _history = [];
let _historyPaused = false;

// =====================================================================
