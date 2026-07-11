# GeoUrban — Stack Tecnológico y Plan de Implementación
### Documento de arquitectura técnica — v1.2 (julio 2026)

> **Changelog:**
> - **v1.2 (jul 2026):** cierre de Fases 1 y 2 al 100%. R-Tree real (rbush 4.x) en `SpatialIndex`; LOD real con 3 sub-capas WebGL conmutadas por zoom; `Select` + `Modify` + `Translate` oficiales de OL con multi-selección sincronizada a un `selectionStore`; borrado real de features (Delete / Backspace / botón Papelera / modo Erase); atajos de teclado V/H/P/L/E/Esc/Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z/Ctrl+A/Del implementados en un hook central. Sin regresiones: lint 0 errores, build OK.
> - **v1.1 (jul 2026):** auditoria completa del proyecto con el código real en mano. Estado actual, gaps detectados, riesgos y roadmap priorizado para llegar al MVP. La versión v1.0 (de julio 2026) es la base arquitectónica intacta; la v1.1 agrega una nueva sección **"Estado real del proyecto"** entre la 7 y la 8 originales, y reordenó las fases con porcentaje de avance.
> - **v1.0 (jul 2026):** plan arquitectónico base.

---

## 1. Resumen de las decisiones fuertes

| Decisión | Elección | Por qué |
|---|---|---|
| Motor de mapa/edición | **OpenLayers 10.x** (renderer WebGL para pintar + interacciones Canvas para editar) | Es la librería con más funcionalidad de edición GIS (snapping, digitalización, validación de geometría) del mercado open-source, y desde la v7+ tiene un `WebGLVectorLayer` que renderiza polígonos y líneas por GPU (triangulación en shaders), aguantando decenas de miles de features sin caerse. |
| App de escritorio sin Electron | **Tauri v2** | Es el estándar de facto 2026 para esto. Usa el WebView nativo del SO en vez de empaquetar Chromium: instalador de **3–15 MB** contra 100–200 MB de Electron, RAM idle de 20–100 MB contra 200–400 MB, y arranque ~4x más rápido. Backend en Rust opcional (podés no tocar Rust casi nada). |
| Backend | **Ninguno** (100% client-side) | Cumple tu restricción. Todo el cálculo geométrico corre en el navegador/WebView con Web Workers para no bloquear la UI. |
| Publicación | **GitHub Pages** (versión web/PWA instalable) + **GitHub Releases** (instaladores .exe/.dmg/.AppImage generados por Tauri vía GitHub Actions) | Un solo repo, un solo pipeline, cero servidores. |
| Persistencia | **IndexedDB** (autoguardado) + archivo de proyecto propio `.geourban` (JSON/GeoJSON) exportable/importable | Sin backend no hay "guardado en la nube" nativo, pero con esto el usuario nunca pierde el trabajo y puede llevar el archivo a cualquier lado. |

**Idea clave de arquitectura:** construís **una sola base de código web** (React + OpenLayers) que corre tal cual en el navegador como PWA instalable, y la **misma base** se empaqueta con Tauri para generar los instaladores nativos de escritorio. No es "elegí A o B": hacés las dos cosas casi gratis, porque Tauri simplemente envuelve tu frontend web sin que tengas que reescribir nada. Hay precedente directo de esto en el ecosistema GIS open-source (proyectos que corren "en el navegador, como app de escritorio y en el celular" desde un único código con exactamente este combo: motor de mapa vectorial + React/TS + Tauri).

---

## 2. Stack tecnológico completo

### 2.1 Motor gráfico / mapa

- **OpenLayers 10.x** — núcleo del visor y editor.
  - `ol/layer/WebGLVector` para renderizar la capa masiva de lotes (hasta 10.000 polígonos) por GPU. Esto es lo que te da "muy rápido, miles de objetos, zoom infinito, pan fluido".
  - `ol/layer/Vector` (Canvas) para la(s) capa(s) "activa(s)" que se están editando en el momento (el polígono que estás dibujando/moviendo). Canvas es más lento a gran escala pero más simple para hit-testing fino en edición; como es solo la capa activa (nunca los 10.000 lotes a la vez), no pesa.
  - `ol/interaction/Draw`, `Modify`, `Snap`, `Translate`, `Select` — la base nativa de dibujo, edición de vértices y snapping. Se extiende con snapping avanzado (perpendicular, paralelo, punto medio, intersección) con lógica propia sobre estas interacciones.
  - `disableHitDetection` + índices espaciales (`rbush`, que OpenLayers ya usa internamente) para selección rápida incluso con miles de features.

- **Alternativa que se descartó:** MapLibre GL JS. Es más rápido para *visualización* pura de vectores estilizados, pero no trae herramientas de edición/digitalización nativas de nivel profesional (hay que sumar plugins de terceros como Terra Draw, que no llegan al nivel de snapping que necesitás para planimetría). OpenLayers es, hoy, el "default" recomendado específicamente cuando el proyecto necesita edición/snapping/digitalización — que es exactamente tu caso.

### 2.2 Frontend / UI

- **React 19 + TypeScript** — componentes de UI (paneles de capas, toolbox, cuadros de diálogo de subdivisión, etc.)
- **Vite** — bundler, deploy directo a GitHub Pages, integración nativa con Tauri.
- **Zustand + Immer** — estado global ligero, con soporte de historial (undo/redo), crítico en una herramienta tipo CAD.
- **Tailwind CSS + shadcn/ui** — UI rápida de armar y consistente.
- **lucide-react** — iconografía.

### 2.3 Geoprocesamiento (el corazón matemático del sistema)

