# Auditoría de Arquitectura — Motor GIS "GeoUrban"

### Diagnóstico, veredicto y hoja de ruta hacia rendimiento de clase catastro-masivo

**Autor:** Revisión técnica senior (arquitectura GIS desktop)
**Alcance:** Auditoría del repositorio real (`geourban`), no de una descripción abstracta del stack.

---

## 0. Antes de nada: tu "stack actual" no es el que describís

Lo primero que tengo que decirte, porque cambia todo el diagnóstico: **`deck.gl` no está en tu `package.json`, y `MapLibre GL` tampoco**. Lo que hay en el repo es:

- `ol` (OpenLayers 10) como motor de mapa e interacción.
- Un renderer WebGL **artesanal**, propio, construido sobre `ol/layer/WebGLVector` (`src/map/scene/DrawLayerRenderer.ts`), no deck.gl.
- Un pipeline de **Canvas2D en postrender** (`src/map/scene/PostrenderPainter.ts` + 6 "painters" especializados) para todo lo que WebGL no cubre: cotas, calles, rotondas, snap guides, selección pulsante, previews de subdivisión.
- Web Workers con **JSTS** (puerto JS de una librería Java) y **polygon-clipping** (puro JS) para booleanas y uniones.
- Un **Command pattern** con undo/redo propio, bastante más sofisticado que lo que se ve en proyectos GIS típicos.
- `sql.js`, `dexie` y `@tauri-apps/plugin-sql` como dependencias — pero **no hay una sola línea de persistencia real de proyecto visible en el código**. No existe un `save project` / `load project`. Esto es un agujero, no un detalle.

Esto importa porque tu pregunta ("¿deck.gl + MapLibre o Rust?") parte de una premisa incorrecta. Lo que tenés hoy **no es un stack "genérico de mapas"** — es un **motor CAD/GIS de edición vectorial vivo**, con snapping avanzado (10 tipos de snap con histéresis anti-parpadeo), undo/redo transaccional, recálculo incremental de red vial, reconciliación de fragmentos entre ediciones, y un motor de subdivisión de lotes con 4 algoritmos propios. Eso es mucho más difícil de construir que un visor de mapas, y ya está construido. El error de un arquitecto junior acá sería tirarlo por la ventana para perseguir un logo de moda. No lo vamos a hacer.

---

## 1. Lo que funciona — no lo toques

Un diagnóstico serio empieza reconociendo qué NO está roto, porque el 80% del "cámbialo todo" que te va a proponer cualquier respuesta genérica destruiría trabajo que ya está bien resuelto.

**1.1 — El motor de interacción/edición (OpenLayers como capa de interacción)**
`safeTranslate.ts`, `advancedSnap.ts`, `RotateLotsInteraction.ts`, `HitTestSelect.ts`, `LassoSelection.ts`, `roadNetworkEngine.ts` (offset de polilíneas con límite de miter propio). Esto es tooling de nivel CAD real: snapping con prioridad por tipo (`SNAP_TYPE_PRIORITY`), tolerancia por tipo (`TYPE_TOLERANCE_FACTOR`), histéresis (`applySticky`) para que el snap no "parpadee" cuando el cursor está en el límite. Migrar esto a MapLibre significaría **reescribir de cero 3.000+ líneas de lógica de interacción** que hoy funcionan, para ganar... nada, porque MapLibre no tiene ni pretende tener un framework de edición vectorial. MapLibre es un renderer de basemap/tiles, no un editor. Es la herramienta equivocada para el 70% de lo que tu app hace.

**1.2 — El pipeline de recómputo incremental de manzanos** (`src/geo/recomputeManzanos.ts`)
Esto es, honestamente, la parte más impresionante del código. No recalculás todo el proyecto en cada edición de calle: usás _fingerprinting_ por elemento vial (`streetFingerprint`, `roundaboutFingerprint`) para detectar exactamente qué segmentos cambiaron, filtrás las parcelas afectadas por intersección de extent (`changedExtent`), y reconciliás fragmentos nuevos contra manzanos existentes por **área de solapamiento** (`matchFragmentsToMembers`) para preservar identidad (id, lotes hijos, método de subdivisión) a través de ediciones. Esto es exactamente el patrón correcto para escalar edición interactiva sobre datasets grandes. No lo reinventes — solo hay que sacarlo de JS/JSTS y ponerlo en un runtime más rápido (ver §4).

**1.3 — El renderer WebGL por capas (mirror sources)**
`LayeredWebglRenderer` en `DrawLayerRenderer.ts`. La técnica de "espejar" cada feature a un `VectorSource` por capa (`mirrors: Map<string, MirrorEntry>`) para poder tener z-order y estilo por capa dentro del modelo de OL, con `WeakMap` de ubicación para mover features entre mirrors sin duplicar geometría, y **gating de `setStyle()` por firma** (`layerSignature`) para no recompilar shaders en cada tick del store — es una solución elegante a un problema real (OL no te deja expresar "z-order + estilo por capa" nativamente en un solo layer WebGL fácilmente). Consciente, deliberada, bien hecha.

**1.4 — Los detalles finos que solo un equipo senior deja en el código**

