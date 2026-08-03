# Auditoría de Arquitectura — Motor GIS "GeoUrban"

### Diagnóstico, veredicto y hoja de ruta hacia rendimiento de clase catastro-masivo

**Autor:** Revisión técnica senior (arquitectura GIS desktop)
**Alcance:** Auditoría del repositorio real (`geourban`), no de una descripción abstracta del stack.
**Revisión:** 1 de agosto de 2026 — actualización de estado contra el código actual del repo (no contra lo que el documento original _asumía_ que se había hecho).

> **Cómo leer este documento:** es la misma auditoría original, con cuatro cambios: (1) cada fase tiene ahora su estado real verificado línea por línea contra el código, no una casilla optimista; (2) las Fases 3 a 6 quedan desglosadas en sub-fases con el mismo nivel de detalle que ya tenía la Fase 2; (3) se agrega una sección nueva (§5) con los bugs y la deuda técnica que esta revisión encontró leyendo el código — incluido uno que la auditoría original ya había señalado y que quedó **resuelto en código (2-ago-2026)**; (4) **actualización del 1-ago-2026 (cierre de Fase 2)**: las Fases 2.0 a 2.7 quedaron **cerradas y verificadas** — paridad de subdivisión, booleanas GEOS activas, reconciliación de fragmentos, cableado Tauri completo, fuzzing (TS 236 casos + Rust con timeout) y el **retiro del motor JS** (2.7) tras validar el A/B en la app real con datos de producción; (5) **actualización del 2-ago-2026 (cierre de Fase 3)**: Fase 3 completa con medición de regresión (3.4) que cumple el criterio (ratio undo/snapshot 0.47% @ 500k), y el bug del índice espacial (§5.1) verificado como resuelto en código. Los estados que figuran en este documento reflejan ese estado final, con el detalle de cada cambio en §6 y las consecuencias para la deuda pendiente en §5 y §7.

---

## 0. Antes de nada: tu "stack actual" no es el que describís

_(Sin cambios respecto a la versión original — este diagnóstico de partida sigue siendo válido.)_

Lo primero que tengo que decirte, porque cambia todo el diagnóstico: **`deck.gl` no está en tu `package.json`, y `MapLibre GL` tampoco**. Lo que hay en el repo es:

- `ol` (OpenLayers 10) como motor de mapa e interacción.
- Un renderer WebGL **artesanal**, propio, construido sobre `ol/layer/WebGLVector` (`src/map/scene/DrawLayerRenderer.ts`), no deck.gl.
- Un pipeline de **Canvas2D en postrender** (`src/map/scene/PostrenderPainter.ts` + 6 "painters" especializados) para todo lo que WebGL no cubre: cotas, calles, rotondas, snap guides, selección pulsante, previews de subdivisión.
- Web Workers con **JSTS** (puerto JS de una librería Java) y **polygon-clipping** (puro JS) para booleanas y uniones. **Actualizado el 1-ago-2026 (cierre de Fase 2):** esto **ya no existe en el repo** — el motor Rust es la **vía única** desde la Fase 2.7 (worker, algoritmos, dependencias y tests JS eliminados; ver §6, Fase 2.7).
- Un **Command pattern** con undo/redo propio, bastante más sofisticado que lo que se ve en proyectos GIS típicos.
- Persistencia nativa vía `rusqlite` (esto sí cambió desde la versión original del documento — ver Fase 1, ya completada).

Esto importa porque tu pregunta original ("¿deck.gl + MapLibre o Rust?") partía de una premisa incorrecta. Lo que tenés **no es un stack "genérico de mapas"** — es un **motor CAD/GIS de edición vectorial vivo**. El veredicto de la auditoría original (Rust sí, MapLibre no) sigue siendo correcto y esta revisión no le encuentra motivos para cambiarlo. **Actualizado el 1-ago-2026 (cierre de Fase 2):** el motor Rust quedó conectado, validado en producción (A/B nativo vs JS: 0 mismatches, 0 fallbacks) y el JS fue **retirado** — la transición de producción que esta revisión señalaba quedó **completa**. Ver §2.2, §6, Fase 2.5/2.7.

---

## 1. Lo que funciona — no lo toques

_(Sin cambios — sigue siendo una descripción precisa de las partes sanas del código.)_

**1.1 — El motor de interacción/edición (OpenLayers como capa de interacción)**
`safeTranslate.ts`, `advancedSnap.ts`, `RotateLotsInteraction.ts`, `HitTestSelect.ts`, `LassoSelection.ts`, `roadNetworkEngine.ts`. Tooling de nivel CAD real. No migrar a MapLibre.

**1.2 — El pipeline de recómputo incremental de manzanos** (`src/geo/recomputeManzanos.ts`)
Sigue siendo la parte más impresionante del código: fingerprinting por elemento vial, filtrado por intersección de extent, reconciliación de fragmentos por área de solapamiento. No se tocó ni se rompió en el trabajo hecho hasta ahora.

**1.3 — El renderer WebGL por capas (mirror sources)**
`LayeredWebglRenderer` en `DrawLayerRenderer.ts`. Sigue intacto y sigue siendo la solución correcta.

**1.4 — Los detalles finos**
`rafThrottle`, el pulso de `SelectionHighlightPainter` limitado a 24fps, el coalescing de comandos con ventana de 250ms, `MAX_STACK_BYTES` con poda por memoria. Todo esto sigue en el código, sin regresiones detectadas en esta revisión.

---

## 2. Los cuellos de botella reales — estado actualizado

Misma numeración que el documento original, con el estado real de cada punto agregado.

### 2.1 — CRÍTICO: el undo/redo de calles serializa el proyecto ENTERO en cada edición

**Estado: ✅ RESUELTO (2-ago-2026, Fase 3.2).** `AddStreetCommand`/`AddRoundaboutCommand` ya no serializan el drawSource completo — `drawSourceSnapshot.ts` quedó deprecado y sin usos; el undo/redo de cada trazo usa el `StructuralDiff` (solo los manzanos/lotes afectados) que devuelve `recomputeManzanos()`. Detalle completo en §6, Fase 3. La medición de regresión (3.4) que faltaba quedó **ejecutada y con el criterio cumplido el 2-ago-2026** (benchmark en `src/geo/debug/undoRedoBenchmark.ts`, UI en `DebugPanel.tsx`): el undo de un trazo retiene **0.47%** del snapshot del proyecto entero con 500k features, y el ratio es **decreciente con n** (ver datos en §6, Fase 3.4).

### 2.2 — El motor de geometría corre en JS puro, interpretado, en el hilo del navegador

**Estado: ✅ RESUELTO EN SU TOTALIDAD (1-ago-2026, cierre de Fase 2).** El crate Rust (`geourban-geo`) ya no es código muerto: los seis tipos de request que resolvía `geoWorker.ts` tienen comando Tauri equivalente y el frontend los invoca **siempre** cuando corre en runtime Tauri (desde la Fase 2.7, sin flag y sin fallback):

- `subdivide` / `subdivide_manzano` / `subdivide_manzano_batch` (Fase 2.5.a)
- `compute_manzanos_cmd` / `compute_manzanos_batch` (Fase 2.5.b)
- `compute_road_network_net_cmd` / `match_fragments_batch` (Fase 2.5.c)

Todos registrados en `src-tauri/src/lib.rs` y consumidos desde `src/workers/geoWorkerClient.ts` como **vía única desde la Fase 2.7** (`requireNativeRuntime()` lanza error si no hay runtime Tauri — no existe reintento JS). Los nombres de los comandos se conservan idénticos al plan original de 2.5.a/2.5.b/2.5.c.

**Actualizado el 1-ago-2026 (cierre de 2.7):** lo pendiente de esta sección quedó **ejecutado en su totalidad** — la paridad se validó en la app real con datos de producción (A/B en sombra: 72+ comparaciones, 0 mismatches, 0 fallbacks; batch con A/B manual ON/OFF y resultados idénticos), el flag se apagó y `jsts`/`polygon-clipping` se retiraron de `package.json`, del worker y de los tests. El detalle completo está en §6, Fase 2.7, y la regresión post-retiro (tsc/lint/build/cargo 70 y 77 tests) en `reporte-fase-2-testing.md` §0.

### 2.3 — Índice espacial: bien diseñado, mal sincronizado