- **Turf.js** — operaciones simples y frecuentes: área, distancia, centroide, buffer, bounding box, punto-en-polígono. Rápido y liviano.
- **JSTS** (port de JavaTopologySuite a JS) — operaciones topológicas robustas donde Turf se queda corto: unión booleana confiable de polígonos (fusión de lotes), diferencia, intersección, validación/reparación de geometría (autointersecciones, anillos inválidos), buffers topológicamente correctos. Es lo que usan por debajo herramientas GIS serias para este tipo de operaciones.
- **martinez-polygon-clipping** (opcional, backup) — booleanas de polígonos muy rápidas cuando JSTS resulte pesado para operaciones simples en tiempo real.
- **Algoritmos propios** (no hay librería que resuelva esto de fábrica, es el know-how específico del producto):
  - Subdivisión por **grilla regular** (ancho de lote × profundidad, con calle interna).
  - Subdivisión **proporcional por área objetivo** (n° de lotes o m² deseado por lote).
  - Subdivisión por **straight skeleton** para parcelas con frentes irregulares (hay implementaciones JS de straight skeleton para partir de ahí).
  - Subdivisión **manual asistida** (el usuario traza la línea divisoria con snap a los bordes del polígono padre, y el sistema calcula el corte con JSTS).
  - Fusión de polígonos colindantes → `union` topológico de JSTS, con recálculo automático de cotas (perímetro/lados) del polígono resultante.
- Todo el cálculo pesado (subdivisiones automáticas de muchos lotes, validaciones de topología del proyecto completo) corre en un **Web Worker** para no congelar la UI mientras se procesa.

### 2.4 Importar / Exportar formatos

En vez de cargar una dependencia gigante como GDAL-WASM completo (varios MB, complejidad de compilación), conviene ir con librerías puntuales y livianas por formato — más alineado con tu pedido de "no busques tecnologías complejas":

| Formato | Librería | Notas |
|---|---|---|
| KML / KMZ | `ol/format/KML` (nativo de OpenLayers) + `JSZip` para KMZ (que es solo un ZIP de KML + assets) | Soporte completo, sin dependencias extra pesadas. |
| SHP (Shapefile) | `shpjs` (lectura) + `shp-write` (escritura) | 100% cliente, sin GDAL. |
| GPKG (GeoPackage) | `sql.js` (SQLite compilado a WASM) | Un GeoPackage **es** una base SQLite con esquema OGC; con `sql.js` lo lees/escribís directo en el navegador. |
| DXF (CAD) | `dxf-parser` (lectura) + `dxf-writer` (escritura) | **Importante:** soportar DXF (formato abierto de intercambio de Autodesk), **no DWG**. DWG es un formato binario propietario de Autodesk; leerlo/escribirlo bien requiere el SDK de la Open Design Alliance, que es de licencia comercial y es justo la complejidad que querés evitar. Recomendación: soportar DXF nativo, y si algún cliente insiste en DWG, que lo convierta previamente con QCAD o el propio AutoCAD/LibreCAD (conversión externa, un paso manual, no parte de tu sistema). |
| GeoJSON (formato interno del proyecto) | nativo | Este es tu formato "de guardado" propio (`.geourban` = GeoJSON extendido con metadata de capas, cotas, subdivisiones, historial). |

### 2.5 Empaquetado de escritorio — Tauri v2

- App liviana: instalador típico de pocos MB, arranque casi instantáneo, RAM baja — muy superior a Electron para este caso de uso (herramienta de dibujo, no necesita motor propio de Chromium).
- Backend Rust mínimo: solo para lo que el navegador no puede hacer bien (diálogos de guardado/apertura de archivos nativos del SO, acceso a filesystem sin las limitaciones de permisos del navegador para archivos grandes tipo GPKG/SHP).
- Plugin oficial `tauri-plugin-fs` y `tauri-plugin-dialog` cubren el 90% de lo que necesitás sin escribir Rust custom.
- Auto-updater incluido (actualizaciones futuras sin fricción para el usuario final).
- Un mismo código genera build para Windows, macOS y Linux.

### 2.6 Persistencia sin backend

- **IndexedDB** (vía `Dexie.js` o `localForage`, para no pelear con la API cruda) → autoguardado continuo del proyecto abierto en el navegador/app.
- **Archivo de proyecto propio** (`.geourban`, JSON) → exportar/importar manual, para compartir el proyecto o llevarlo a otra máquina. En la versión Tauri esto es un archivo real en disco; en la versión web/PWA es descarga/carga de archivo estándar.
- (Opcional, a futuro) Integración directa con **Google Drive API** desde el cliente (OAuth), si en algún momento quieren "guardar en la nube" sin montar un backend propio.

### 2.7 Mapa base de Google

Nota importante de arquitectura: **OpenLayers no tiene un conector "oficial" para teselas de Google Maps** (por los términos de servicio de Google, que restringen usar sus tiles fuera de su propio SDK). El camino correcto y sin sorpresas legales es:
1. Usar el **Google Maps Platform** (Maps JavaScript API) como una capa superpuesta/sincronizada, o
2. Usar la **Map Tiles API** de Google Maps Platform (pensada justo para este tipo de integración), o
3. Si el requisito de "Google" no es estricto, usar como mapa base satelital/calles alternativas totalmente libres de restricciones (Esri World Imagery, Bing vía licencia, o teselas de OpenStreetMap/OpenTopoMap) y dejar Google como una opción entre varias en el selector de capas.

Cualquiera de las tres funciona con tu selector de capas (requisito 7): activar/desactivar el mapa base y las capas de trabajo por separado.

### 2.8 CI/CD y publicación

- **GitHub Actions**:
  - Un workflow build+deploy de la app web a **GitHub Pages** en cada push a `main`.
  - Un workflow `tauri-action` que en cada release compila los tres instaladores (Windows/macOS/Linux) y los sube como assets de un **GitHub Release**.
- **GitHub** aloja código y binarios, sin infraestructura propia.

---

## 3. Cómo el stack cubre cada funcionalidad pedida