- `rafThrottle` usado consistentemente (cursor, índice espacial, cursor coords).
- `SelectionHighlightPainter` limitando su propio loop de pulso a 24fps explícitamente (`PULSE_RENDER_FPS = 24`) — _"no necesita 60fps para verse fluido; así se ahorra CPU/GPU"_ dice el comentario. Correcto. No tocar.
- Coalescing de comandos con ventana de 250ms y `coalesceKey` para que un drag de 200 eventos de mouse genere **un** entry de undo, no 200.
- `MAX_STACK_BYTES` con estimación de memoria por comando para podar el stack de undo.

---

## 2. Los cuellos de botella reales — con evidencia, no intuición

Acá está lo que realmente te va a matar a la escala que decís que necesitás (1M+ habitantes, <500ms de carga, 60fps constantes). No son los sospechosos habituales genéricos — son problemas específicos que encontré leyendo tu código.

### 2.1 — CRÍTICO: el undo/redo de calles serializa el proyecto ENTERO en cada edición

Mirá `src/commands/core/drawSourceSnapshot.ts` y cómo lo usan `AddStreetCommand.ts` / `AddRoundaboutCommand.ts`:

```ts
export function snapshotDrawSource(source: VectorSource): DrawSourceSnapshot {
  return geoJsonFormat.writeFeatures(source.getFeatures(), { featureProjection: 'EPSG:3857' });
}
```

Cada vez que el usuario traza **una sola calle**, el comando serializa **todas las features del proyecto** a GeoJSON, dos veces (antes y después). En un proyecto con 50.000 lotes, eso son dos `JSON.stringify` de un objeto masivo, en el hilo principal, en cada trazo de calle. Esto no es un detalle — es un muro de rendimiento que se activa exactamente en el flujo de trabajo más común de tu app (trazar vías). El `MAX_STACK_BYTES` (24MB) que limita el stack de undo es, de hecho, una admisión implícita de que este patrón genera snapshots pesados.

**Esto rompe tu requisito de "sin jank, sin delays perceptibles" de forma directa y medible.**

### 2.2 — El motor de geometría corre en JS puro, interpretado, en el hilo del navegador

`src/workers/geoOperations.ts` usa **JSTS** (`GeoJSONReader`, `OverlayOp.difference`) y **polygon-clipping** para:

- Unión de red vial (`robustUnionRoadNetwork`, con precisión redondeada a 1e6 y reintentos de auto-limpieza en cascada cuando la unión falla — señal de que la geometría booleana en JS es frágil).
- Diferencia parcela-menos-vías (`computeManzanos`).
- El motor de subdivisión completo (`subdivisionAlgorithms.ts`, `subdivisionCabeceraCuerpo.ts`) con búsquedas por bisección de hasta 160-200 iteraciones, cada una llamando `clipToStrip`/`polyArea` sobre el polígono completo.
- `matchFragmentsToMembers` — intersección de área par a par entre fragmentos y miembros, con advertencia propia en el código si supera 20.000 pares (`MATCH_COMPLEXITY_WARNING`).

JSTS es un puerto directo de una librería Java de 2003, sin las optimizaciones de memoria de GEOS (C++) ni acceso a SIMD. `polygon-clipping` es puro JS sin aceleración nativa. Están corriendo en Web Workers — bien, eso saca el trabajo del hilo de render — pero siguen siendo **JS interpretado haciendo aritmética de punto flotante intensiva**, y ya tenés en el código mensajes de `console.warn` propios avisando cuando esto tarda más de 300ms (`UNION_TIME_WARNING_MS`) o cuando se aborta la unión por exceder `MAX_UNION_POINTS` (15.000) o `MAX_UNION_SHAPES` (800). **Tu propio código ya está confesando el límite de escala del motor actual.** A la escala de "ciudad de 1M de habitantes" (que implica cientos de miles de lotes y decenas de miles de segmentos de vía), estos límites se van a alcanzar en el uso normal, no en un caso extremo.

### 2.3 — Índice espacial: bien diseñado, mal sincronizado

`src/map/spatialIndex.ts` es un wrapper RBush correcto (bulk `load()`, `insert`/`remove`/`update` incrementales). Pero mirá esto en `PostrenderPainter.ts`:

```ts
if (index.size === 0 && all.length > 0) {
  if (import.meta.env.DEV) {
    console.warn(
      'PostrenderPainter: índice espacial vacío con N feature(s) presentes — reconstruyendo. Esto no debería pasar en uso normal...'
    );
  }
  index.load(all as unknown as Feature<Polygon>[]);
}
```

Este es un **parche defensivo para una condición de carrera que el propio equipo detectó y no resolvió de raíz** (probablemente orden de `subscribe` vs. carga inicial entre `Map.tsx` y quien sea que puebla `drawSource` al cargar un proyecto). Un self-healing silencioso en producción (fuera de DEV) esconde el síntoma. Con un backend Rust y un índice espacial nativo (`rstar`) que vive del lado del backend y se consulta por IPC, esta clase de race condition de sincronización cliente-índice desaparece estructuralmente, porque el índice deja de vivir en el mismo hilo que dispara los eventos de mutación de la fuente OL.

### 2.4 — El pipeline de etiquetas/cotas es Canvas2D puro, recalculado cada frame