**Estado: ✅ RESUELTO (verificado 2-ago-2026).** Los dos arreglos que §5.1 pedía ya están en el código: `restoreDrawFeatures` (`src/store/map/mapStore.ts:120`) y `loadProject` (`src/persistence/projectFile.ts:187`) hacen `getOrCreateSpatialIndex().load(...)` explícito tras poblar `drawSource` en bulk, en vez de depender de los listeners incrementales `addfeature`. El fallback defensivo en `PostrenderPainter.getVisibleFeatures` sigue existiendo como red de seguridad, pero ahora reporta vía `recordGeometrySanitizeEvent('spatialIndex.emptyOnPostrender', ...)` (`src/map/scene/PostrenderPainter.ts:138`) **sin gate de `DEV`** — visible en producción a través del panel de debug (`readGeometryTelemetry()`). Si el contador `spatialIndex.emptyOnPostrender` se mantiene en 0 en uso real, confirma que la causa raíz (el desorden de montaje/listeners que el audit describía) ya no dispara. La verificación queda como ítem de la Fase 4.0.

### 2.4 — El pipeline de etiquetas/cotas es Canvas2D puro, recalculado cada frame

**Estado: SIN CAMBIOS.** `LabelPainter.ts` sigue reconstruyendo `collisionGrid` en cada `paint()`, y los umbrales de degradación (`LOD_TIER1_FEATURE_THRESHOLD = 350`, `LOD_TIER2_FEATURE_THRESHOLD = 900`) siguen siendo los mismos. Fase 4 no iniciada.

### 2.5 — Transformaciones de proyección (CRS) por vértice, por edición

**Estado: SIN CAMBIOS.** `projectPathToMetricPlane` en `src/geo/metrics.ts` sigue llamando `transform()` de proj4 por cada punto. Fase 5 no iniciada.

### 2.6 — Persistencia: no existía

**Estado: ✅ RESUELTO — Fase 1 completada y verificada.** Se confirmó contra el `package.json` actual que `sql.js` y `dexie` ya no están entre las dependencias, y que `src-tauri/src/project_store.rs` implementa guardado/carga real vía `rusqlite`, con geometría en WKB (`src/persistence/wkb.ts` del lado JS, tablas `layers`/`features`/`streets`/`roundabouts`/`project_meta` del lado Rust). Hay modales reales (`SaveProjectModal.tsx`, `OpenProjectModal.tsx`) conectados a `Ctrl+S`/`Ctrl+O`. Este punto de la auditoría original queda cerrado.

---

## 3. Veredicto sobre tus dos apuestas

_(Sin cambios en la recomendación — se confirma que fue la decisión correcta y que el trabajo hecho hasta ahora no la contradice.)_

### ✅ Rust como backend nativo — SÍ, confirmado como la decisión correcta

El trabajo hecho en Fase 2.0-2.5 (ver §6) confirma en la práctica lo que la auditoría original predecía: las primitivas geométricas, el motor de subdivisión y las booleanas se portan casi 1:1 a Rust sin fricción, con tests de paridad que dan coincidencia exacta contra el motor TS sobre los casos conocidos (incluida la fragmentación MultiPolygon de `computeManzanos`). No hay nada en el código nuevo que sugiera revertir esta decisión.

**Actualizado el 1-ago-2026:** la urgencia que esta revisión señalaba (terminar el cableado de la Fase 2.5 para no mantener dos implementaciones donde una no corre) quedó **resuelta** — el motor nativo está cableado y consumible, con paridad automatizada entre ambos lados. La urgencia se traslada, con la misma lógica, a la Fase 2.7: mientras el JS siga activo como fallback, el mantenimiento doble persiste; retirarlo después del A/B en la app real es lo que convierte el "beneficio potencial" en "beneficio medible". Ver §7, ítem "8" (actualizado).

### ❌ MapLibre GL — NO, sin cambios en el veredicto

_(Sin cambios — el razonamiento original sigue siendo válido: MapLibre no tiene ni pretende tener un framework de edición interactiva de geometría.)_

### deck.gl — ni lo tenés, ni lo necesitás

_(Sin cambios.)_

---

## 4. Arquitectura objetivo — estado de la implementación

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React + OpenLayers)                                       │
│  • Interacción y edición: OL — SIN CAMBIOS, como siempre.             │
│  • Render base WebGL / Canvas2D transitorio — SIN CAMBIOS.           │
│  • Estado: Zustand — SIN CAMBIOS.                                     │
│  • Cliente hacia Rust vía Tauri `invoke` (geoWorkerClient.ts,           │
│    motor nativo como vía única desde 2.7 — sin flag ni fallback JS):     │
│      - project_save/project_load/project_list/project_delete  ✅ USADO│
│      - geo_engine_version                                     ✅ USADO│
│      - subdivide / subdivide_manzano / subdivide_manzano_batch       │
│      - compute_manzanos_cmd / compute_manzanos_batch                  │
│      - compute_road_network_net_cmd / match_fragments_batch           │
│                                       ✅ EXISTEN Y SE INVOCAN (2.5-2.7, 1-ago-2026) │
│    → el JS (geoWorker.ts) fue retirado en 2.7; el Rust es la única vía.  │
└───────────────────────────┬────────────────────────────────────────┘
                             │ IPC (hoy: JSON vía serde_json; sin definir aún si se migra a binario)