| # | Requisito | Cómo se resuelve |
|---|---|---|
| 1 | Dibujar polígonos y líneas | `ol/interaction/Draw` sobre la capa activa |
| 2 | Subdivisión interactiva (manual/automática, varios métodos) + fusión con cotas | Algoritmos propios + JSTS (union/split) en Web Worker; cotas recalculadas con Turf tras cada operación |
| 3 | Snaps profesionales y precisos | `ol/interaction/Snap` extendida con snapping perpendicular/paralelo/punto medio/intersección |
| 4 | Import/export CAD, SHP, GPKG, KML, KMZ | `dxf-parser`/`dxf-writer`, `shpjs`/`shp-write`, `sql.js`, `ol/format/KML` + `JSZip` |
| 5 | Centrar vista | `view.fit()` nativo de OpenLayers sobre el extent de la capa activa |
| 6 | Trazado de calles/avenidas | Misma herramienta de líneas (4) con estilo/capa dedicada + snapping a manzanas |
| 7 | Acotamiento automático de áreas y distancias | Turf.js (`area`, `length`) recalculado en cada edición, renderizado como etiquetas sobre el mapa |
| 8 | Activar/desactivar capas y mapa base de Google | Panel de capas React controlando `layer.setVisible()`; mapa base intercambiable (ver 2.7) |
| — | Motor gráfico rápido, miles de objetos, zoom infinito, pan fluido, selección rápida | OpenLayers `WebGLVectorLayer` + índices espaciales + hit-detection optimizado |

---

## 4. Arquitectura de alto nivel

```
┌─────────────────────────────────────────────────────────┐
│                     UI (React + Zustand)                │
│  Toolbox │ Panel de capas │ Panel de propiedades/cotas   │
└───────────────────────┬───────────────────────────────────┘
                         │
┌───────────────────────▼───────────────────────────────────┐
│                Capa de mapa (OpenLayers)                   │
│  WebGLVectorLayer (10k lotes) │ VectorLayer activa (edición)│
│  Draw / Modify / Snap / Select / Translate                  │
└───────────────────────┬───────────────────────────────────┘
                         │
┌───────────────────────▼───────────────────────────────────┐
│         Motor de geoprocesamiento (Web Worker)              │
│  Turf.js (métricas) │ JSTS (topología, subdivisión, unión)  │
└───────────────────────┬───────────────────────────────────┘
                         │
┌───────────────────────▼───────────────────────────────────┐
│      I/O de formatos: KML/KMZ, SHP, GPKG, DXF, .geourban    │
└───────────────────────┬───────────────────────────────────┘
                         │
┌───────────────────────▼───────────────────────────────────┐
│   Persistencia: IndexedDB (autoguardado) + FS nativo (Tauri)│
└─────────────────────────────────────────────────────────────┘

     Empaquetado dual: misma base ── PWA (GitHub Pages)
                                  └─ Tauri v2 (GitHub Releases: .exe/.dmg/.AppImage)
```

---

## 5. Plan de implementación por fases

**Estimación pensada para 1 dev senior full-time (o 2 devs a medio tiempo). Ajustá según tu equipo real.**

### Fase 0 — Setup ✅ COMPLETADO (100%)
- Repo, Vite + React 19 + TS, ESLint 10 (flat config) + Prettier, Tailwind 3, Zustand+Immer, shadcn/ui.
- Integración base de OpenLayers con mapa base.
- CI: `deploy-pages.yml` + `release-tauri.yml` operativos.
- **Estado real:** todo verde. Alias `@/*`, scripts `tauri:dev`/`tauri:build`, build verificado.

### Fase 1 — Motor de navegación y visualización ✅ COMPLETADO (100%)
- `WebGLVectorLayer` con dataset sintético de 10.000 polígonos y **LOD real** implementado como **3 sub-capas** (`src/map/demoLayers.ts:32-100`), cada una con su subset de features (LOD 0/1/2) y visibilidad conmutada por zoom:
  - zoom ≥ 18 → LOD 0 (geometría completa)
  - 15 ≤ zoom < 18 → LOD 1
  - 14 ≤ zoom < 15 → LOD 2 (simplificada)
  - zoom < 14 → capas apagadas
- **Índice espacial real** con `SpatialIndex` basado en `rbush` 4.x (`src/map/demoDataset.ts:103-149`). Búsqueda por bbox y por punto, `load()` para recargar, `size` y `clear()`.
- **Benchmark automático** (`src/map/benchmark.ts`) expuesto en `window.GeoUrbanBench` (corre en consola del navegador).
- Zoom, pan, centrar vista, selector de mapa base con **6 proveedores** (CAD-grid, OSM, Google Satellite, Esri, Carto Positron, Carto Dark).
- Google Maps con **Map Tiles API** (legal) + fallback a Esri.
- **Archivos:** `src/map/Map.tsx`, `src/map/baseMaps.ts`, `src/map/demoDataset.ts`, `src/map/demoLayers.ts`, `src/map/cadGridLayer.ts`, `src/map/googleMapsApi.ts`, `src/map/benchmark.ts`, `src/components/LayerPanel.tsx`, `src/store/mapStore.ts`.

### Fase 2 — Dibujo + snapping ✅ COMPLETADO (100%)
- `Draw` de polígonos y líneas (`Map.tsx`, modo `polygon`/`line`).
- `Snap` nativo + **5 tipos de snap avanzado propio** (`advancedSnap.ts`): vertex, midpoint, perpendicular, parallel, intersection, con indicador visual coloreado sobre el mapa.
- **`Select` oficial de OL** con `multi: true` para multi-selección, sincronizado con `selectionStore` (Zustand) — fuente de verdad única para la selección (`src/store/selectionStore.ts`).
- **`Modify`** sobre el source de dibujo con highlight ámbar y recálculo de cotas en `modifyend`.
- **`Translate`** oficial de OL vinculado a la `Collection` de `Select`: arrastrar mueve los features seleccionados completos (multi-move soportado) y dispara `pushState` para undo/redo.
- **Borrado real de features:**
  - `Delete` / `Backspace` → borra todos los seleccionados.
  - Modo `erase` (atajo `E` o botón Goma en toolbar) → cada click sobre una feature la borra al instante.
  - Botón Papelera en `Toolbar` con badge mostrando la cantidad seleccionada.
  - Acción `deleteSelected` y `deleteFeatureById` en `mapStore`.
- **Atajos de teclado** al estilo CAD implementados en hook central `src/hooks/useKeyboardShortcuts.ts`:
  - `V` select · `H` pan · `P` polígono · `L` línea · `E` erase · `Esc` modo `none`
  - `Ctrl/Cmd+Z` undo · `Ctrl/Cmd+Y` y `Ctrl/Cmd+Shift+Z` redo
  - `Ctrl/Cmd+A` seleccionar todo · `Delete` / `Backspace` borrar
  - Ignora teclas cuando el foco está en `input`/`textarea`/`contentEditable`.