`LabelPainter.ts`: `collisionGrid.clear()` y reconstrucción completa de la grilla de colisión **en cada llamada a `paint()`**, es decir, en cada frame de postrender no interactivo. Hay un sistema de LOD por umbral de cantidad de features (`LOD_TIER1_FEATURE_THRESHOLD = 350`, `LOD_TIER2_FEATURE_THRESHOLD = 900`) que **ya está degradando la experiencia a partir de 350 features visibles** ocultando cotas de segmento, y a partir de 900 ocultando etiquetas salvo que estén seleccionadas. Para una ciudad real con decenas de miles de lotes visibles en pantalla en un zoom-out moderado, este sistema ya está en su régimen degradado por diseño. Esto no es un bug — es el techo de lo que Canvas2D con recálculo de colisión por CPU puede sostener a 60fps. Necesitás el equivalente a lo que MapLibre/Mapbox GL hacen con sus symbol layers: colisión de etiquetas resuelta en un hilo aparte (o en GPU vía SDF), no recalculada por frame en el hilo principal.

### 2.5 — Transformaciones de proyección (CRS) por vértice, por edición

`src/geo/metrics.ts` — `projectPathToMetricPlane` llama `transform()` de proj4 **por cada punto**, y esto se dispara en `updateFeatureMetrics()` cada vez que se edita una geometría (incluyendo durante un drag de vértice, aunque ahí está mitigado por el throttle de 150ms en `useDrawSourceTick`). Para un manzano con esquinas redondeadas (los fillets de `ringFillet.ts` generan hasta ~17 puntos por esquina en giros de 180°), esto es una cantidad no trivial de llamadas a la pipeline completa de Transverse Mercator de proj4, repetidas en cada edición. Es corregible con álgebra simple (ver §6.1) sin tocar una sola línea de UI.

### 2.6 — Persistencia: no existe

`sql.js` (SQLite compilado a WASM, corriendo _dentro del navegador_) y `dexie` (wrapper de IndexedDB) como dependencias en una app **que corre en Tauri, con acceso a SQLite nativo vía `@tauri-apps/plugin-sql`**, es una contradicción de arquitectura. Estás pagando el costo de un motor SQL compilado a WASM en el hilo del navegador cuando tenés SQLite nativo a un `invoke()` de distancia. Y ninguno de los tres está siendo usado para lo que en teoría existen para hacer: no hay comando de guardar/cargar proyecto visible en ningún componente (`App.tsx` no lo tiene, no hay `ProjectFileMenu` ni equivalente). Con "carga instantánea <500ms" como requisito no negociable, este es el segundo agujero — junto con 2.1 — que hay que tapar primero, no al final.

> **Nota de estado (actualizado):** las Fases 0 y 1 del plan de implementación (§5) ya están completadas — instrumentación/línea base y persistencia nativa vía `rusqlite` respectivamente. §2.6 queda documentado como diagnóstico histórico; ver §5 para el estado real de `sql.js`/`dexie`.

---

## 3. Veredicto sobre tus dos apuestas

Pediste opinión seria, no "depende". Acá la tenés, sin cobertura.

### ✅ Rust como backend nativo — SÍ, y es la decisión correcta de mayor impacto que podés tomar

No como "un lindo agregado" sino como **reemplazo del motor de geometría completo**: JSTS, polygon-clipping, y toda la lógica de `subdivisionAlgorithms.ts`/`roadNetworkNet.ts`/`fragmentReconciliation.ts` deberían migrar a Rust, expuestos vía comandos de Tauri. Las razones concretas, no genéricas:

- Estás en Tauri, **no en un navegador puro**. El worker-based architecture actual (`interactiveWorker`/`batchWorker` en `geoWorkerClient.ts`) es, con altísima probabilidad, un artefacto de una etapa anterior del proyecto donde correr en navegador puro era un requisito (o de una decisión de portabilidad que ya no aplica dado que hoy tenés `src-tauri/`). Mantener el motor de geometría en JS cuando tenés un runtime nativo disponible es dejar sobre la mesa un salto de rendimiento de un orden de magnitud en las operaciones booleanas (unión/diferencia con GEOS vía el crate `geos`, que es la librería C++ madura que JSTS portó y quedó atrás — no hay comparación real de rendimiento entre ambas a la escala de miles de vértices).
- El motor de subdivisión (bisecciones, `clipToStrip`, todo `polygonEngine.ts`) es aritmética pura sin dependencias de DOM/React — es **exactamente** el tipo de código que se porta a Rust casi 1:1 y gana 10-30x de rendimiento solo por dejar de ser interpretado.
- El índice espacial puede vivir del lado Rust (`rstar`, R-tree con bulk-load STR igual que RBush pero nativo) y responder consultas de viewport/hit-test sin cruzar el límite JS en absoluto para las partes de solo-lectura.
- La persistencia (§2.6) se resuelve gratis una vez que tenés un backend Rust con SQLite nativo — es el mismo binario, no una pieza nueva de infraestructura.

### ❌ MapLibre GL — NO, y sugerirlo sería un error de arquitecto