┌───────────────────────────▼────────────────────────────────────────┐
│  BACKEND NATIVO (Rust, dentro del mismo binario Tauri)                │
│  • Persistencia SQLite nativa (rusqlite, WKB)              ✅ COMPLETO │
│  • Primitivas geométricas puras (math.rs, sanitize.rs,                │
│    roundabout.rs, roads.rs)                                ✅ COMPLETO │
│  • Motor de subdivisión (subdivision.rs, subdivision_cabecera_cuerpo. │
│    rs)                        ✅ PORTADO + PARIDAD VERIFICADA (2.2)   │
│  • Booleanas (boolean_ops.rs, union/difference vía GEOS)  ✅ ACTIVO,  │
│    con feature `geos-backend` por defecto + paridad contra JSTS (2.3) │
│  • Reconciliación de fragmentos (fragment_reconciliation.rs)          │
│                                             ✅ EXISTE + PARIDAD (2.4) │
│  • Índice espacial nativo (rstar)                           ❌ NO EXISTE│
└─────────────────────────────────────────────────────────────────────┘
```

**Lectura honesta del diagrama (actualizada 1-ago-2026, cierre de Fase 2):** la mitad inferior (backend Rust) está completa en el alcance de la Fase 2 — persistencia, primitivas, subdivisión, booleanas GEOS y reconciliación de fragmentos, con tests de paridad verdes (fixtures congelados, ver §5.3). La mitad superior (frontend) ya no tiene doble motor: `geoWorkerClient.ts` invoca Rust como vía única y la red de seguridad JS fue retirada en la Fase 2.7 tras validar el A/B en la app real. La Fase 2 está **cerrada en su totalidad**.

---

## 5. Hallazgos de esta revisión: bugs y deuda técnica

Esta sección es nueva respecto al documento original. Son hallazgos de lectura de código, no suposiciones.

### 5.1 — BUG activo: la reconstrucción silenciosa del índice espacial sigue sin arreglarse — ✅ RESUELTO (verificado 2-ago-2026)

**Estado actual:** los dos pasos concretos que esta sección proponía ya están implementados y verificados en el código:

1. **Carga explícita del índice en cada punto de entrada masivo** — ✅ HECHO: `restoreDrawFeatures` (`src/store/map/mapStore.ts:120`) y `loadProject` (`src/persistence/projectFile.ts:187`) llaman `getOrCreateSpatialIndex().load(features)` explícitamente después de poblar `drawSource`, con sanitización previa de geometrías no-finitas. Ya no se depende de que `addfeature` dispare `insert()` feature por feature (que además era más caro que `load()` bulk).
2. **Telemetría de producción en vez de `console.warn` de DEV** — ✅ HECHO: el fallback en `PostrenderPainter.getVisibleFeatures` (`src/map/scene/PostrenderPainter.ts:138`) ahora llama `recordGeometrySanitizeEvent('spatialIndex.emptyOnPostrender', { featureCount })` **fuera** del gate de `import.meta.env.DEV` (solo el `console.warn` queda gateado) — el evento es visible en `DebugPanel.tsx` vía `readGeometryTelemetry()`, y la sección "Saneo de geometría (últimos 60s)" lo muestra en uso real.

**Verificación pendiente (Fase 4.0):** si el contador `spatialIndex.emptyOnPostrender` se mantiene en 0 durante uso real con proyectos grandes, queda confirmado que la causa raíz (el desorden de montaje/listeners que se describe abajo) ya no dispara. Mantener el fallback defensivo como red de seguridad.

### 5.2 — El motor Rust existía pero estaba desconectado: riesgo de deuda duplicada — RESUELTO COMPLETO (1-ago-2026, cierre de Fase 2)

**Estado actual:** el riesgo estructural desapareció dos veces: la Fase 2.5 quedó cerrada (ver §6) con el motor nativo invocado desde `geoWorkerClient.ts`, y la Fase 2.7 (retiro del JS) eliminó la segunda implementación — los archivos `subdivisionCabeceraCuerpo.ts`, `geoOperations.ts`, `geoWorker.ts` y sus dependencias (`jsts`, `polygon-clipping`) ya **no existen en el repo**. Ya no hay dos implementaciones que mantener: hay **una sola**, Rust/GEOS, con los fixtures de paridad congelados como registro de la coincidencia verificada.

### 5.3 — Cobertura de tests del crate Rust — MAYORMENTE RESUELTA (1-ago-2026)

**Estado actual:** la cobertura dejó de ser desigual y el objeto de comparación ya no existe: los tests de paridad usan **fixtures congelados** (generados con `npm run parity:sync` durante la Fase 2.6, hoy con el motor JS retirado la regeneración ya no aplica — el script se eliminó junto con el motor). Verificado archivo por archivo:

| Archivo                          | Tests (1-ago-2026)                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `math.rs`                        | ✅ 19 tests unitarios (área, perímetro, centroide, hull, clip, proyección, casos degenerados)          |
| `types.rs`                       | ✅ 5 tests (serialización/formatos, kebab/lowercase alineados con TS)                                  |
| `geojson.rs`                     | ✅ 3 tests (roundtrip, array corto, Z)                                                                 |
| `boolean_ops.rs`                 | ✅ 2 smoke GEOS (unión/diferencia) + **paridad `parity_compute_manzanos.rs`** (5 fixtures, tolerancia 1e-2) |
| `roads.rs`                       | ✅ 13 tests (offset, fillet/chamfer, rings de red vial)                                                |
| `roundabout.rs`                  | ✅ 11 tests (anillo, ngon, isla, validación de params)                                                 |
| `sanitize.rs`                    | ✅ 10 tests (no-finitos, colineales, batch, degenerados)                                               |
| `subdivision.rs`                 | ✅ Paridad `parity_exact_modo2.rs` (10 fixtures exact/modo2) + dispatcher ejercitado por los demás     |
| `subdivision_cabecera_cuerpo.rs` | ✅ 2 smoke + **paridad `parity_cabecera_cuerpo.rs`** (5 fixtures auto)                                 |
| `fragment_reconciliation.rs`     | ✅ 4 tests unitarios + **paridad `parity_fragment_reconciliation.rs`** (6 fixtures, 1e-3)              |

**Total verificado (1-ago-2026, corrida final):** 66 unit tests sin feature + 4 con `geos-backend` (70), y 72 + 5 con la feature activa (77) — todo verde, incluyendo los tests de fuzzing con timeout. El criterio de éxito original de las Fases 2.1/2.2 ("mismo set de polígonos por ambos lados, coincidencia dentro de tolerancia") **quedó cumplido y luego superado**: el A/B en la app real (2.7) confirmó 0 mismatches en datos de producción, el fuzzing de la Fase 2.6 quedó completo (TS 236 casos + fuzz Rust) y el motor TS dejó de existir. Lo único pendiente de la cobertura es ampliar el corpus con geometrías del dataset sintético real (Fase 6.1).

### 5.4 — Reconciliación de fragmentos: no iniciada, y era la dependencia que bloqueaba el resto — RESUELTA (1-ago-2026)

`src/geo/roads/fragmentReconciliation.ts` (`matchFragmentsToMembers`, basado en `polygonClipping.intersection`) **ya tiene equivalente en el crate Rust**: `fragment_reconciliation.rs` implementa `match_fragments_to_members` (greedy por mejor solapamiento, `MATCH_MIN_RATIO = 0.35` — aritmética pura) y `ring_intersection_area` (intersección GEOS + área, el mismo patrón que `boolean_ops.rs`). Está expuesto como comando Tauri (`match_fragments_batch`), con 4 tests unitarios propios y **paridad de integración verde contra el TS** (6 fixtures en `parity_fragment_reconciliation.rs`, tolerancia 1e-3). Esto desbloqueó el cierre de las Fases 2.4 y 2.5.c que la revisión anterior señalaba como bloqueadas por esta pieza.

### 5.5 — Inconsistencia menor: dos funciones casi-idénticas de resolución de capa con semántica distinta

`src/store/ui/layerPickerStore.ts::requireLayerForKind` y `src/store/entities/layerAutoCreate.ts::resolveOrCreateLayerForKind` hacen lo mismo (resolver o crear una capa para un `kind` de feature) pero difieren en un detalle que puede ser intencional o puede ser un descuido:

- `requireLayerForKind` reutiliza la capa activa **sin verificar que su `kind` coincida** con el que se está pidiendo.
- `resolveOrCreateLayerForKind` sí exige `active.kind === kind` antes de reutilizarla.

Si es intencional (p. ej. "la capa activa es una elección explícita del usuario y debe ganar siempre"), documentarlo en el código evitaría que alguien "corrija" una de las dos funciones sin darse cuenta de que rompe la otra semántica en algún call site. Si no es intencional, el efecto práctico es que dibujar, por ejemplo, un polígono de "equipamiento" con una capa de tipo "lote" activa lo asigna silenciosamente a esa capa de lote. Prioridad baja, pero barata de aclarar.

### 5.6 — Nota menor de UI: `useDraggablePanel` no considera el tamaño del panel al acotar posición

`clamp()` en `src/hooks/useDraggablePanel.ts` acota la esquina superior-izquierda del panel a `[edgePadding, innerWidth - edgePadding]`, pero no resta el ancho/alto real del panel. En ventanas muy angostas (o paneles muy anchos) el panel puede quedar parcialmente fuera de la vista tras un resize. No relacionado con el motor de geometría — se documenta acá porque apareció en la revisión, prioridad cosmética.

---

## 6. Plan de implementación por fases — estado real y detalle ampliado

### Fase 0 — Instrumentación y línea base (1 semana) — ✅ COMPLETADA

Confirmado: `DebugPanel.tsx` con FPS, features, tiempos de postrender, memoria de heap, stats de worker roundtrip, y el generador de dataset sintético (`src/geo/debug/syntheticDataset.ts`, hoy solo genera lotes rectangulares en grilla — ver Fase 6.1 para su ampliación pendiente).

### Fase 1 — Persistencia nativa (2-3 semanas) — ✅ COMPLETADA

Confirmado contra `package.json` (sin `sql.js`/`dexie`) y `src-tauri/src/project_store.rs` (`rusqlite`, WKB, transaccional). `SaveProjectModal.tsx`/`OpenProjectModal.tsx` conectados a `Ctrl+S`/`Ctrl+O`. Sin pendientes conocidos en esta fase.

### Fase 2 — Motor de geometría en Rust — ✅ COMPLETA EN SU TOTALIDAD (1-ago-2026, 2.0 a 2.7)

**Estado:** las sub-fases 2.0 a 2.7 quedaron **todas** cerradas con tests verdes: fuzzing sistemático (2.6) y retiro del motor JS (2.7) incluidos. Detalle por sub-fase:

#### 2.0 — Decisión de librería + scaffolding — ✅ COMPLETADA

Crate `geourban-geo` creado, tipos compartidos definidos (`types.rs`), decisión tomada: GEOS vía crate `geos`, detrás de `geos-backend`. Comando de diagnóstico `geo_engine_version` cableado y funcional.

#### 2.1 — Primitivas puras, sin booleanas — ✅ COMPLETADA (cobertura de tests cerrada el 1-ago-2026)

`math.rs`, `sanitize.rs`, `roads.rs` (offset de polilíneas + fillet/chamfer), `roundabout.rs` portados. **La deuda de cobertura que señalaba la revisión anterior quedó saldada**: se agregaron tests unitarios a los tres archivos que no tenían (`sanitize.rs` 10, `roads.rs` 13, `roundabout.rs` 11), que se suman a los 19 de `math.rs`. Criterio de éxito original verificado.

#### 2.2 — Motor de subdivisión — ✅ PORTADO Y CON PARIDAD VERIFICADA (1-ago-2026)

`subdivision.rs` (`subdivideManzanoAuto`/`Exact`, `sliceBisectManzano`, dispatcher) y `subdivision_cabecera_cuerpo.rs` (el algoritmo `auto`) portados. **El criterio de éxito explícito que esta revisión agregó quedó cumplido**: existen tests de paridad automática TS ↔ Rust sobre manzanos reales de ejemplo:

- `parity_cabecera_cuerpo.rs` ↔ `subdivisionCabeceraCuerpo.parity.test.ts` — 5 fixtures del método `auto` (rectángulo 100×60, angosto 200×40, trapecio con `dirPref` X — el caso que destapó el bug del harness —, cuadrado 40×40, forma L con `dirPref` Y).
- `parity_exact_modo2.rs` ↔ `subdivisionExactModo2.parity.test.ts` — 10 fixtures (las 5 geometrías × métodos `exact` y `modo2`).

Tolerancia: área 1e-3 m², longitudes 1e-3 m, comparando `count`/`totalArea`/`bboxArea`/`remnantCount`/`areas[]`/`frontMs[]`/`depthMs[]`. **Matiz honesto:** el corpus son anillos de ejemplo representativos, no 20-30 manzanos del dataset sintético con calles/rotondas — esa ampliación sigue siendo deuda de la Fase 6.1, pero el mecanismo de paridad ya está montado y es ejecutable con cualquier anillo.

#### 2.3 — Capa de booleanas — ✅ ACTIVA Y CON PARIDAD (1-ago-2026)

`boolean_ops.rs` (union/difference vía GEOS) **compila y corre en el binario real**: la feature `geos-backend` quedó **activada por defecto** en `src-tauri/Cargo.toml`, y el build con GEOS real quedó validado (GEOS 3.14.1 estático vía vcpkg + pkgconf en Windows/MSVC; la resolución del crate `geos` quedó en 8.3.1, que requirió adaptar `boolean_ops.rs` a su API con lifetimes — `thread_local ContextHandle<'static>`). Los bloqueadores que esta revisión señalaba quedaron cerrados:

- ✅ Feature on por defecto + build validado con GEOS instalado (entorno real).
- ✅ **Paridad contra el JS con geometría representativa**: `parity_compute_manzanos.rs` ↔ `computeManzanos.parity.test.ts` — 5 fixtures de unión+diferencia sobre parcelas+calles, **incluida la fragmentación MultiPolygon** (`two_perpendicular_roads_grid`). Tolerancia deliberada de 1e-2 m² por redondeo de vértices de intersección entre JSTS y GEOS. **Pasó sin necesidad de afinar `UNION_PRECISION`** — si en el futuro ese test falla con diferencias > 1e-2, esa es la señal para tocar el snapping, no un fixture mal escrito.
- ✅ Además incluye `compute_road_network_net` (adelantado del orden original del plan, ver 2.3 en la revisión anterior).

#### 2.4 — Reconciliación de fragmentos — ✅ COMPLETADA (1-ago-2026)

Las tres sub-tareas de la revisión anterior quedaron hechas:

- **2.4.a** — `ring_intersection_area` en `boolean_ops.rs` usando GEOS `intersection()` + `area()` (mismo patrón que union/difference).
- **2.4.b** — `match_fragments_to_members` en `fragment_reconciliation.rs` (greedy por mejor solapamiento, `MATCH_MIN_RATIO = 0.35`).
- **2.4.c** — test de paridad sobre corpus de reconciliación real: `parity_fragment_reconciliation.rs` ↔ `fragmentReconciliation.parity.test.ts`, 6 fixtures (identidad, parcial, sin match, bajo umbral, multi-fragmentos, competencia), tolerancia 1e-3.

#### 2.5 — Cableado de comandos Tauri + reemplazo de `geoWorkerClient.ts` — ✅ COMPLETADA (1-ago-2026)

Los seis tipos de request que resolvía `geoWorker.ts` tienen comando Tauri registrado en `src-tauri/src/lib.rs` (`subdivide`, `subdivide_manzano`, `subdivide_manzano_batch`, `compute_manzanos_cmd`, `compute_manzanos_batch`, `compute_road_network_net_cmd`, `match_fragments_batch`). En el frontend, `geoWorkerClient.ts` los invoca **siempre en runtime Tauri** — desde la Fase 2.7 sin flag y sin fallback (`requireNativeRuntime()`). La secuencia interna que la revisión anterior sugería (2.5.a → 2.5.b → 2.5.c → 2.5.d) quedó ejecutada en su totalidad: los call-sites fueron reemplazados de a uno con A/B posible desde el panel de debug, y el A/B final (2.7) cerró el caso. **Nota de branches:** la versión web (sin Tauri) quedó congelada en el branch `web-version` con el motor JS intacto; `main` es desktop-only.

#### 2.6 — Paridad y fuzzing — ✅ COMPLETA (1-ago-2026)

La paridad contra snapshots TS quedó automatizada para los cuatro módulos del motor (auto, exact/modo2, fragmentos, computeManzanos) vía `npm run parity:sync` + `npm test` + `cargo test`, y el **fuzzing sistemático de geometría degenerada quedó hecho**: fuzz TS (236 casos reutilizando el corpus que dispara `sanitizeRing.ts`) + fuzz Rust con timeout (`fuzz_degenerate_geometry.rs`), 0 cuelgues, 0 fallos. Detalle completo en `reporte-fase-2-testing.md`. Lo único que queda de la cobertura es ampliar el corpus con geometrías del dataset sintético real (deuda de la Fase 6.1, ya no de la 2.6).

#### 2.7 — Validación de performance + limpieza — ✅ COMPLETA (1-ago-2026)

El A/B se validó en la app real con datos de producción: **72+ comparaciones en sombra con 0 mismatches y 0 fallbacks** (subdivisión, manzanos, calles, reconciliación), y el batch por A/B manual ON/OFF (`subdivideManzanoBatch`, `computeRoadNetworkNet`) dio resultados idénticos con el nativo ~7-22x más rápido (p.ej. batch 50 features: 14ms vs 108ms; red vial: 12ms vs 264ms). Con eso se retiró el motor JS: `jsts`/`polygon-clipping` fuera de `package.json` y del lockfile, 31 archivos eliminados (worker, algoritmos, diagnóstico, telemetría de sombra, fuzz/parity TS, `nativeEngineStore`), tipos movidos a `src/geo/subdivision/types.ts` y `src/geo/roads/types.ts`, `geoWorkerClient.ts` reescrito como vía única, `recomputeManzanos.ts` sin reintento JS, `DebugPanel` con sección estática nativa. Regresión post-retiro toda verde (tsc/lint/build, cargo 70 y 77 tests, CI `parity.yml` con `rust-parity` + fuzz; `deploy-pages.yml` solo para el branch `web-version`).

**Resumen de Fase 2 (1-ago-2026):** las tres piernas de la auditoría — "traducir el algoritmo" (2.0-2.4), "conectarlo al producto" (2.5) y "probarlo en producción y borrar lo viejo" (2.6 fuzzing + 2.7 limpieza) — están **completas y verificadas**.

---

### Fase 3 — Undo/redo estructural — ✅ COMPLETA (2-ago-2026): 3.0 a 3.4

**Estado real verificado leyendo el código (2-ago-2026):** esta fase NO estaba "no iniciada" como figuraba en revisiones anteriores — las sub-fases 3.0 a 3.3 estaban **implementadas y en producción** (la infraestructura vive en `src/commands/`), pero el trabajo nunca se documentó y faltaba la 3.4 (medición), que quedó cerrada el mismo día. Detalle por sub-fase:

