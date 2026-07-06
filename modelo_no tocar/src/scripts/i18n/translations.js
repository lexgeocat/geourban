// =====================================================================
// MÓDULO 01/17 · 01-translations.js
// Parte de la modularización quirúrgica de 01-core.js
// (ver README-MODULARIZACION.md para el mapa completo y el orden de carga)
// Depende de (cargar ANTES que este archivo): (ninguna) — usado por: 02-i18n.js
// Cargar como <script> clásico normal (NO type="module"), respetando
// el orden numérico de los 17 módulos. No se movió ni una línea de código:
// este archivo es un corte exacto del original, verificado byte a byte.
// =====================================================================

// ============================================================
// script.js — extraido de index.html (bloques <script>)
// ============================================================
//
// ÍNDICE DE SECCIONES (ver banners "[N]" a lo largo del archivo)
//  [1]  Textos de la interfaz (TRANSLATIONS)
//  [2]  i18n — helpers de traducción y aplicación al DOM
//  [3]  Estado global de la aplicación
//  [4]  Historial (undo/redo)
//  [5]  Transformación de coordenadas (mundo ↔ canvas)
//  [6]  Parámetros de lotes (dirección/eje)
//  [7]  Modos de dibujo e interacción del mouse
//  [8]  Geometría auxiliar en píxeles (fillets de calles)
//  [9]  Motor geométrico de polígonos (parcela/manzanos/calles)
//  [10] Motor de subdivisión automática de lotes
//  [11] Sidebar / panel lateral
//  [12] Equipamiento — elementos decorativos
//  [13] Render principal del canvas
//  [14] Acciones globales (borrar parcela / reiniciar)
//  [15] Subdivisión manual (slice)
//  [16] Estadísticas y menús de vista
//  [17] Plano por lote (generación de plano imprimible)
//
// Este archivo NO incluye: import/export DXF, KMZ/ortofoto, guardado y
// carga de proyecto (saveProject/triggerLoadProject/exportDXF) — esas
// funciones se invocan aquí (vía onclick en el HTML) pero viven en otro
// archivo. Ver notas de modularización al final de este índice.
//
// IMPORTANTE PARA MODULARIZAR: muchas funciones de este archivo no se
// llaman desde ningún otro lugar DENTRO de este .js — se invocan desde
// atributos onclick/onchange en el HTML (que no forma parte de este
// archivo). Antes de eliminar "código muerto" o convertir esto a
// módulos ES (import/export), hay que revisar el HTML y exponer esas
// funciones globalmente (por ejemplo colgándolas de `window`).
// =====================================================================