MapLibre es un renderer de basemap/tiles vectoriales de solo lectura con un modelo de estilo declarativo (expresiones tipo Mapbox Style Spec). No tiene, ni pretende tener, un framework de **edición interactiva de geometría con undo/redo, snapping, vértices arrastrables y comandos transaccionales**. Todo lo que hoy resuelve OpenLayers en tu capa de interacción (§1.1) tendrías que reconstruirlo desde cero sobre MapLibre — y MapLibre no te da ni un punto de partida para eso, porque no es su dominio de problema. La única superficie donde MapLibre "ganaría" es el renderizado del mapa base (tiles), y ahí tu necesidad real es trivial: OSM/Google XYZ tiles y una grilla CAD generada por canvas — cosas que OpenLayers ya resuelve sin fricción (`baseMaps.ts`, `cadGridLayer.ts`). No hay problema que resolver ahí. Cambiar de motor de mapa para ganar cero funcionalidad y perder meses de trabajo de interacción ya construido es la clase de "cambio drástico" que un junior propone porque suena moderno, no porque el problema lo pida. Mi veredicto: **descartalo por completo.**

### deck.gl — ni lo tenés, ni lo necesitás

Como mencioné en §0, no está en tu stack real. Si en algún momento alguien te lo sugirió: deck.gl brilla en visualización de datos masivos de **solo lectura** (agregación GPU, binning, heatmaps sobre millones de puntos estáticos). Tu problema es edición vectorial interactiva con estado transaccional — el dominio opuesto. No lo sumes.

---

## 4. Arquitectura objetivo

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React + OpenLayers)                                       │
│  ─────────────────────────────                                       │
│  • Interacción y edición: Draw/Modify/Translate/Snap (OL) — SIN      │
│    CAMBIOS respecto a hoy. Es tu ventaja competitiva ya construida.  │
│  • Render base: WebGL mirror-per-layer (evolucionado, ver 4.2)       │
│  • Render "vivo" transitorio: Canvas2D (sketch de dibujo, snap       │
│    guides, gizmo de rotación, lasso) — SIN CAMBIOS, es correcto.     │
│  • Estado: Zustand (sin cambios) — la capa de UI está bien resuelta. │
│  • Cliente delgado hacia Rust vía Tauri `invoke` + eventos.          │
└───────────────────────────┬────────────────────────────────────────┘
                             │ IPC binario (bincode/postcard, NO JSON)
┌───────────────────────────▼────────────────────────────────────────┐
│  BACKEND NATIVO (Rust, dentro del mismo binario Tauri)                │
│  ────────────────────────────────────────────────────                │
│  • Motor de geometría: crate `geo` + `geos` (bindings a GEOS)         │
│    → reemplaza JSTS y polygon-clipping                                │
│  • Motor de subdivisión: port directo de subdivisionAlgorithms.ts     │
│  • Índice espacial: `rstar` (R-tree, bulk-load STR)                   │
│  • Recómputo incremental de red vial/manzanos: mismo algoritmo de     │
│    fingerprint+extent que hoy, pero en Rust con `rayon` para          │
│    paralelizar por parcela                                            │
│  • Persistencia: SQLite nativo vía `rusqlite`/`sqlx`, geometría en    │
│    WKB (no GeoJSON texto), con streaming de resultados grandes        │
│  • Progreso de operaciones largas: eventos Tauri (`app.emit`) en vez  │
│    de un store de progreso alimentado por postMessage                │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.1 — Qué cruza el límite JS↔Rust y qué no

Regla dura, no ambigua: **todo lo que sea agregado/batch sobre N features cruza a Rust vía `invoke`. Todo lo que sea feedback continuo de 60fps (posición de cursor, snap candidato bajo el mouse, gizmo arrastrándose) se queda en JS**, exactamente como hoy. El error que cometen equipos que migran a Rust a medias es meter _todo_ detrás de IPC, incluyendo cosas latencia-críticas — el roundtrip de IPC de Tauri, aunque rápido, no es gratis, y para un candidato de snap que se recalcula en cada `pointermove` querés cero cruces de proceso. Tu `advancedSnap.ts` actual, corriendo en JS contra un índice espacial **JS** local (no el de Rust) para el subconjunto visible en viewport, es correcto tal cual está — no lo migres.

### 4.2 — Evolución del renderer WebGL, no reemplazo

No tires `LayeredWebglRenderer`. Los cambios concretos:

1. **Presupuesto de capas físicas.** Si un proyecto tiene más de ~32 capas de usuario, dejá de crear un `WebGLVectorLayer` físico por capa y pasá a un modelo de N capas físicas con un atributo `layerColorId`/`layerZ` resuelto por expresión de estilo (el mismo patrón que ya usás para `colorIdx` de manzanos, generalizado). Esto evita agotar contextos/programas WebGL en proyectos grandes con muchas capas.
2. **Etiquetas/cotas a un pipeline separado con caché persistente.** Sacá el recálculo de `LabelPainter` de "cada frame" a "cada vez que cambia algo relevante en viewport" con un caché de layout invalidado por dirty-flag (ya tenés la primitiva — `metricsUpdatedAt` — solo falta usarla también para gatear la reconstrucción de la grilla de colisión, no solo el caché de área en pantalla).
3. **Índice espacial para culling de viewport consultado a Rust** cuando el dataset supera un umbral (configurable, p. ej. 50.000 features), con un caché local JS del resultado por viewport-hash para no repetir la consulta en paneos pequeños.

---

## 5. Plan de implementación por fases