- **3.0 — Prerrequisito (reusar el cómputo de manzanos afectados)** — ✅ **HECHO:** `recomputeManzanos()` (`src/geo/recomputeManzanos.ts`) devuelve un `StructuralDiff` en lugar de un snapshot: un `StructuralDiffRecorder` se alimenta dentro de `recomputeManzanosImmediate` (~20 call-sites de `recordAdd`/`recordRemove`/`recordModifyBefore`/`recordModifyAfter`), exactamente el mismo cómputo de grupos/extent afectados que la auditoría pedía reutilizar.
- **3.1 — Formato de diff** — ✅ **HECHO:** `src/commands/core/structuralDiff.ts` implementa el formato completo: `StructuralDiff { added, removed, modified }`, `StructuralDiffRecorder` (neto por id: add→remove y remove→re-add en la misma operación se anulan; modify repetido conserva el "antes" original), `composeStructuralDiffs` (permite coalescing correcto de N trazos de una sesión de dibujo), `applyStructuralDiffForward`/`revertStructuralDiff` (redo/undo) y `approxStructuralDiffBytes` (para el pruning del stack).
- **3.2 — Port de `AddStreetCommand`/`AddRoundaboutCommand`** — ✅ **HECHO:** ambos comandos (`src/commands/roads/`) ya no serializan el drawSource completo; su undo/redo usa el diff que devuelve `recomputeManzanos()`, con `coalesceInto` por sesión de trazo (`streetTracingSessionStore.currentSessionId` garantiza que trazos consecutivos NO se fusionen). `drawSourceSnapshot.ts` quedó **deprecado y sin usos** (verificado: ningún call-site activo de `snapshotDrawSource`/`restoreDrawSourceSnapshot` en el repo).
- **3.3 — Auditoría de call-sites** — ✅ **HECHO (auditado el 2-ago-2026, los 17 comandos):** ningún comando activo se apoya en snapshot completo:
  - *Proporcionales al cambio:* `SubdivideCommand` (snapshot solo del target + ids de lotes nuevos), `GenerateLotsCommand`/`RecomputeManzanoLotsCommand` (`removedLotSnapshots` por manzano tocado), `ModifyGeometryCommand` (before/after por feature), `DeleteFeaturesCommand` (features borrados, respetando capas bloqueadas), `RemoveLayerCommand` (features de la capa o reasignación por id), `DuplicateLayerCommand` (ids de los clones), `MoveFeaturesToLayerCommand`, `UpdateLayerCommand`, `ReorderLayersCommand`, `AddLayerCommand`, `AddFeatureCommand`.
  - *O(n) intencional y documentado:* `ClearFeaturesCommand` — su "cambio" ES el proyecto entero (semántica "Nuevo proyecto"), con `approxMemoryBytes()` real para que el pruning lo vea.
  - *Bonus 3.3:* los comandos pesados implementan `approxMemoryBytes()` real (antes el default de 256 bytes ocultaba el costo al `pruneStack` por bytes — `MAX_STACK_BYTES = 24 MB`), y `CommandStack.ts` (coalescing de 250 ms, `MAX_STACK = 100`) quedó completo y consumido desde StatusBar (`Undo2`/`Redo2`) y `Ctrl+Z`/`Ctrl+Shift+Z`.

- **3.4 — Medición de regresión** — ✅ **RESUELTO (2-ago-2026).** Benchmark `runStreetUndoBenchmarkSuite` (`src/geo/debug/undoRedoBenchmark.ts`) con UI en `DebugPanel.tsx` (sección "Benchmark Fase 3.4"). Reutiliza el generador sintético y el pipeline real: `AddStreetCommand` → `recomputeManzanos` → `StructuralDiff`, con una calle que cruza toda la grilla (toca ~√n manzanos). Resultados de la corrida (runtime Tauri):

  | Dataset | Undo (diff estructural) | Snapshot completo (baseline estimado) | Ratio | Tiempo de ejecución del comando |
  |---|---|---|---|---|
  | 10k features | 67.4 KB | 2,150.6 KB | 3.13% | 651 ms |
  | 100k features | 211.8 KB | 21,486.3 KB | 0.99% | 3,075 ms |
  | 500k features | 507.9 KB | 107,423.2 KB | 0.47% | 48,077 ms |

  **Criterio de éxito cumplido:** el ratio **cae con n** (3.13% → 0.99% → 0.47%) y los bytes del diff crecen **sub-linealmente** (×3.1 y ×2.4 cuando el dataset crece ×10 y ×5) — consistente con el modelo de corredor (√10 ≈ 3.16 y √5 ≈ 2.24): el undo de un trazo es **O(cambios reales), independiente de n**. En 500k features el undo retiene menos de medio punto porcentual de lo que retenía el snapshot completo pre-Fase-3.

  **Notas de la corrida (no bloquean el criterio, quedan registradas):**
  1. Los ~48 s de `executeMs` en 500k **no son el costo del undo** (el diff pesa 508 KB, serialización trivial) — son el recompute nativo del trazado (`computeRoadNetworkNet` last 12,460 ms, `computeManzanos` 7,508 ms) más presión de GC.
  2. Heap de JS al **70% del límite** (2,910 / 4,134 MB) con 500k features — el botón de 1M del panel sintético corre riesgo real de OOM/thrash (enlace con Fase 6.2).
  3. `restoreDrawFeatures` tardó **56,060 ms** en 500k (107 MB, 500,006 features) — la carga es la deuda conocida de Fase 4, independiente del undo.

**Deudas nuevas encontradas en esta revisión (2-ago-2026):**

1. **Telemetría muerta:** `recordUndoSnapshot` (`src/store/debug/perfTelemetry.ts`) y la sección "Snapshot de undo (GeoJSON)" del `DebugPanel.tsx` siguen vivos pero solo los llama `drawSourceSnapshot.ts` (deprecado, sin usos). Es exactamente el anti-patrón de "código que nadie usa" que la auditoría ya cazó en el motor JS. → Actualizar a bytes del diff estructural (`approxStructuralDiffBytes`) o eliminar.
2. **Cero tests:** `composeStructuralDiffs` (lógica delicada: neto add→remove, modify→remove, composición de 3+ trazos) y el `CommandStack` (coalescing, pruning por bytes) no tienen cobertura alguna — no existe ni un `*.test.ts` en `src/commands/`. Son lógica pura, ideales para unit tests.
3. **`redo()` que re-ejecuta el algoritmo — CERRADA (2-ago-2026):** los tres comandos dejaron de re-ejecutar en el redo, reconstruyendo desde snapshots capturados en `execute()`:
   - `SubdivideCommand` — snapshot `{id, geometry, props}` de cada feature nueva (incluye métricas ya calculadas); redo sin `subdivideInWorker`.
   - `RemoveLayerCommand` — redo replaya desde `removedLayer`/`removedIndex`, `reassigned` y `removedFeatures` (sin re-scan O(n) del drawSource ni re-derivación).
   - `DuplicateLayerCommand` — snapshot `addedLayer` + `clonedFeatures {id, feature}`; el redo además **deja de regenerar ids nuevos** (`newId('dup')`), que era una divergencia silenciosa de determinismo del enfoque anterior.
   Los tres con guard de no-op si `execute()` no produjo cambios.
4. **`CommandStack.undo()/redo()` no transaccionales:** si `command.undo()` lanza, el `catch` loguea pero `pointer` avanza igual — el stack queda con un comando deshecho a medias. Robustez: no avanzar pointer si el comando falló (o marcarlo corrupto y abortar).

**Total estimado restante: ~1.5-2 días (deuda 1: 0.5 día; deuda 2: 1-1.5 días; deuda 3: CERRADA el 2-ago-2026; deuda 4 opcional)**, ya sin la 3.4 (medida y cumplida el 2-ago-2026).

---

### Fase 4 — Índice espacial y render a escala — ✅ **CERRADA (2-ago-2026):** 4.1 archivado (rstar no-adoptado), 4.2 medido, 4.3 aplicado (caché labels + getVisibleFeatures), 4.4 aplicado (pool WebGL 48 capas).