- **Undo/Redo** con Zustand+Immer, `MAX_HISTORY = 50` snapshots GeoJSON. `pushState` se invoca tras `drawend`, `modifyend`, `translateend`, `deleteSelected` y `deleteFeatureById`.
- **Archivos nuevos:** `src/store/selectionStore.ts`, `src/hooks/useKeyboardShortcuts.ts`, `src/map/demoLayers.ts`.
- **Archivos modificados:** `src/map/Map.tsx`, `src/map/demoDataset.ts`, `src/store/mapStore.ts`, `src/store/drawStore.ts` (modo `erase` agregado), `src/components/Toolbar.tsx` (botón papelera con badge + tooltip de atajos correcto), `src/App.tsx` (monta el hook de atajos).

### Fase 3 — Acotamiento automático ✅ COMPLETADO (100%)
- Turf.js para área, perímetro, longitud, segmentos, centroide.
- Pipeline EPSG:3857 → 4326 → 3857 (`metrics.ts:32-50`).
- Cálculo por segmento con midpoint, ángulo y longitud (`metrics.ts:59-90`).
- **LOD por zoom** de 2 niveles: `canShowMainLabel = selected || zoom >= 17 || screenArea >= 5200` (`styleFactory.ts:77`), `canShowDetail = selected || zoom >= 18` (`styleFactory.ts:78`).
- Formato legible `123.45 m / 1.23 km / 1.23 ha` (`metrics.ts:165-175`).
- Trigger en `drawend` y `modifyend` (`Map.tsx:277-281, 336-344`).
- **Archivos:** `src/geo/metrics.ts`, `src/map/styleFactory.ts`, `src/map/metricsEvents.ts`.