Estimaciones para 1-2 ingenieros senior dedicados. Cada fase entrega algo funcional y medible — no hay una fase de "big bang" al final.

### Fase 0 — Instrumentación y línea base (1 semana) ✅ COMPLETADA

**Entregable:** el `DebugPanel.tsx` que ya tenés (FPS, features, tiempos de postrender) extendido con: tiempo de carga de proyecto, tamaño de snapshot de undo, tiempo de roundtrip de cada tipo de request al worker, memoria del heap de JS bajo carga sintética.
**Por qué primero:** no vas a poder demostrar que el 10x de Rust es real si no tenés el número de JS documentado con el mismo dataset sintético. Generá un dataset sintético de 100k/500k/1M lotes para usar en todas las fases siguientes como vara de medir.

### Fase 1 — Persistencia nativa (2-3 semanas) ✅ COMPLETADA

**Entregable:** comando de guardar/cargar proyecto funcionando end-to-end, esquema SQLite (tablas: `layers`, `features` con geometría en WKB + `kind` + propiedades JSON solo para lo no geométrico, `streets`, `roundabouts`), vía `rusqlite`. Elimina `sql.js` y `dexie` del `package.json`.
**Criterio de éxito:** cargar el dataset sintético de 500k features en menos de 500ms desde disco hasta `drawSource` poblado.

### Fase 2 — Motor de geometría en Rust (5-6 semanas, la fase más grande) — EN CURSO

Esta es la fase de mayor riesgo y mayor impacto del plan completo, así que conviene desglosarla en sub-fases con dependencias explícitas en vez de atacarla como un bloque monolítico. La regla de secuenciación es: **primero lo que no depende de una librería de booleanas (bajo riesgo, testeable con `cargo test` puro), después la capa que sí la necesita (alto riesgo, requiere fuzzing).** Cada sub-fase tiene su propio criterio de éxito verificable antes de pasar a la siguiente — nadie debería avanzar a 2.3 sin que 2.1 y 2.2 ya estén dando paridad numérica con JS.

#### 2.0 — Decisión de librería de booleanas + scaffolding del crate (3-4 días)

Antes de portar una sola línea, hay que resolver la pregunta que condiciona todo lo demás: **¿`geos` (bindings a GEOS C++) o el crate `geo` puro-Rust con sus boolean ops?**

- `geos` es más maduro/robusto en geometría degenerada (mismo motor que JSTS portó, pero nativo) — mayor fricción de build (necesita GEOS instalado o vendored) pero menos sorpresas de comportamiento.
- `geo` puro-Rust compila más simple y encaja mejor con Tauri cross-compile, pero sus boolean ops son más jóvenes que GEOS.

Dado que el código actual ya tiene mitigaciones propias contra fallos de `polygon-clipping` (los try/catch con auto-limpieza en cascada en `roadNetworkNet.ts` y `geoOperations.ts::robustUnionRoadNetwork`), la recomendación es `geos`, para no heredar esa fragilidad también en Rust. Esta decisión condiciona el diseño de 2.3, así que se toma acá, no después.

**Entregable:** crate `geourban-geo` dentro de `src-tauri/`, tipos compartidos (`Pt = (f64, f64)`, `LotResult`, etc. — mismo shape que `polygonEngine.ts`), y decisión de serialización IPC (arrancar con `serde` + JSON; migrar a bincode/postcard en 2.7 si el perfil lo pide — no optimizar la serialización antes de tener el motor portado).

#### 2.1 — Primitivas puras, sin booleanas (1 semana)

El bloque de menor riesgo de toda la Fase 2. Todo esto es aritmética cerrada, sin `polygon-clipping` ni JSTS de por medio. Se porta casi 1:1 y se testea con casos unitarios comparando output contra la versión JS:

- `src/geo/math/polygonEngine.ts` completo: `polyArea`, `centroid`, `convexHull`, `clipHalfPlane`, `clipToStrip`, `principalAxis`, `projectExtents`, `pointInPoly`, `segmentIntersectsPoly`, `buildCutPolys`.
- `src/geo/sanitizeRing.ts` / `sanitizeGeoJson.ts`: dedupe, colinealidad, área mínima. Importante portarlo temprano porque **todo lo demás depende de recibir anillos ya saneados** — dejarlo para el final duplicaría la lógica de limpieza en cada algoritmo posterior.
- `src/geo/roads/roadNetworkEngine.ts`: `offsetPolylineMiter`, `buildRing` (offset de polilíneas con límite de miter).
- `src/geo/roads/ringFillet.ts`: `roundRingReflex`, fillet/chamfer de esquinas.
- `src/geo/math/lod.ts`, `src/geo/roundabout/roundaboutEngine.ts`: geometría de rotondas, también pura.

**Criterio de éxito:** correr el mismo set de polígonos de prueba por ambos lados (JS y Rust) y que área/perímetro coincidan dentro de tolerancia. Nada de esto necesita `invoke` todavía — es una librería Rust standalone testeable con `cargo test` antes de exponer nada a Tauri.

#### 2.2 — Motor de subdivisión (1-1.5 semanas) — depende de 2.1