- **4.0 — Confirmar en producción que §5.1 no dispara** (0.5-1 día, ya sin 2-3 días de arreglo): el bug de sincronización del índice quedó **resuelto en código** (ver §5.1 y §2.3: `load()` explícito en `restoreDrawFeatures`/`loadProject` + telemetría de producción). Lo que queda es confirmación: verificar que `spatialIndex.emptyOnPostrender` se mantiene en 0 en uso real con proyectos grandes (visible en `DebugPanel` → "Saneo de geometría"). Si dispara, se ataca la causa raíz antes de construir el `rstar`; si no, se construye sobre la sincronización actual.
- **4.1 — `rstar` del lado Rust + comando de consulta de viewport** → **ARCHIVADO como validado-no-adoptado (2-ago-2026)**: el benchmark 4.2 (abajo) demostró que el índice nativo pierde contra RBush JS en todas las escalas — no se hidrata en `loadProject`/`restoreDrawFeatures`, no se cablea `PostrenderPainter.getVisibleFeatures`. Se conservan `spatial.rs` (9 tests), los comandos `spatial_index_*` y el harness como evidencia medible y posible base futura (el esqueleto que se construyó el 2-ago-2026 incluye hardening: dedupe de ids en `bulk_load` con criterio last-wins, normalización min/max y canonicalización de ids numéricos (`1` == `1.0`) en `IndexedEnvelope::new`, descarte de bboxes no-finitos con `log::warn!` en `spatial_index_load`, y estado multi-slot `HashMap<String, SpatialIndex>` que aísla el benchmark (`"benchmark"`) del render real (`"viewport"`)). El motivo del archivo NO es el código: es la arquitectura — el costo de IPC+serialización de `invoke` no se puede ganar con un árbol más rápido en el lado Rust.
- **4.2 — Umbral de decisión medido** → ✅ **RESUELTO (2-ago-2026):** harness `runSpatialIndexBenchmarkSuite` (`src/geo/debug/spatialIndexBenchmark.ts`) + sección en `DebugPanel` — compara load y query (5 rondas × 3 rects de viewport: centro/esquina/banda) RBush JS vs rstar nativo, con verificación de paridad de ids, en 10k/100k/500k. **Corrida canónica en build release (2-ago-2026):** protocolo limpio — todo cerrado, `npm run tauri:build -- --no-bundle` (dist fresco + exe release), una sola ventana. Paridad ✓ en las 3 escalas (1,549 / 13,590 / 66,272 hits idénticos).

  | escala | load JS/nat | query JS/nat (15r) | rstar interno (sin IPC) | hits |
  |---|---|---|---|---|
  | 10k | 26.6 / 189.8 ms | 0.37 / 2.36 ms | 0.222 ms | 1549 ✓ |
  | 100k | 510.3 / 846.4 ms | 1.83 / 14.18 ms | 2.001 ms | 13,590 ✓ |
  | 500k | 1,538.2 / 7,186.9 ms | 9.99 / 62.73 ms | 11.482 ms | 66,272 ✓ |

  **Veredicto: el nativo pierde en todo, sin excepción.** Load: 5-7x más lento (500k: 7.2 s vs 1.5 s, dominado por el payload del `invoke`). Query end-to-end: 6-7x más lento (500k: 62.7 vs 10.0 ms). El dato decisivo: a 500k la **búsqueda pura de rstar (11.5 ms, sin IPC) es más lenta que el query completo de RBush JS (10.0 ms)** — el árbol Rust pierde incluso sin pagar serialización. A 10k/100k el rstar interno es rápido (0.22/2.0 ms) pero el IPC lo destruye (2.4/14.2 ms end-to-end vs 0.37/1.83 ms de RBush). RBush JS resuelve 66k hits en ~10 ms, dentro del presupuesto de frame. **Decisión: `rstar` archivado como validado-no-adoptado; RBush JS queda como única vía** (el §7.4 — bulk-load STR, no inserción incremental — sigue rigiendo para el lado JS). Nota metodológica: una corrida previa con la ventana de `tauri:dev` abierta en paralelo dio números consistentes (load 500k 19.9 s) — la contención no cambia el veredicto por los márgenes. Dato del entorno: el build release requirió migrar GEOS vcpkg de `x64-windows-static` a `x64-windows-static-md` (CRT dinámico, alineado con Rust por defecto) + quitar el `/NODEFAULTLIB:LIBCMT` que rompía el link release (LNK2001 de `operator new`) — queda como lección §10.
- **4.3 — Rediseño de `LabelPainter` con caché por dirty-flag** → ✅ **APLICADO Y MEDIDO (2-ago-2026).** En vez del `metricsUpdatedAt` sugerido (firma por timestamp), se implementó la variante **firma barata (§7.6)**: `update(changed)` incrementa `dataVersion`; `paint()` recibe el extent del viewport y `computeCacheKey` = extent cuantizado por `max(resolution*2, 1e-9)` + zoom + `features.length` + `dataVersion` + hash de selección (≤512 ids) + firma exacta de visibilidad de capas. Si la key no cambió, se re-ejecutan `cachedOps` (las llamadas de dibujo — main label, badge de lote, caption de área, segment labels — envueltas en `recordOp`, que recibe `toPx` por parámetro para no arrastrar desfase de viewport) y `paint` retorna sin el pase O(n) de colisiones/mediciones. **Cobertura de invalidación:** el flag `dirty` de `PostrenderPainter` dispara `dataVersion++` en add/remove/change de features, y ahora también en `changefeature` (ediciones en vivo de vértices/propiedades — sin esto el caché quedaba stale; `StreetPainter` no se afecta porque ya tiene su propia firma `streetsHash` y usa `_forceDirty` solo para su caché). **Medición en build dev con proyecto 500k (2-ago-2026):** `Postrender avg` bajó de **36.55 → 13.12 ms** con el proyecto quieto; **hit rate 75%** (6 hits / 2 misses por minuto, contadores `recordLabelCacheHit/Miss` expuestos en `DebugPanel` como "Label cache (hit/miss/min)"); cada hit (replay de ops) cuesta ~5 ms vs ~36-48 ms del pase completo — el `Postrender last 47.90` observado es un miss, costo del loop O(n) sobre ~500k features visibles en fit completo + RBush search de `getVisibleFeatures`, que queda como límite conocido del pase completo (se paga solo en misses). **Caso de uso objetivo (selección activa + pulse 24fps):** antes 36 ms × 24 fps ≈ 864 ms/s de trabajo en postrender; con el caché, ~5 ms × 24 fps ≈ 120 ms/s. **Verificación:** tsc ✓, eslint ✓, vitest 8/8 ✓. **Cobertura de la firma de capas verificada por grep (2-ago-2026):** `paintFeatureLabels` solo lee de `featureLayer` los campos `visible`, `showLabel` y `showCota` (5 lecturas: `registry.getById` → `visible` → `showLabel` → `showCota`; colores de manzanos salen de `colorIdx` del feature, badges/captions usan constantes fijas de `styleFactory`); `layersKey()` incluye exactamente esos 3 — no queda campo de capa sin cubrir. **Medición con selección activa + pulse sobre dataset 500k (2-ago-2026):** **el caché pega en ~100% de los renders (63 hits / 1 miss por minuto; el miss es la selección inicial)** — pero `Postrender avg` subió a **448 ms** con FPS ~1.2: el costo ya NO está en labels (el replay es barato), el `recordPostrenderDuration` mide todo el `handle()` y algo más adentro se lleva ~400 ms (candidatos: `getVisibleFeatures` = RBush search sobre 500k features en fit completo + streetPainter). El FPS 1.2 es consecuencia del frame completo (render WebGL de 500k features + handle de 448 ms) en el peor caso de fit completo. **Instrumentación agregada para localizar: `recordPostrenderSplit`** desglosa `handle()` en updateCaches / getVisibleFeatures / labels / street / resto (avg de 120 samples, fila "Postrender split (avg ms)" en `DebugPanel`). **Split medido con selección + pulse sobre 500k (2-ago-2026):** `update=0.0 · visible=115.0 · labels=0.1 · street=0.0 · resto=0.1` → **el cuello de botella es `getVisibleFeatures` (RBush search + array de ~500k en cada frame del pulse), no los labels** (el caché de 4.3 los dejó en 0.1 ms). **Fix aplicado (2-ago-2026): caché de `getVisibleFeatures` con la misma lógica de firma barata** — extent cuantizado a ~1px (`px = (maxX-minX)/size[0]`) + `all.length` + `dataChanged` (capturado ANTES de que `updateCaches` consuma `dirty`) — si la key no cambia, devuelve el array cacheado sin re-correr el search; el rebuild defensivo del index vacío invalida el caché. tsc ✓, lint ✓. **Verificación posterior (ajuste usuario + re-medición):** FPS 60, postrender avg 18.4 ms, `labels=0.1 ms`, `visible=7.4 ms` — el postrender ya no es el cuello. **Mejora 3 (2-ago-2026): contador monotónico `visibleDataVersion`** en `PostrenderPainter.getVisibleFeatures` (coherente con `dataVersion` de `LabelPainter`), elimina miss innecesario por frame tras un cambio real. **Verificación final (2-ago-2026):** FPS 60 / avg 58.7, postrender avg 20.35 ms, `visible=3.2 ms`, `labels=0.2 ms` — **Fase 4 validada en runtime.**
- **4.4 — Presupuesto de capas físicas WebGL** → ✅ **APLICADO (2-ago-2026).** Cap `MAX_WEBGL_LAYERS = 48` en `DrawLayerRenderer.ts`. **Hasta 48 capas de usuario** → comportamiento existente: un `WebGLVectorLayer` dedicado por capa (mirrors). **Por encima de 48** → **modo pool**: N slots físicos (máx 48) con una sola capa WebGL por slot, cada una con estilo `match` sobre `webglSlotIdx` que resuelve el color/opacidad por capa lógica (generalizando el patrón `colorIdx` de manzanos). La asignación es round‑robin balanceada; cada feature obtiene `webglSlotIdx` en `place()`. Transición automática y reversible en `syncLayerSet` (sin ruptura de features ni rebuild completo salvo el cambio de modo). tsc ✓, lint ✓, vitest 8/8 ✓, cargo check ✓.

**Total estimado:** ~1 semana (baja de ~2.5: la Fase 4.1 quedó **archivada como validado-no-adoptado** el 2-ago-2026 con datos de release — el trabajo de cablear el viewport nativo y la sync incremental se cancela; la **4.3 quedó aplicada y medida** el mismo día; la **4.4 quedó aplicada** el mismo día — Fase 4 cerrada en su totalidad).