// =====================================================================
// [1] TEXTOS DE LA INTERFAZ (TRANSLATIONS)
// =====================================================================
const TRANSLATIONS = {
    // ── Header / Toolbar ──────────────────────────────────────────────
    btnParcela: "Parcela",
    btnTrazarCalle: "Trazar Calle",
    btnEditarCalles: "Editar Calles",
    btnSubdivision: "Subdivisión Manual",
    btnImportar: "Importar",
    btnExportarDXF: "Exportar DXF",
    btnVistaPrevia: "Vista Previa",
    btnGuardar: "Guardar",
    btnCargar: "Abrir",
    btnCalc: "Calc",
    btnNuevo: "Nuevo",
    labelCalle: "Calle:",
    impDXF: "DXF (AutoCAD)",
    impKMZ: "KMZ / KML (Google Earth)",
    impOrtofoto: "Ortofoto KMZ",
    vpPlanoGeneral: "Plano General",
    vpPlanoPorLote: "Plano por Lote",
    // ── Sidebar ───────────────────────────────────────────────────────
    tutorialYT: "▶ Ver Tutorial en YouTube",
    h3Manzanos: "Manzanos",
    h3Calles: "Calles",
    spTitle: "◼ Estadísticas del Proyecto",
    thDesc: "Descripción",
    thCant: "Cant.",
    thArea: "Área (m²)",
    thPct: "%",
    sinDatos: "Sin datos",
    instrP1: "<b>PASO 1:</b> Clic para vértices de la parcela.",
    instrP1b: 'Doble clic o "Cerrar" para finalizar.',
    instrP2: "<b>PASO 2:</b> Trazá calles para crear manzanos.",
    instrP2b: "1er clic = inicio · 2do clic = fin de calle.",
    instrEdit: "<b>EDITAR:</b> Arrastra los puntos S/E de las calles.",
    instrCerrada: "Parcela cerrada. Traza calles → generá lotes.",
    // ── Parámetros de Lotes ───────────────────────────────────────────
    lpTitle: "◼ Parámetros de Lotes",
    lpAreaLabel: "Área objetivo por lote (m²)",
    lpFrenteLabel: "Frente mínimo (m)",
    lpDirLabel: "Dirección eje principal",
    lpDirAuto: "Automático (eje mayor del manzano)",
    lpDirSeg: "Por segmento (definir por manzano)",
    segHintTxt: "▶ Clic en un lado del manzano resaltado en el canvas.",
    segInfoTxt: "✓ Segmento seleccionado",
    btnGenerarLotes: "▶ Generar Lotes",
    btnLimpiarLotes: "✕ Limpiar",
    // ── Subdivisión Manual ────────────────────────────────────────────
    sliceTitle: "✂ Subdivisión Manual",
    sliceMznBase: "Manzano base",
    sliceAreaSub: "Área del sub-manzano (m²)",
    sliceBtnPaso1: "▶ Paso 1: Definir frente del sub-manzano",
    sliceHintFrente: "▶ Clic en el lado FRENTE del manzano en el canvas.",
    sliceHintLateral:
      "▶ Clic en un segmento LATERAL adyacente (naranja) en el canvas.",
    sliceHintLinea: "▶ Clic para definir PUNTO 1 de la línea de corte",
    slicePunto2: "▶ Clic para definir PUNTO 2 de la línea de corte",
    sliceSnapNote: "⊥ snap perpendicular a segmentos activo",
    sliceBtnLinea: "✎ Trazar línea de corte (2 puntos)",
    sliceBtnCancelar: "✕ Cancelar",
    slicePaso2Lbl: "▶ Paso 2: Definir dirección de lotes",
    sliceSegHintTxt: "▶ Clic en un lado del sub-manzano en el canvas.",
    sliceSegInfoTxt: "✓ Dirección de corte definida",
    sliceModeLbl: "Modo de subdivisión",
    sliceModeEqual: "Partes iguales (N lotes)",
    sliceModeCustom: "Áreas específicas (m²)",
    sliceNLbl: "Número de lotes",
    sliceAreasLbl: "Área por lote en m² (un valor = todos iguales)",
    sliceAreasPlh: "250 ó 120, 150, 200",
    sliceFrenteLbl: "Frente mínimo (m)",
    sliceBtnDefinirDir: "▶ Definir dirección",
    sliceBtnEjecutar: "✓ Ejecutar",
    sliceBtnNuevoSub: "+ Nuevo sub-manzano",
    sliceSubManos: "Sub-manzanos manuales",
    // ── Edit Panel ───────────────────────────────────────────────────
    epInicioXY: "Inicio X / Y (m)",
    epFinXY: "Fin X / Y (m)",
    epLongitud: "Longitud eje (m)",
    epAncho: "Ancho (m)",
    epPlhLongitud: "Longitud",
    epPlhAncho: "Ancho",
    epBtnAplicar: "✓ Aplicar",
    epBtnCerrar: "Cerrar",
    epBtnBorrar: "✕ Borrar",
    // ── Modal Importar DXF ────────────────────────────────────────────
    imTitle: "↑ IMPORTAR PARCELA DESDE DXF",
    imDropTxt: "Clic aquí o arrastrá un archivo <b>.DXF</b>",
    imUtmZonaLbl: "Zona UTM",
    imHemisferioLbl: "Hemisferio",
    imHemiSur: "Sur",
    imHemiNorte: "Norte",
    imNotaTxt:
      "⚠ La importación reemplaza la parcela actual y borra calles y lotes.<br>✓ Solo se importa el primer polígono cerrado válido (≥3 vértices).<br>✓ Las coordenadas DXF deben estar en UTM (metros reales).",
    imBtnImportar: "✓ Importar",
    imBtnCancelar: "✕ Cancelar",
    // ── (licencia eliminada) ──────────────────────────────────────────
    // ── Modal Plano Lote ──────────────────────────────────────────────
    plTitulo: "⊙ PLANO PERIMÉTRICO DE LOTE",
    plBtnCerrar: "✕ Cerrar",
    plManzanoLbl: "Manzano:",
    plLoteLbl: "Lote:",
    plPropietarioLbl: "Propietario:",
    plArqLbl: "Arq.:",
    plUrbLbl: "Urbanización:",
    plLaminaLbl: "Lámina:",
    plBtnAbrir: "▶ Abrir Plano",
    // ── Calculadora ───────────────────────────────────────────────────
    calcTitulo: "⊞ CALCULADORA",
    // ── Barra de estado / hints ───────────────────────────────────────
    modoMouse: "MODO: MOUSE",
    modoParcela: "MODO: PARCELA",
    modoTrazarCalle: "MODO: TRAZAR CALLE",
    modoEditarCalles: "MODO: EDITAR CALLES",
    modoSubdivision: "MODO: SUBDIVISIÓN MANUAL",
    hint2doClic: "→ 2do clic para confirmar",
    hintCalleCopiada: "✓ Calle copiada",
    hintCallePegada: "✓ Calle pegada (+5m desplazada)",
    hintCerrarPrimero: "Cerrá la parcela antes de pegar calles.",
    hintParcDXF: "Parcela importada desde DXF",
    hintProyGuardado: "✓ Proyecto guardado correctamente",
    hintProyCargado: "✓ Proyecto cargado correctamente",
    hintUbicPrev: "✓ Ubicación previa cargada",
    hintUbicAct: "✓ Ubicación actualizada",
    hintCentrar: "No hay dibujo para centrar.",
    hintCopiado: "✓ Copiado!",
    hintOrtoOk: "🛰️ Ortofoto cargada",
    // ── Sidebar dinámico ──────────────────────────────────────────────
    mzoPrefix: "Mzo.",
    equipPrefix: "Equipamiento",
    marcarEquip: "▲ Marcar como Equipamiento",
    quitarEquip: "▼ Quitar Equipamiento",
    metodoDivLbl: "Método de división",
    metodoAuto: "▣ Auto",
    metodoAutoSub: "Cortes alineados",
    metodoExacto: "◈ Exacto",
    metodoExactoSub: "Área exacta",
    clicCanvas: "⬤ Clic en el canvas...",
    cambiarEje: "✓ Cambiar eje",
    definirEje: "▶ Definir eje",
    lotes: "lotes",
    lote: "lote",
    remanentes: "remanentes",
    remanente: "remanente",
    calleCard: "Calle",
    calleAncho: "ancho",
    calleLargo: "largo",
    clicEditar: "Clic para editar",
    totManzanos: "Manzanos:",
    totLotesAuto: "lotes auto",
    totLotesManuales: "lotes manuales",
    statLotes: "◼ Lotes",
    statManzanos: "◼ Manzanos",
    statEquip: "★ Equipamiento",
    statVias: "◼ Vías",
    statParcela: "Parcela Total",
    dibujaParcela: "Dibujá la parcela para ver estadísticas",
    subMznosManual: "Sub-manzanos manuales",
    eliminar: "Eliminar",
    // ── Alerts / Confirms ─────────────────────────────────────────────
    alertNoParcela: "No hay parcela dibujada.",
    confirmDelParcCerr:
      "¿Eliminar la parcela y todo su contenido (calles, manzanos, lotes)?",
    confirmDelParcAb: "¿Eliminar los vértices de la parcela en curso?",
    alertNoImprimir: "No hay datos para imprimir. Dibujá una parcela primero.",
    alertNoPDFLib: "No se pudo cargar jsPDF. Descargando como PNG en su lugar.",
    alertNoExportar: "No hay datos para exportar.",
    alertSubAreaInv:
      "El área del sub-manzano debe ser mayor que 0 y menor que el área total del manzano.",
    alertCorteError:
      "No se pudo calcular el corte. Intentá con otros segmentos.",
    alertLineaCorta:
      "La línea de corte es muy corta. Definí dos puntos separados.",
    alertCorteError2:
      "No se pudo calcular el corte con esa línea. Probá ajustando los puntos.",
    confirmDelSub: (n) => `¿Eliminar sub-manzano ${n} y sus lotes?`,
    alertNoSubMzn: "Primero creá el sub-manzano (Paso 1).",
    alertNoDirCorte: "Primero definí la dirección de corte (Paso 2).",
    alertAreaInvalida: "Ingrese al menos un área válida.",
    alertAreaSupera: (a, t) =>
      `El área por lote (${a} m²) supera el sub-manzano (${t} m²).`,
    alertNoCaben: "No cabe ningún lote con ese área.",
    alertSumaSupera: (s, t) =>
      `Suma de áreas (${s} m²) supera el sub-manzano (${t} m²).`,
    alertNoProyecto:
      "No hay proyecto para guardar. Dibujá una parcela primero.",
    alertExtLsai: "El archivo debe tener extensión .lsai",
    confirmCargarProy:
      "Cargar un proyecto reemplazará el trabajo actual. ¿Continuar?",
    alertErrorLeer: (e) => "Error al leer el archivo: " + e,
    alertNoPodLeer: "No se pudo leer el archivo.",
    alertArchivoInv: "El archivo no es un proyecto válido de Lotes Sai.",
    alertParcInv: "El proyecto no contiene una parcela válida.",
    alertNuevoProy:
      "¿Crear nuevo proyecto? Se perderá el trabajo actual si no fue guardado.",
    alertNoLotes:
      'Generá lotes primero (botón "Generar Lotes") antes de imprimir planos individuales.',
    alertErrPNG: (e) => "Error al generar PNG: " + e,
    alertPopupBlq:
      "El navegador bloqueó la ventana emergente. Permitila para este sitio e intentá de nuevo.",
    imErrNoDXF: "Error: el archivo debe ser .DXF",
    imLeyendoArch: "Leyendo archivo...",
    imErrNoPoly:
      "No se encontró ningún polígono cerrado válido (mínimo 3 vértices).",
    btnDescPNG: "⬇ Descargar PNG",
    btnGenerando: "⏳ Generando...",
    eliminarCalle: "¿Eliminar esta calle?",
    hintUbicZona: (zone, hemi) =>
      `✓ Ubicación previa cargada · Zona UTM ${zone}${hemi === "south" ? "S" : "N"}`,
    hintUbicActZona: (zone, hemi) =>
      `✓ Ubicación actualizada · Zona UTM ${zone}${hemi === "south" ? "S" : "N"}`,
    hintKMZOk: (zone, hemi) =>
      `✓ Parcela importada desde KMZ/KML · Zona UTM ${zone}${hemi === "south" ? "S" : "N"}`,
    hintOrtofotaOk: (n, zone, hemi) =>
      `🛰️ Ortofoto cargada · ${n} tile(s) · Zona ${zone}${hemi === "south" ? "S" : "N"}`,
};