El corazón de tu motor y, buena noticia, **no toca JSTS ni polygon-clipping en absoluto** — `subdivisionCabeceraCuerpo.ts` resuelve sus propios clips por semiplano (`hbClipPolyHalf`) igual que `polygonEngine.ts`. Candidato ideal para portar segundo:

- `src/geo/subdivision/subdivisionAlgorithms.ts`: `subdivideManzanoAuto` (modo2/PCA), `subdivideManzanoExact`, `sliceBisectManzano` (manual-slice), y el dispatcher `subdivideManzano`/`subdivide`.
- `src/geo/subdivision/subdivisionCabeceraCuerpo.ts`: el algoritmo `auto` (cabecera+cuerpo), el más usado por default.

Con esto ya se pueden exponer **3 de los 6 tipos de request** del worker actual sin haber tocado la parte booleana: `subdivide`, `subdivideManzano`, `subdivideManzanoBatch`. Es un hito real y demostrable a mitad de la Fase 2, no un entregable parcial invisible.

**Criterio de éxito:** las 200 iteraciones de bisección de `subdivideHalf`/`computeCuts` dando el mismo resultado (mismo criterio de remanentes, mismo `frontM`/`depthM`) que hoy en JS, sobre manzanos reales del dataset sintético.

#### 2.3 — Capa de booleanas (1.5-2 semanas) — el bloque de mayor riesgo

Acá entra `geos`/`geo` en serio. Dos consumidores concretos:

- `unionRings` en `src/geo/roads/roadNetworkNet.ts` — reemplaza `polygonClipping.union`. Ojo con portar también la lógica de reintentos (`selfCleaned`, auto-limpieza por polígono individual cuando la unión directa falla) — no es cosmética, es la razón por la que la unión no explota con geometría real.
- `robustUnionRoadNetwork` + `computeManzanos` en `src/workers/geoOperations.ts` — reemplaza JSTS `OverlayOp.difference`. Esta es la pieza que hoy tiene el `console.warn` a los 300ms — el criterio de éxito de toda la Fase 2 (unión de 5.000 segmentos en <100ms) se decide acá.

También hay que portar los límites de seguridad ya existentes (`MAX_UNION_POINTS`, `MAX_UNION_SHAPES`, `UNION_TIME_WARNING_MS`) — no descartarlos pensando que "Rust es rápido, no van a hacer falta". Van a seguir haciendo falta como guardrail contra geometría patológica, solo que con umbrales más altos.

**Criterio de éxito:** unión de red vial con 5.000 segmentos de calle en menos de 100ms, sin regresión en los casos de auto-limpieza que hoy dispara `roadNetworkNet.ts` con geometría real.

#### 2.4 — Reconciliación de fragmentos (3-4 días) — depende de 2.3

`src/geo/roads/fragmentReconciliation.ts::matchFragmentsToMembers` usa `polygonClipping.intersection` para `ringIntersectionAreaRaw`. Se porta rápido una vez que 2.3 ya da intersección de anillos funcionando. Esto desbloquea los dos tipos de request que faltaban: `computeRoadNetworkNet` y `matchFragmentsBatch`.

**Criterio de éxito:** mismas asignaciones fragmento↔miembro (`MATCH_MIN_RATIO = 0.35`) que la versión JS sobre el corpus de reconciliación del dataset sintético.

#### 2.5 — Cableado de comandos Tauri + reemplazo de `geoWorkerClient.ts` (1 semana)

Con las 4 sub-fases anteriores ya está el motor completo compilando. Ahora:

- Comandos Tauri espejando 1:1 la firma de `computeManzanosInWorker`, `subdivideInWorker`, `subdivideManzanoInWorker`, `subdivideManzanoBatchInWorker`, `computeRoadNetworkNetInWorker`, `matchFragmentsBatchInWorker` — así los call-sites en `useManzanoActions.ts`, `RecomputeManzanoLotsCommand.ts`, `SubdivideCommand.ts`, etc. cambian solo el `import` y el `await`, no la lógica de negocio alrededor.
- El split interactive/batch worker de hoy (`INTERACTIVE_TYPES`, dos Workers separados para no bloquear el hilo interactivo con trabajo batch) se traduce a: comandos Tauri `async` + `rayon` para paralelizar internamente en Rust (por ejemplo `subdivideManzanoBatch` paralelizando por manzano). Ya no hacen falta dos "workers" separados — el runtime async de Tauri + un thread pool de Rayon da eso gratis.
- Mantener el timeout/retry pattern de `runWorker()` en el lado cliente (el manejo actual de `DEFAULT_WORKER_TIMEOUT_MS` con reject-all-pending) — sigue siendo válido como defensa contra un comando Rust que se cuelgue con geometría patológica.

**Criterio de éxito:** los 6 tipos de request funcionando end-to-end desde React sin cambiar lógica de negocio en los call-sites, solo el transporte.

#### 2.6 — Paridad y fuzzing (3-4 días, en paralelo con 2.5)

Correr el mismo corpus de geometría degenerada que hoy dispara `sanitizeRing.ts`/`recordGeometrySanitizeEvent` contra ambos motores y comparar resultados. Esto es lo que evita un bug sutil de redondeo o de orientación de anillo (CW vs CCW) que no aparece hasta producción.