---

### Fase 5 — CRS y métricas de alto rendimiento — ❌ NO INICIADA

- **5.1 — Cálculo de matriz afín** (3-4 días): al fijar la zona UTM (o cuando el centro del proyecto se mueve más de cierto umbral), calcular una matriz afín 2×2 + offset que aproxime la transformación dentro del bounding box del proyecto.
- **5.2 — Invalidación de la matriz** (2 días): recalcular solo cuando cambia la zona UTM o el centro se mueve significativamente — no en cada edición.
- **5.3 — Reemplazo del hot path** (3-4 días): `getSegmentMetrics`/cálculo de área en `src/geo/metrics.ts` pasan a usar la matriz en vez de `transform()` de proj4 por vértice.
- **5.4 — Validación de error acumulado** (2 días): confirmar que el error introducido por la aproximación afín es submilimétrico a escala urbana, comparando contra proj4 completo sobre el dataset sintético.

**Total estimado:** 1.5-2 semanas, sin cambios respecto al original, con el trabajo desglosado.

---

### Fase 6 — Endurecimiento y pruebas de estrés — ❌ NO INICIADA (salvo el generador de dataset de Fase 0, que es insuficiente tal cual está)

- **6.1 — Ampliar el dataset sintético** (3-4 días): `src/geo/debug/syntheticDataset.ts` hoy **solo genera lotes rectangulares en grilla** — no genera calles, rotondas, ni manzanos con geometría irregular. Esto es una limitación real: ni la Fase 2.2 (paridad de subdivisión) ni la Fase 2.3/2.4 (uniones y reconciliación de red vial) tienen con qué probarse a escala hoy mismo. Ampliarlo para generar una grilla de calles con anchos variables + algunas rotondas + manzanos resultantes debería ser, en la práctica, uno de los primeros pasos de esta fase, y podría adelantarse para desbloquear los tests de paridad de 2.2/2.4 antes de lo planeado.
- **6.2 — Profiling de memoria nativo** (3-4 días): confirmar el objetivo de <2GB con 1M features usando herramientas nativas (no el `performance.memory` de Chrome, que ya se usa en `DebugPanel.tsx` pero solo cubre el heap de JS, no la memoria del proceso Rust). **Medición parcial ya existente (corrida 3.4, 2-ago-2026):** heap de JS al **70% del límite con 500k features** (2,910 / 4,134 MB) — con ese dato el botón de 1M del panel sintético es **riesgo real de OOM/thrash**, no hipótesis; hasta que la Fase 4 mejore la carga/render, conviene bajar el límite del dataset sintético en el panel de debug (o mostrar un warning al intentar 1M).
- **6.3 — Fuzzing de geometría degenerada contra el motor Rust activo** — **✅ CUMPLIDA (adelantada y cerrada como parte de la Fase 2.6, 1-ago-2026):** fuzz TS (236 casos, corpus del lado JS previo al retiro) + fuzz Rust con timeout (`fuzz_degenerate_geometry.rs` en `tests/`), 0 cuelgues, 0 fallos. Lo que sigue en pie de esta fase es 6.1 (ampliar el corpus del dataset sintético), 6.2 (profiling de memoria nativo) y 6.4 (carga concurrente).
- **6.4 — Pruebas de carga concurrente** (3-4 días): varios comandos Tauri geométricos en paralelo (p. ej. `subdivideManzanoBatch` corriendo mientras el usuario sigue paneando/dibujando) para confirmar que el runtime async de Tauri + `rayon` no compite de forma visible con la interacción en curso.

**Total estimado:** 2.5-3 semanas.

---

### Resumen de tiempos restantes (actualizado 2-ago-2026)

| Fase                               | Estado (1-ago-2026)                              | Trabajo restante estimado                          |
| ---------------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| 0 — Instrumentación                | ✅ Completa                                      | —                                                  |
| 1 — Persistencia                   | ✅ Completa                                      | —                                                  |
| 2.0-2.1 — Scaffolding + primitivas | ✅ Completa (tests agregados: sanitize/roads/roundabout) | —                                          |
| 2.2 — Subdivisión                  | ✅ Portado + paridad verificada (auto + exact/modo2) | — (ampliar corpus con dataset sintético en 6.1)  |
| 2.3 — Booleanas                    | ✅ Activa: GEOS on, build validado, paridad incl. MultiPolygon | —                                    |
| 2.4 — Reconciliación de fragmentos | ✅ Completa (portada + paridad 6 fixtures)       | —                                                  |
| 2.5 — Cableado Tauri               | ✅ Completa (los 7 comandos registrados y consumidos; motor nativo como vía única desde 2.7) | —                           |
| 2.6 — Fuzzing/paridad              | ✅ Completa (fuzz TS 236 casos + fuzz Rust con timeout, 0 cuelgues) | —                                              |
| 2.7 — Limpieza JS                  | ✅ **Completa (1-ago-2026):** A/B validado en la app real (72+ comparaciones en sombra, 0 mismatches, 0 fallbacks; batch por A/B manual ON/OFF con resultados idénticos) y motor JS retirado — jsts/polygon-clipping fuera de package.json, worker/algoritmos/tests eliminados, motor nativo como vía única | — (regresión post-retiro verde) |
| 3 — Undo/redo estructural          | ✅ **Completa (2-ago-2026):** 3.0-3.4 — diffs estructurales en producción + medición cumplida (ratio undo/snapshot 0.47% @ 500k, decreciente con n); quedan 4 deudas menores | ~2-3 días (+deuda 4 opcional) |
| 4 — Índice espacial + render       | ✅ **Cerrada (2-ago-2026)**: 4.1 rstar archivado validado-no-adoptado, 4.2 medido en release, 4.3 caché labels + getVisibleFeatures, 4.4 pool WebGL 48 capas | 0 (terminada) |
| 5 — CRS afín                       | ❌ No iniciada                                   | 1.5-2 semanas                                      |
| 6 — Estrés                         | ❌ No iniciada                                   | 2.5-3 semanas                                      |

**Total restante estimado: ~5-6 semanas** desde hoy, asumiendo 1-2 ingenieros senior dedicados — **menor que las 7-8 semanas que figuraban ayer**, porque la Fase 3 quedó **cerrada en su totalidad (2-ago-2026, 3.4 medida y criterio cumplido)**, el bug de sincronización del índice (§5.1), que bloqueaba el arranque de la Fase 4, resultó **ya resuelto en código** (2-ago-2026: `load()` explícito en los dos puntos de entrada masivo + telemetría de producción), y la Fase 4 **avanzó el mismo día**: esqueleto `rstar` + harness del benchmark 4.2 armados, y el benchmark **medido en release (2-ago-2026)** — veredicto: **rstar archivado como validado-no-adoptado**, el índice JS RBush se queda como única vía (ver 4.2); además **4.3 (caché de `LabelPainter` por firma + caché de `getVisibleFeatures`) quedó aplicada y medida**, y **4.4 (pool WebGL 48 capas) aplicada y cerrada**. El trabajo que sigue es, en orden de impacto: saldar las deudas de la Fase 3 (~2-3 días) y después Fase 5.

---

## 7. Trucos de nivel senior — estado

_(Preservados del original, con nota de estado agregada a cada uno.)_

**7.1 — Linealización afín de la proyección UTM** — ❌ pendiente (Fase 5).

**7.2 — WKB, no GeoJSON, en cualquier límite de serialización** — ✅ parcialmente aplicado: la persistencia (Fase 1) ya usa WKB. **Actualizado el 2-ago-2026 (Fase 3):** el snapshot de undo dejó de ser un límite de serialización — los diffs estructurales viven como geometrías OL en memoria (sin GeoJSON), así que WKB ya no aplica ahí; queda como pendiente solo el IPC de geometría (hoy JSON vía `serde_json` por decisión explícita de 2.0, "optimizar después"), deuda de performance medible recién cuando exista el benchmark de roundtrip del IPC.

**7.3 — Transferables, no clonado estructurado, en `postMessage`** — ✅ **ya no aplica (1-ago-2026, cierre de Fase 2):** el Web Worker JS fue retirado en la Fase 2.7 y el IPC es `invoke()` de Tauri; la recomendación queda como nota histórica y su equivalente futuro es el ítem 7.2 (formato binario en el IPC).