### Fase 4 — Subdivisión y fusión 🟡 CRÍTICO (15%) 🔴 GAP PRINCIPAL DEL MVP
- **Lo único hecho:** worker JSTS con `OverlayOp.union` y `validate` (`geoOperations.ts:27-73`), client tipado `geoWorkerClient.ts`. Infraestructura matemática lista.
- **❌ No hecho (el 85% que falta):**
  - **No hay UI de subdivisión** (ningún botón, panel, dialog o flujo de "subdividir este polígono en N lotes").
  - **No hay algoritmos propios:**
    - Subdivisión por grilla regular (ancho × profundidad + calle interna).
    - Subdivisión proporcional por área objetivo / n° de lotes.
    - Subdivisión por straight skeleton.
    - Subdivisión manual asistida (trazar línea + snap a bordes del polígono padre).
  - **No hay UI de fusión de polígonos** (existe `unionPolygonsInWorker` pero nadie la invoca).
  - **No hay UI de validación topológica** (mostrar issues, reparar geometrías).
  - **No hay recálculo automático de cotas** post-fusión/subdivisión con Turf.
  - **No hay panel de propiedades** del feature seleccionado (área/perímetro/lados editables).
  - **🟡 Code-splitting del worker no aplicado** (riesgo #3 del plan): el bundle inicial carga JSTS+Turf (~400-500 KB) sin `import()` dinámico.
- **Archivos:** `src/workers/geoOperations.ts`, `src/workers/geoWorker.ts`, `src/workers/geoWorkerClient.ts`.
- **Veredicto:** **es la fase más retrasada** y la apuesta de valor diferencial. Sin esto no hay producto. **Prioridad #1 del roadmap.**

### Fase 5 — Trazado de calles/avenidas ❌ NO HECHO (0%)
- `grep calle|avenue|vial|road` en `src/` solo encuentra 1 coincidencia irrelevante (`'roadmap'` en googleMapsApi).
- Sin estilos diferenciados para vialidad.
- Sin snapping específico de vialidad (paralelo a eje, paralelismo múltiple).
- Sin capa dedicada de calles.

### Fase 6 — Import/Export de formatos 🟡 PARCIAL (60%)
- **✅ Hecho:**
  - API unificada `importFile(file)` y `exportProject(project, format)` (`io/index.ts:21-86`).
  - Detección de formato por extensión (`io/index.ts:88-103`).
  - GeoJSON / `.geourban` (con metadata: version, baseMap, view, layers, data).
  - KML/KMZ con `ol/format/KML` + `JSZip`.
  - SHP con shpjs + shp-write.
  - DXF con dxf-parser + dxf-writer, soporte LWPOLYLINE/POLYLINE/LINE/POINT, **CRS UTM 19S** con proj4.
  - UI en `TopBar` con Importar / Guardar / Exportar.
- **🟡 A medias:**
  - **GPKG: parser binario es un stub que devuelve `null` silenciosamente** (`gpkg.ts:65`). Importar un GPKG da `features: []` sin error visible.
  - GPKG export lanza error explícito (`gpkg.ts:71-72`).
  - **TopBar solo expone exportar a GeoJSON** (`TopBar.tsx:75-82`); los demás formatos (KML, SHP, DXF) están implementados en la API pero no accesibles desde la UI.
- **❌ No hecho:**
  - Preservación de estilos en KML (`extractStyles: false` en `kml.ts:6`).
  - Diálogo de progreso para archivos grandes.
  - Selección multi-archivo SHP (el `<input>` no permite subir `.shp`+`.dbf`+`.prj` juntos).
- **Archivos:** `src/io/index.ts`, `src/io/geojson.ts`, `src/io/kml.ts`, `src/io/shp.ts`, `src/io/dxf.ts`, `src/io/gpkg.ts`, `src/components/TopBar.tsx`.

### Fase 7 — Persistencia 🟡 PARCIAL (40%)
- **✅ Hecho:**
  - Dexie (IndexedDB) con DB `GeoUrbanDB` y tabla `projects`.
  - `autosaveProject`, `loadAutosavedProject`, `startAutosave` con interval 30s + `beforeunload`.
  - Hook integrado en `App.tsx:13-24`.
  - Formato `.geourban` completo.
- **🟡 A medias:**
  - **`loadAutosavedProject` existe pero NUNCA SE LLAMA**. No hay recuperación al reabrir la app. Riesgo de pérdida silenciosa de proyectos.
  - Autosave no es incremental (re-serializa todo el JSON cada 30s; con 10K features puede ser lento).
- **❌ No hecho:**
  - Diálogo "¿Recuperar sesión anterior?" al abrir la app.
  - Gestión de múltiples proyectos.
  - "Guardar como" / proyectos nombrados.
  - Persistencia del historial undo/redo entre sesiones.
- **Archivos:** `src/io/persistence.ts`, `src/io/types.ts`, `src/App.tsx`.

### Fase 8 — Tauri + PWA 🟡 PARCIAL (35%)
- **✅ Hecho:**
  - Tauri v2 inicializado (`tauri.conf.json`, `Cargo.toml`, `lib.rs`, iconos completos).
  - Workflow `release-tauri.yml` con matrix Win/macOS/Linux + `tauri-action@v0`.
  - PWA manifest en `public/manifest.json` con name, theme_color, lang=es.
  - `index.html` enlaza el manifest.
  - `vite.config.ts` ajusta `base` según `TAURI_PLATFORM`.
- **🐛 Bug crítico:** PWA icons **no existen en `public/icons/`** (el manifest apunta a `icons/icon-192.png` e `icons/icon-512.png` que están solo en `src-tauri/icons/`). La PWA es técnicamente inválida y no se puede instalar.
- **🟡 A medias:**
  - Faltan `tauri-plugin-dialog` y `tauri-plugin-fs` en `Cargo.toml` y `package.json`. La app de escritorio no usa diálogos nativos — usa `URL.createObjectURL` del DOM.
  - `grep @tauri-apps|invoke` en `src/` da **0 coincidencias**: `io/index.ts` no aprovecha Tauri.
- **❌ No hecho:**
  - Service worker para PWA offline.
  - `npm run tauri:build` no verificado en CI local.
  - `tauri-plugin-updater` ausente.
- **Archivos:** `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `.github/workflows/release-tauri.yml`, `public/manifest.json`, `vite.config.ts`.

### Fase 9 — Pulido, QA y performance 🟡 PARCIAL (20%)
- **✅ Hecho:** Bundle construido en `dist/`, benchmark script mide load/FPS/memoria/build del índice.
- **🟡 A medias:**
  - Bundle ~1.3 MB minificado. **Code-splitting de `io/` y `workers/` no aplicado** (riesgo #3 del plan).
  - **0% cobertura de tests**: `grep vitest|jest|playwright|cypress|@testing-library` da 0 resultados. No hay `test` script en `package.json`. Riesgo alto de regresiones.
  - Sin accesibilidad formal (roles ARIA, focus traps). El `Toolbar.tsx` anuncia atajos que no existen.
- **❌ No hecho:**
  - Pruebas de carga con geometrías complejas reales (DXF con curvas, SHP con miles de vértices).
  - Atajos de teclado funcionales.
  - Informes de performance automatizados en CI.
  - Minificación/simplificación de geometría al importar (riesgo #4 del plan).
- **Archivos:** `src/map/benchmark.ts`, `src/components/Toolbar.tsx`, `vite.config.ts`.

**Total estimado: ~14-17 semanas (3.5-4 meses) para un MVP sólido y completo con todas las funcionalidades mínimas.** Se puede paralelizar Fases 4 y 6 si hay 2 devs, bajando el total a ~10-12 semanas.

---

## 6. Riesgos y advertencias técnicas a tener en cuenta

1. **DWG no es DXF.** No prometas soporte DWG nativo sin licenciar el SDK de ODA; es la trampa más común en este tipo de proyectos.
2. **Google Maps tiene términos de uso estrictos** sobre sus tiles fuera del SDK oficial. ✅ *RESUELTO (jul 2026)*: se migró a Map Tiles API con API Key (`VITE_GOOGLE_MAPS_API_KEY`) y session token. Si no hay key, Google se oculta del selector y se usa Esri World Imagery como fallback.
3. **JSTS es pesado en bundle size** (varios cientos de KB). Cargalo en el Web Worker y con code-splitting/lazy-load para no penalizar el arranque inicial de la app.
4. **10.000 lotes con geometrías complejas (muchos vértices por lote) puede superar lo que WebGL tolera con fluidez** si cada polígono tiene, por ejemplo, cientos de vértices (curvas mal simplificadas de un CAD importado). Conviene simplificar geometría al importar (tolerancia configurable) y mantener la geometría "fina" solo para exportación.
5. **Tauri usa Rust para el core**, aunque para tu caso de uso alcanza con los plugins oficiales (fs, dialog, updater) casi sin escribir Rust propio — no hace falta que el equipo se vuelva experto en Rust para este proyecto.

---

## 7. Estructura de repositorio sugerida

```
geourban/
├── src/
│   ├── components/          # UI (toolbox, paneles, dialogs)
│   ├── map/                 # Configuración OpenLayers, capas, interacciones
│   ├── geo/                 # Turf/JSTS wrappers, algoritmos de subdivisión/fusión
│   ├── io/                  # Importadores/exportadores por formato
│   ├── store/               # Zustand stores
│   ├── workers/             # Web Workers de geoprocesamiento
│   └── App.tsx
├── src-tauri/                # Config y comandos Rust mínimos de Tauri
├── public/
│   └── manifest.json         # PWA
├── .github/workflows/
│   ├── deploy-pages.yml
│   └── release-tauri.yml
└── package.json
```

---

## 8. Estado real del proyecto (auditoría v1.2)

> Auditoría hecha con lectura estática completa del código en `F:\lexgeocat-geourban`. No es un plan: es la foto del proyecto al momento del análisis.

### 8.1 Avance global ponderado

| Fase | % Avance | Estado | Peso en el plan |
|---|---|---|---|
| 0 — Setup | 100% | ✅ | 5% |
| 1 — Navegación y visualización | 100% | ✅ | 12% |
| 2 — Dibujo + snapping | 100% | ✅ | 12% |
| 3 — Acotamiento automático | 100% | ✅ | 8% |
| 4 — Subdivisión / fusión | **15%** | 🟡 | **25%** ⬅️ la más grande del plan |
| 5 — Calles / avenidas | **0%** | ❌ | 8% |
| 6 — Import/Export | 60% | 🟡 | 12% |
| 7 — Persistencia | 40% | 🟡 | 5% |
| 8 — Tauri + PWA | 35% | 🟡 | 8% |
| 9 — Pulido / QA | 20% | 🟡 | 5% |
| **TOTAL** | **~55%** | 🟡 | 100% |

**Lectura:** la base técnica (Fases 0–3) está **cerrada al 100%** con código real (R-Tree RBush, LOD conmutado por zoom, Select/Modify/Translate oficiales, borrado real, atajos de teclado). El corazón del producto — **Fase 4: subdivisión y fusión** — sigue al 15% (solo el worker JSTS, sin UI ni algoritmos de negocio). **Fase 5 (calles) está literalmente en 0%.** Sin cerrar Fase 4 no hay producto.

### 8.2 Top 10 tareas pendientes priorizadas

| # | Prioridad | Tarea | Fase | Impacto |
|---|---|---|---|---|
| 1 | 🔴 Crítico | **UI de subdivisión** (botones en toolbar, dialog con parámetros, conexión a `unionPolygonsInWorker`) | 4 | Sin esto no hay producto. |
| 2 | 🔴 Crítico | **Algoritmos propios de subdivisión**: grilla regular + proporcional por área | 4 | Know-how del producto. |
| 3 | 🔴 Crítico | **UI de fusión de polígonos** + recálculo de cotas post-fusión | 4 | Feature central del MVP. |
| 4 | 🟠 Alto | **Validación topológica con UI** (mostrar issues del worker, reparar) | 4 | Calidad de datos. |
| 5 | 🟠 Alto | **Copiar iconos a `public/icons/`** + service worker (PWA instalable real) | 8 | PWA técnicamente rota. |
| 6 | 🟠 Alto | **Menú de export completo** en TopBar (KML, KMZ, SHP, DXF) — la API ya existe | 6 | UX completa. |
| 7 | 🟠 Alto | **GPKG: completar parser binario** (actualmente stub que devuelve `null` silencioso) | 6 | Feature declarada pero rota. |
| 8 | 🟡 Medio | **Plugins Tauri `dialog` y `fs`** + integrar en `io/index.ts` | 8 | Saca jugo real a Tauri. |
| 9 | 🟡 Medio | **Diálogo "Recuperar sesión"** al abrir la app (autosave existe pero no se restaura) | 7 | Pierde proyectos silenciosamente. |
| 10 | 🟡 Medio | **Tests base (Vitest)** para `metrics.ts`, `advancedSnap.ts`, `geoOperations.ts` | 9 | Evita regresiones cuando crezca Fase 4. |

### 8.3 Riesgos y bloqueos detectados

1. **🐛 Bug silencioso crítico (GPKG):** `parseGpkgGeometry` devuelve `null` en `gpkg.ts:65`. Importar un GPKG da `features: []` sin error. Alto riesgo de confusión.
2. **🐛 PWA no instalable:** manifest apunta a `icons/icon-192.png` e `icons/icon-512.png` que no existen en `public/`. Solo están en `src-tauri/icons/`.
3. **⚠️ JSTS ~400 KB en bundle inicial:** la advertencia #3 del plan no se mitigó. No hay code-splitting de `io/` ni `workers/`.
4. **⚠️ Sin tests:** 0% de cobertura. Riesgo creciente con el tamaño del código.
5. **⚠️ `tauri:build` no verificado en CI local:** el workflow puede fallar en el primer `v*` y descubrirse tarde.
6. **⚠️ `shp-write 0.3.2` está deprecado:** sucesor es `@mapbox/shp-write`. Funciona, pero es deuda técnica.
7. **✅ ~~SpatialIndex mal etiquetado como RBush~~ (v1.2):** ahora usa `rbush` 4.x de verdad con R-Tree, `load()`/`search()`/`searchPoint()`/`size`/`clear()`.
8. **✅ ~~Eraser no borra~~ (v1.2):** ahora modo `erase` real, cada click sobre una feature la borra; tecla `E`; botón con confirmación visual.
9. **✅ ~~Atajos de teclado publicitados pero no implementados~~ (v1.2):** ahora implementados en `useKeyboardShortcuts`, montados en `App.tsx`. V/H/P/L/E/Esc/Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z/Ctrl+A/Delete activos.
10. **✅ ~~LOD declarado pero no efectivo~~ (v1.2):** ahora 3 sub-capas WebGL conmutadas por zoom (`demoLayers.ts:88-98`) y `updateVisibility(zoom)` invocado en `change:resolution`.

### 8.4 Roadmap propuesto (siguiente sprint)

**▶️ Sprint 0 (1 día) — Bug visible antes de release:**
- Copiar `src-tauri/icons/128x128.png` → `public/icons/icon-192.png` y `public/icons/icon-512.png`. (Hacer la PWA realmente instalable.)

**▶️ Sprint 1 (2–3 semanas) — Cerrar Fase 4 (corazón del producto):**
- Semana 1: UI mínima (toolbar con "Fusionar selección" y "Subdividir selección", dialog con params).
- Semana 2: Algoritmo de grilla regular y proporcional por área (con tests unitarios desde día 1).
- Semana 3: Conexión a `unionPolygonsInWorker` para fusión, recálculo de cotas, validación topológica con feedback visual.

**▶️ Sprint 2 (1 día) — Base de testing:**
- Instalar Vitest + React Testing Library.
- Tests para `metrics.ts`, `advancedSnap.ts`, `geoOperations.ts`.
- Evita regresiones cuando se sume código de Fase 4 (área de mayor churn).

**Estimación realista para MVP funcional con Fase 4 cerrada:** 6–8 semanas adicionales (1 dev senior full-time, foco en Fase 4).

---

### Nota final
Este plan asume MVP funcional con las 8 funcionalidades mínimas. Cosas como colaboración multiusuario en tiempo real, capas WMS/WFS de servidores externos, o reportes PDF de planimetría quedan fuera de alcance de "sin backend" — si en el futuro las necesitás, ahí sí conviene evaluar sumar un backend liviano (eso ya sería una v2, no parte de este documento).

---

## Apéndice A — Detalle técnico de implementación

> Referencia consolidada de dependencias, scripts, archivos y configuración. Migrado desde la v1.0 de `GeoUrban-Stack-y-Plan-Implementacion.md` y `docs/DOCUMENTACION-IMPLEMENTACION.md` para evitar duplicación.

### A.1 Dependencias (`package.json`)

#### Runtime

| Paquete | Uso |
|---|---|
| `@turf/turf` | Área, longitud, centroide, métricas en WGS84 |
| `jsts` | Operaciones topológicas en Web Worker (union, validación) |
| `shpjs` | Lectura de Shapefile |
| `shp-write` | Escritura de Shapefile (.shp/.dbf/.prj) — *deprecated, sucesor `@mapbox/shp-write`* |
| `sql.js` | Lectura de GeoPackage (SQLite WASM) — *parser binario en stub* |
| `dxf-parser` | Lectura de DXF |
| `dxf-writer` | Escritura de DXF |
| `dexie` | Wrapper IndexedDB para autoguardado |
| `jszip` | KMZ (ZIP de KML) |
| `lucide-react` | Iconografía (TopBar, Toolbar) |
| `class-variance-authority`, `clsx`, `tailwind-merge` | Utilidades shadcn/ui |
| `tailwindcss-animate` | Animaciones Tailwind (shadcn) |
| `@radix-ui/react-*` | Primitivos UI (slot, dialog, dropdown, separator, tooltip) |

#### Desarrollo

| Paquete | Uso |
|---|---|
| `@tauri-apps/cli`, `@tauri-apps/api` | Empaquetado app de escritorio v2 |
| `eslint`, `@eslint/js`, `typescript-eslint` | Linting TS/React |
| `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` | Reglas React |
| `eslint-config-prettier` | Sin conflictos ESLint/Prettier |
| `prettier` | Formateo de código |
| `globals` | Variables globales browser para ESLint flat config |

### A.2 Scripts npm

```bash
npm run dev          # Vite dev server (puerto 5173)
npm run build        # Build producción → dist/
npm run preview      # Preview del build

npm run lint         # ESLint sobre src/
npm run lint:fix     # ESLint con autofix
npm run format       # Prettier en src/**/*.{ts,tsx,css}

npm run tauri        # CLI Tauri
npm run tauri:dev    # App de escritorio en dev (requiere Rust)
npm run tauri:build  # Genera instalador nativo (.exe/.dmg/.AppImage)
```

### A.3 Archivos nuevos vs. modificados

#### Nuevos
- `docs/DOCUMENTACION-IMPLEMENTACION.md` *(será borrado al consolidar — ver changelog v1.1)*
- `src/io/*` (7 archivos: `types.ts`, `geojson.ts`, `kml.ts`, `shp.ts`, `gpkg.ts`, `dxf.ts`, `persistence.ts`, `index.ts`)
- `src/workers/*` (3 archivos: `geoOperations.ts`, `geoWorker.ts`, `geoWorkerClient.ts`)
- `src/lib/utils.ts` (helper `cn()` shadcn)
- `src/components/ui/button.tsx` (componente shadcn Button)
- `src/types/vendor.d.ts` (tipos para shpjs, sql.js, dxf-parser)
- `public/manifest.json` (PWA — *iconos faltantes, ver bug crítico #2*)
- `src-tauri/**` (Tauri v2)
- `components.json`, `eslint.config.js`, `.prettierrc`
- `.github/workflows/release-tauri.yml`
- `src/store/selectionStore.ts` *(v1.2)* — store Zustand de ids seleccionados + id primario
- `src/hooks/useKeyboardShortcuts.ts` *(v1.2)* — atajos V/H/P/L/E/Esc/Ctrl+Z/Ctrl+Y/Ctrl+Shift+Z/Ctrl+A/Delete
- `src/map/demoLayers.ts` *(v1.2)* — 3 sub-capas WebGL (LOD 0/1/2) con conmutación por zoom

#### Modificados
- `package.json` — deps + scripts + `rbush@4` + `@types/rbush`
- `vite.config.ts` — alias `@/` + worker ES modules + `base` según Tauri
- `tsconfig.json` — paths `@/*`, `moduleResolution: Bundler`
- `tailwind.config.cjs` — tokens shadcn + animate
- `index.html` — manifest + theme-color
- `.gitignore` — target Rust, .env
- `src/App.tsx` — hook autoguardado + `useKeyboardShortcuts()`
- `src/components/TopBar.tsx` — I/O + Lucide
- `src/components/Toolbar.tsx` *(v1.2)* — botón Papelera con badge, modo `erase` real, tooltips de atajos correctos
- `src/geo/metrics.ts` — Turf.js (sustituyó `ol/sphere`)
- `src/map/Map.tsx` *(v1.2)* — `Select`/`Modify`/`Translate` oficiales de OL, indicador de snap unificado, `WebGLVectorLayer` para drawSource
- `src/map/advancedSnap.ts` — parallel + intersection (5 tipos totales)
- `src/map/demoDataset.ts` *(v1.2)* — `SpatialIndex` ahora R-Tree real con `rbush 4.x`
- `src/store/mapStore.ts` *(v1.2)* — acciones `deleteSelected` y `deleteFeatureById` con pushState
- `src/store/drawStore.ts` *(v1.2)* — modo `erase` agregado

### A.4 Configuración de herramientas

#### Vite (`vite.config.ts`)
```typescript
resolve: { alias: { '@': path.resolve(__dirname, './src') } }
worker: { format: 'es' }   // Web Workers como ES modules
base: process.env.VITE_BASE_PATH || '/'
```

#### TypeScript (`tsconfig.json`)
```json
"moduleResolution": "Bundler",
"paths": { "@/*": ["src/*"] }
```

#### ESLint (`eslint.config.js`)
- Flat config (ESLint 10)
- TypeScript recommended + react-hooks + react-refresh
- Prettier como última capa (sin conflictos)
- Ignora: `dist/`, `src-tauri/target/`, `node_modules/`

#### Prettier (`.prettierrc`)
- Comillas simples, semicolons, trailing comma ES5, printWidth 100

#### shadcn/ui (`components.json`)
- Estilo `default`, icon library `lucide`
- Aliases: `@/components`, `@/lib/utils`, `@/components/ui`
- Para agregar más: `npx shadcn@latest add dialog dropdown-menu`

#### Tailwind (`tailwind.config.cjs`)
- `darkMode: ['class']`
- Tokens de color shadcn (background, foreground, primary, etc.)
- Plugin `tailwindcss-animate`

### A.5 Detalle del worker JSTS (`src/workers/geoOperations.ts`)

```
Main thread                    Worker thread
─────────────                  ─────────────
geoWorkerClient.ts  ──post──►  geoWorker.ts
       ▲                              │
       └──────── message ─────────────┘
                              geoOperations.ts
```

| Request | Response | Descripción |
|---|---|---|
| `{ type: 'union', features }` | `{ type: 'union', result }` | Unión topológica de polígonos (JSTS `OverlayOp.union`) |
| `{ type: 'validate', features }` | `{ type: 'validate', valid, issues }` | Valida geometrías (`geom.isValid()` + `getValidationError()`) |

**Uso desde código:**
```typescript
import { unionPolygonsInWorker, validateTopologyInWorker } from '@/workers/geoWorkerClient';

const merged = await unionPolygonsInWorker(featureCollection);
const { valid, issues } = await validateTopologyInWorker(featureCollection);
```

### A.6 Detalle de acotamiento (`src/geo/metrics.ts`)

**Cambio principal:** reemplazo de `ol/sphere.getArea/getLength` por `@turf/turf`.

| Función | Descripción |
|---|---|
| `calculateFeatureMetrics(feature)` | Calcula área (m²), perímetro (m), longitud (m), segmentos y punto de etiqueta |
| `updateFeatureMetrics(feature)` | Escribe propiedades en el feature OL y dispara `changed()` |
| `refreshSourceMetrics(source)` | Recalcula todos los features de una capa |
| `formatMetricLength(m)` | Formato legible: `123.45 m` o `1.23 km` |
| `formatMetricArea(m²)` | Formato legible: `123.45 m²` o `1.23 ha` |
| `featureCollectionMetricsSummary(fc)` | Totales de área/longitud de una colección |

**Pipeline de proyección:**
1. Geometría OpenLayers (EPSG:3857) → GeoJSON WGS84 vía `ol/format/GeoJSON`
2. Cálculos Turf en grados/metros geodésicos
3. Punto de etiqueta reproyectado a EPSG:3857 para renderizado

**Trigger:** `Map.tsx` invoca `updateFeatureMetrics` en `drawend` y `modifyend`. `styleFactory.ts` lee las propiedades para pintar etiquetas CAD con LOD (`canShowMainLabel = selected || zoom >= 17 || screenArea >= 5200`).

### A.7 Detalle de snapping avanzado (`src/map/advancedSnap.ts`)

Tipos de snap detectados (radio de tolerancia: **5 m**):

| Tipo | Color | Descripción |
|---|---|---|
| `vertex` | `#00d4ff` | Vértice existente |
| `midpoint` | `#10b981` | Punto medio de segmento |
| `perpendicular` | `#f59e0b` | Pie perpendicular sobre segmento |
| `parallel` | `#7c3aed` | Proyección sobre línea paralela al segmento |
| `intersection` | `#ef4444` | Intersección entre dos segmentos |

**API:**
- `findSnap(cursor, source, tolerance?)` → `{ point, type, feature } | null`
- `createSnapPoints(source)` → `VectorSource` con puntos medios para Snap nativo OL
- `SNAP_COLORS` → mapa tipo → color

### A.8 Detalle de PWA (`public/manifest.json`)

| Campo | Valor |
|---|---|
| `name` | GeoUrban |
| `display` | standalone |
| `theme_color` | `#00d4ff` |
| `background_color` | `#0d1117` |
| `lang` | `es` |
| Iconos | 192×192, 512×512 — **deben copiarse desde `src-tauri/icons/` (bug crítico #2)** |

### A.9 Detalle de CI/CD (`.github/workflows/`)

#### `deploy-pages.yml` (preexistente)
- Trigger: push a `main`
- Build con `VITE_BASE_PATH=/geourban/`
- Deploy a GitHub Pages

#### `release-tauri.yml` (nuevo)
- Trigger: tags `v*` o manual (`workflow_dispatch`)
- Matrix: Linux, Windows, macOS
- Pasos: Node 22 → Rust stable → `npm ci` → `npm run build` → `tauri-action`
- Crea GitHub Release draft con instaladores

**Uso:**
```bash
git tag v0.1.0
git push origin v0.1.0
```

### A.10 Tauri v2 (`src-tauri/`)

| Campo (`tauri.conf.json`) | Valor |
|---|---|
| `identifier` | `com.geourban.app` |
| `productName` | `geourban` |
| Ventana | 1400×900, redimensionable |
| `frontendDist` | `../dist` |
| `devUrl` | `http://localhost:5173` |
| `beforeDevCommand` | `npm run dev` |
| `beforeBuildCommand` | `npm run build` |

**Requisitos para build nativo:**
1. [Rust](https://rustup.rs/) instalado
2. Dependencias de sistema según SO (WebView2 en Windows)
3. `npm run tauri:build` — *no verificado en CI local (riesgo #11)*

**Pendiente Fase 8 (ver sección 5.8):**
- `tauri-plugin-dialog` — diálogos nativos abrir/guardar
- `tauri-plugin-fs` — acceso filesystem sin limitaciones del browser
- `tauri-plugin-updater` — auto-actualizaciones
- Reemplazar `URL.createObjectURL` en `io/index.ts` por APIs nativas de Tauri