**Criterio de éxito:** cero divergencias no explicadas entre JS y Rust sobre el corpus de fuzzing, o divergencias documentadas y aceptadas explícitamente (p. ej. tolerancia de punto flotante).

#### 2.7 — Validación de performance + limpieza (2-3 días)

Correr el criterio de éxito oficial de la Fase 2 (unión de red vial con 5.000 segmentos <100ms) con el instrumental de la Fase 0 ya construido (`DebugPanel.tsx`, `perfTelemetry.ts`). Si pasa: borrar `jsts`, `polygon-clipping`, `src/workers/geoWorker.ts` y `geoOperations.ts` del bundle JS.

**Criterio de éxito:** métrica oficial de Fase 2 confirmada + bundle JS liberado de las tres dependencias de geometría pesada.

---

**Orden de ejecución recomendado dentro de la Fase 2:** 2.0 → 2.1 → 2.2 (acá ya hay un hito demostrable sin haber tocado booleanas) → 2.3 → 2.4 → 2.5 → 2.6/2.7 en paralelo al cierre.

### Fase 3 — Undo/redo estructural (2 semanas)

**Entregable:** reemplazo de `snapshotDrawSource`/`restoreDrawSourceSnapshot` (GeoJSON completo) por diffs estructurales — reutilizando el mismo patrón que ya usa `ModifyGeometryCommand` (clonar solo las geometrías tocadas) extendido a `AddStreetCommand`/`AddRoundaboutCommand`, apoyado en el `changedExtent` que `recomputeManzanosImmediate` ya calcula para saber exactamente qué manzanos tocar.
**Criterio de éxito:** trazar una calle en un proyecto de 200.000 features no debe generar una asignación de memoria proporcional al tamaño total del proyecto.

### Fase 4 — Índice espacial y render a escala (3 semanas)

**Entregable:** `rstar` del lado Rust para culling de viewport en proyectos grandes, con fallback al RBush JS actual para proyectos chicos (no pagues el costo de IPC si el dataset entra cómodo en el hilo JS — esto es una decisión de umbral, no ambigüedad: medilo en Fase 0 y fijá el número). Rediseño del pipeline de `LabelPainter` con caché persistente por dirty-flag.
**Criterio de éxito:** 60fps sostenidos con 200.000 features en viewport a zoom urbano típico, medido con el instrumental de Fase 0.

### Fase 5 — CRS y métricas de alto rendimiento (1-2 semanas)

**Entregable:** linealización afín local de la proyección UTM activa (ver §6.1), reemplazando las llamadas por-vértice a `proj4.transform()` en el hot path de `updateFeatureMetrics`.
**Criterio de éxito:** recómputo de métricas de 10.000 features editadas en batch en menos de 50ms.

### Fase 6 — Endurecimiento y pruebas de estrés (2 semanas, continuo después)

Dataset sintético de 1M+ features, perfiles de memoria (objetivo <2GB confirmado con herramientas nativas, no estimado), fuzzing de geometría degenerada contra el nuevo motor Rust (reutilizando los mismos casos límite que hoy dispara `sanitizeRing.ts`).

**Total: ~16-17 semanas para la migración core**, con valor entregado incrementalmente desde la semana 3 (persistencia funcionando, ya completada, fue una mejora de UX enorme sobre "no existe").

---

## 6. Trucos de nivel senior (los que no vas a encontrar en un tutorial)

**6.1 — Linealización afín de la proyección UTM por proyecto**
UTM es casi lineal dentro del extent de un proyecto urbano (unos pocos km²). En vez de evaluar la serie completa de Transverse Mercator de proj4 por cada vértice en cada edición, calculá **una sola vez** (al fijar la zona UTM, o cuando el centro del proyecto se mueve significativamente) una matriz afín 2×2 + offset que aproxima la transformación dentro del bounding box del proyecto, y usá esa matriz para todo el trabajo por-vértice caliente (`getSegmentMetrics`, cálculo de área). Error subm-milimétrico a escala urbana, y un salto de rendimiento de uno o dos órdenes de magnitud frente a evaluar la proyección completa por punto. Esto es exactamente el mismo truco que usan los motores CAD georreferenciados profesionales para no pagar el costo de una proyección conforme completa en el hot path.

**6.2 — WKB, no GeoJSON, en cualquier límite de serialización**
GeoJSON de texto es humano-legible y pésimo para rendimiento: `JSON.parse`/`stringify` de arrays de coordenadas es lento y genera basura de GC proporcional al número de vértices. Cualquier cruce de límite (IPC Rust↔JS, almacenamiento en SQLite, snapshot de undo si alguna vez lo necesitás binario) debería usar WKB (Well-Known Binary) o, mejor aún, un layout de buffer plano (`Float64Array` de pares x/y con un índice de anillos) que se pueda mapear casi sin copia hacia las estructuras de OpenLayers.

**6.3 — Transferables, no clonado estructurado, mientras JS siga en el camino**
Mientras migrás por fases, un quick win de una tarde: `geoWorkerClient.ts` hoy hace `postMessage` de objetos anidados sin `transferList`, lo que fuerza una copia profunda estructurada en cada mensaje. Empaquetar las coordenadas como `Float64Array` y pasarlas con `transferList` elimina esa copia mientras el worker sigue vivo (útil como mitigación durante la Fase 2, antes de que el worker desaparezca del todo).