**7.4 — Bulk-load STR, no inserción incremental** — ✅ **aplica y sigue en pie (2-ago-2026):** el lado JS (`RBush.load()`) lo hace bien y queda como única vía — el lado Rust (`rstar`) se construyó con el criterio desde el día uno (esqueleto 4.1 con `RTree::bulk_load` STR) pero quedó **archivado como validado-no-adoptado** por el veredicto del benchmark 4.2: el índice nativo pierde contra RBush JS en todas las escalas por el costo de IPC+serialización (ver Fase 4.2). El criterio STR se conserva como base si alguna vez el árbol Rust se reutiliza fuera del IPC (p. ej. procesamiento batch dentro de un solo `invoke`).

**7.5 — Progreso vía eventos del backend** — ❌ sin cambios, sigue pendiente de que exista trabajo pesado corriendo en Rust para que tenga sentido.

**7.6 — Preservar el patrón de "firma para gatear trabajo caro"** — **APLICADO también en `LabelPainter` (2-ago-2026):** el patrón que ya vivía en `layerSignature`/`streetsHash` ahora cubre el ejemplo que el documento señalaba — `computeCacheKey` en `LabelPainter` (extent cuantizado + zoom + conteo + dataVersion + selección + capas) gatea el pase O(n) de colisiones/mediciones re-ejecutando `cachedOps` — ver Fase 4.3.

**7.7 — SDF para labels** — sin cambios, sigue siendo "no lo hagas antes de necesitarlo".

**7.8 — Nuevo, agregado en la revisión anterior: no dejes crecer motor Rust sin consumidores reales.** **Estado: cumplido (1-ago-2026).** La regla concreta ("por cada sub-fase de Fase 2 que se cierre, cerrarla debería incluir _como mínimo_ un test de paridad contra el TS") se aplicó retroactivamente y quedó institucionalizada: hoy cada módulo del motor tiene su test de paridad automático contra el TS (subdivisión auto/exact/modo2, reconciliación, computeManzanos) y el motor tiene consumidores reales vía Tauri. La regla sigue vigente para el trabajo futuro: **cualquier cambio de comportamiento en el motor Rust debe actualizar el snapshot o fallar en `cargo test`** — eso es lo que evita que vuelva a crecer código sin verificar.

---

## 8. Lo que NO vas a hacer (anti-patrones a evitar activamente)

_(Preservado del original, con un ítem nuevo al final.)_

1. No reescribas la capa de interacción de OpenLayers.
2. No adoptes MapLibre.
3. No muevas todo detrás de IPC de Tauri sin distinguir hot-path de batch.
4. No sigas usando `sql.js`/`dexie` — **ya resuelto, este ítem queda cerrado.**
5. No optimices el pipeline de labels/SDF antes de tener el dato de que lo necesitás.
6. No parchees la race condition del índice espacial con más `console.warn` — **resuelto (verificado 2-ago-2026): ambos puntos de entrada masivo cargan el índice explícitamente (`restoreDrawFeatures` y `loadProject` hacen `getOrCreateSpatialIndex().load()`), y la telemetría del fallback corre en producción (`recordGeometrySanitizeEvent` sin gate de `DEV`), no solo en DEV. La regla se conserva como anti-patrón para el futuro: si el fallback vuelve a dispararse en uso real, se arregla la causa raíz, no el log.**
7. No avances de una sub-fase de la Fase 2 a la siguiente sin su criterio de éxito verificado — **resuelto en la práctica (1-ago-2026):** las sub-fases 2.2-2.7 se cerraron con tests verdes (paridad en 2.2-2.4, A/B real en 2.7) y la cobertura de tests del crate quedó pareja (§5.3). La regla sigue aplicando para cualquier trabajo futuro del motor.
8. **Nuevo en la revisión anterior: no sigas escribiendo más código Rust nuevo (2.4 en adelante) mientras 2.5.a siga sin hacerse.** — **cumplido (1-ago-2026):** 2.5 quedó completa (los 7 comandos geométricos registrados y consumidos desde el frontend con fallback). El anti-patrón se actualizó: **no retires `jsts`/`polygon-clipping` de `package.json` hasta validar el A/B nativo vs JS en la app real con datos de producción** (Fase 2.7) — retirar el fallback antes de esa validación reintroduciría silenciosamente el riesgo que este punto prevenía. **Cumplido (1-ago-2026, tarde):** el A/B se validó (0 mismatches / 0 fallbacks con datos reales) y el motor JS fue retirado. **Anti-patrón cerrado y cerrado el ítem.**

---

## 9. Cómo vas a saber que funcionó — métricas actualizadas

| Métrica                                     | Estado hoy (1-ago-2026)                                                                 | Objetivo post-migración                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Carga de proyecto urbano completo           | ✅ Resuelto en Fase 1, confirmado en código                                              | < 500ms                                                                      |
| Trazar 1 calle en proyecto de 200k features | ✅ **Resuelto y medido (2-ago-2026, Fase 3.4):** undo del trazo = diff estructural; benchmark con dataset sintético y pipeline real (`AddStreetCommand` → `recomputeManzanos` → `StructuralDiff`): undo 67.4 KB / 211.8 KB / 507.9 KB contra baselines de 2,150.6 / 21,486.3 / 107,423.2 KB en 10k/100k/500k features — ratio **3.13% → 0.99% → 0.47%**, decreciente con n y consistente con O(cambios reales) (la calle cruza un corredor de ~√n manzanos) | O(cambios reales), independiente de n |
| Unión de red vial, 5.000 segmentos          | ✅ Medible y validada: A/B en sombra (72+ comparaciones, 0 mismatches) y batch por A/B manual ON/OFF idéntico; rendimiento nativo medido en la app real (subdivideManzanoBatch 50 features: 14ms vs 108ms; computeRoadNetworkNet: 12ms vs 264ms) | < 100ms |
| FPS con 200k features en viewport           | ❌ Sin cambios — LOD tiers degradan desde 350-900 features                               | 60fps sostenidos                                                             |
| Memoria con dataset de 1M features          | ⏸ Sin medir (heap de JS sí se mide; memoria nativa del proceso, no)                      | < 2GB confirmado con profiler nativo                                         |
| Motor de geometría en producción            | ✅ **Motor Rust/GEOS como vía única (Fase 2.7 completa, 1-ago-2026):** motor JS retirado; sin runtime Tauri no hay motor (la versión web quedó en el branch `web-version`) | GEOS/`geo` nativo vía Rust como vía única |
| Índice espacial                             | ✅ **Cerrado (2-ago-2026)**: bug de resincronización resuelto; **benchmark 4.2 medido en release → `rstar` archivado como validado-no-adoptado** (RBush JS gana en todo, ver Fase 4.2); el esqueleto `rstar` (crate `spatial.rs`, comandos, cliente) se conserva como evidencia; **4.3 (caché de `LabelPainter` + `getVisibleFeatures`) aplicada y medida**; **4.4 (pool WebGL 48 capas) aplicada** | RBush JS como única vía (causa raíz del bug corregida); `rstar` solo fuera del IPC, si algún día se necesita batch nativo |
| Cobertura de tests de paridad JS↔Rust       | ✅ 4 de 4 módulos del motor con paridad automática (subdivisión auto/exact/modo2, fragmentos, computeManzanos) + fuzzing completo (TS 236 casos + Rust con timeout) + tests unitarios en los 9 archivos del crate | Corpus ampliado con dataset sintético (Fase 6.1) |

---

Esta sigue siendo una hoja de ruta, no una promesa — la diferencia con la versión anterior de este documento es que ahora cada casilla de "completado" está respaldada por una lectura real del código y por tests verdes, no por la expectativa de que el plan se ejecutó tal como se escribió. El cierre de la Fase 2 (1-ago-2026) y el de la Fase 3 (2-ago-2026) dejan la hoja de ruta en su punto más simple desde que existe: **las tres piernas de la auditoría — portar el algoritmo (2.0-2.4), conectarlo al producto (2.5) y probarlo en producción y borrar lo viejo (2.6 fuzzing + 2.7 limpieza) — están hechas, el undo/redo estructural que era el otro cuello de botella crítico de §2.1 está completo y medido (3.0-3.4): diffs proporcionales al cambio, con la medición confirmando el criterio (ratio undo/snapshot 0.47% @ 500k y decreciente con n), y el bug de sincronización del índice espacial (§5.1), el hallazgo más urgente de las revisiones anteriores, resultó ya resuelto en código (carga explícita del índice en ambos puntos de entrada masivo + telemetría de producción).** Lo que sigue, en orden de impacto: saldar las deudas menores de la Fase 3 (~2-3 días), después Fase 4 (índice + render a escala, que arranca sin el bloqueo de §5.1 — solo resta verificar el contador en producción) y Fase 5 (CRS afín). El cronograma restante está desglosado en la tabla de tiempos.
