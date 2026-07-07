# GeoUrban — Stack Tecnológico y Plan de Implementación
### Documento de arquitectura técnica — v1.0 (julio 2026)

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

### Fase 0 — Setup (3-5 días)
- Repo, Vite + React + TS, ESLint/Prettier, Tailwind, Zustand.
- Integración base de OpenLayers con un mapa base simple.
- CI básico: build + deploy a GitHub Pages.

### Fase 1 — Motor de navegación y visualización (1.5-2 semanas)
- `WebGLVectorLayer` con dataset sintético de 10.000 polígonos para probar rendimiento real desde el día 1 (esto es lo que más impacto tiene después, mejor validarlo temprano).
- Zoom, pan, centrar vista, selector de mapa base (con al menos 2 proveedores para no depender de uno solo).
- Panel de capas (activar/desactivar).

### Fase 2 — Dibujo básico + snapping (2 semanas)
- `Draw` de polígonos y líneas.
- `Snap` nativo (vértice/borde) + primeras extensiones de snapping propio (punto medio, perpendicular).
- Selección y edición de vértices (`Modify`).
- Undo/redo con Zustand+Immer.

### Fase 3 — Acotamiento automático (1 semana)
- Cálculo de área/perímetro/distancias con Turf en cada edición.
- Renderizado de etiquetas de cota sobre el mapa (estilo tipo CAD).

### Fase 4 — Subdivisión y fusión (el núcleo del producto, 3-4 semanas)
- Subdivisión por grilla regular.
- Subdivisión proporcional por área/n° de lotes.
- Subdivisión manual asistida con snap a bordes del polígono padre.
- Fusión de polígonos colindantes (union topológico con JSTS) + recálculo de cotas.
- Validación de topología (sin superposiciones, sin huecos no intencionales).
- Todo corriendo en Web Worker para no trabar la UI en proyectos grandes.

### Fase 5 — Trazado de calles/avenidas (1 semana)
- Reutiliza el motor de líneas de la Fase 2 con estilos y snapping propios de vialidad (ancho de calle, ejes).

### Fase 6 — Import/Export de formatos (2-3 semanas)
- KML/KMZ (más simple, hacerlo primero).
- SHP (lectura y escritura).
- GPKG vía sql.js.
- DXF (lectura y escritura), documentando la limitación de DWG.

### Fase 7 — Persistencia y formato de proyecto propio (1 semana)
- Autoguardado en IndexedDB.
- Exportar/importar `.geourban`.

### Fase 8 — Empaquetado Tauri + PWA (1-1.5 semanas)
- Configuración de Tauri v2 sobre el mismo frontend.
- Manifest de PWA instalable para la versión web.
- Diálogos nativos de abrir/guardar archivo vía Tauri.
- GitHub Actions: pipeline de build multiplataforma + releases.

### Fase 9 — Pulido, QA y performance final (2 semanas)
- Pruebas de carga con datasets reales cercanos a 10.000 lotes.
- Ajuste fino de hit-detection y LOD (nivel de detalle) en zooms muy alejados.
- Accesibilidad básica de UI, atajos de teclado tipo CAD.

**Total estimado: ~14-17 semanas (3.5-4 meses) para un MVP sólido y completo con todas las funcionalidades mínimas.** Se puede paralelizar Fases 4 y 6 si hay 2 devs, bajando el total a ~10-12 semanas.

---

## 6. Riesgos y advertencias técnicas a tener en cuenta

1. **DWG no es DXF.** No prometas soporte DWG nativo sin licenciar el SDK de ODA; es la trampa más común en este tipo de proyectos.
2. **Google Maps tiene términos de uso estrictos** sobre sus tiles fuera del SDK oficial. Usá su API oficial (Maps JavaScript API / Map Tiles API) o tené un mapa base alternativo como opción real, no solo de respaldo.
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

### Nota final
Este plan asume MVP funcional con las 8 funcionalidades mínimas. Cosas como colaboración multiusuario en tiempo real, capas WMS/WFS de servidores externos, o reportes PDF de planimetría quedan fuera de alcance de "sin backend" — si en el futuro las necesitás, ahí sí conviene evaluar sumar un backend liviano (eso ya sería una v2, no parte de este documento).