**6.4 — Bulk-load STR, no inserción incremental, para cargas grandes**
Tu RBush ya usa `load()` para carga masiva (correcto) — asegurate de que el equivalente en `rstar` (`RTree::bulk_load`) se use de la misma forma al hidratar un proyecto grande desde SQLite, no un loop de `insert()` uno por uno. La diferencia entre O(n log n) bulk-load y n inserciones incrementales es la diferencia entre milisegundos y segundos en 500k features.

**6.5 — Progreso vía eventos del backend, no polling de un store JS**
Tu `useGenerateLotsProgressStore` hoy se alimenta desde el hilo principal que orquesta chunks de 8 manzanos contra el worker. Cuando el trabajo pesado viva en Rust con `rayon`, emitilo como eventos Tauri (`app.emit("lots:progress", ...)`) consumidos con `listen()` en React — el backend informa su propio avance real en paralelo, en vez de que el frontend infiera el progreso trocenado artificialmente para poder mostrar una barra.

**6.6 — Preserva el patrón de "firma para gatear trabajo caro"**
Ya lo hacés bien en `LayeredWebglRenderer.layerSignature` (no llamar `setStyle()` — caro, recompila shaders — salvo que algo relevante cambió) y en `streetsHash`/`streetPairHash` de `StreetPainter.ts`. Generalizá explícitamente este patrón como norma de equipo: **antes de cualquier operación GPU o de recómputo geométrico caro, comparar una firma barata primero.** Es la diferencia entre un sistema que escala y uno que no, y ya tenés el instinto correcto en el código — falta aplicarlo de forma consistente (p. ej., en `LabelPainter`, donde falta, ver §2.4).

**6.7 — SDF (Signed Distance Fields) si algún día las badges de lote se vuelven el cuello de botella**
Si después de la Fase 4 seguís con presión de rendimiento en las miles de badges de número de lote/cotas, la técnica que usan MapLibre/Mapbox internamente para renderizar texto a 60fps con miles de labels es un atlas de glifos SDF renderizado como sprites WebGL instanciados, no `fillText` de Canvas2D por label. Es una pieza de trabajo no trivial (generación de atlas, shader de SDF) — no la hagas antes de necesitarla, pero sabé que existe como el siguiente escalón si el caché de la Fase 4 no alcanza.

---

## 7. Lo que NO vas a hacer (anti-patrones a evitar activamente)

1. **No reescribas la capa de interacción de OpenLayers.** Es tu activo más valioso y menos reemplazable.
2. **No adoptes MapLibre.** Resuelve un problema que no tenés y no resuelve ninguno que sí tenés.
3. **No muevas todo detrás de IPC de Tauri sin distinguir hot-path de batch.** Vas a cambiar un cuello de botella de CPU por uno de latencia de IPC si sos indiscriminado.
4. **No sigas usando `sql.js`/`dexie` "porque ya están instalados".** Son redundancia arquitectónica activa en un contexto Tauri con SQLite nativo disponible — cada semana que pasan sin usarse es deuda que alguien va a tener que justificar o borrar.
5. **No optimices el pipeline de labels/SDF (§6.7) antes de tener el dato de que lo necesitás.** Medí primero (Fase 0), después optimizá lo que el perfil real te diga, no lo que "suena" a cuello de botella.
6. **No parchees la race condition del índice espacial (§2.3) con más `console.warn`.** Arreglá el orden de inicialización de raíz; el auto-heal silencioso en producción es un bug disfrazado de feature.
7. **No avances de una sub-fase de la Fase 2 a la siguiente sin su criterio de éxito verificado.** En particular, no empieces 2.3 (booleanas) sin que 2.1/2.2 ya tengan paridad numérica confirmada contra JS — es la sub-fase de mayor riesgo y necesita una base sólida debajo.

---

## 8. Cómo vas a saber que funcionó

Criterios binarios, medidos con el instrumental de la Fase 0, sobre el dataset sintético de 1M features — no "se siente más rápido":

| Métrica                                     | Hoy (estimado por evidencia de código)                    | Objetivo post-migración               |
| ------------------------------------------- | --------------------------------------------------------- | ------------------------------------- |
| Carga de proyecto urbano completo           | Resuelto en Fase 1 ✅                                     | < 500ms                               |
| Trazar 1 calle en proyecto de 200k features | O(n) por snapshot GeoJSON completo                        | O(cambios reales), independiente de n |
| Unión de red vial, 5.000 segmentos          | Con warning propio a partir de 300ms hoy en casos menores | < 100ms                               |
| FPS con 200k features en viewport           | Degradado por diseño desde 350-900 features (LOD tiers)   | 60fps sostenidos                      |
| Memoria con dataset de 1M features          | Sin medir hoy                                             | < 2GB confirmado con profiler nativo  |
| Motor de geometría                          | JSTS + polygon-clipping, JS interpretado                  | GEOS/`geo` nativo vía Rust            |

---

Esto es una hoja de ruta, no una promesa: cada fase (y, dentro de la Fase 2, cada sub-fase) tiene un criterio de éxito medible y un dataset sintético común, así que en ningún punto vas a estar "confiando" en que la migración funcionó — lo vas a poder demostrar con el mismo panel de debug que ya empezaste a construir.
