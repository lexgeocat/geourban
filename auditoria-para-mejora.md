# Auditoría de Arquitectura — Motor GIS "GeoUrban"

### Diagnóstico, veredicto y hoja de ruta hacia rendimiento de clase catastro-masivo

**Autor:** Revisión técnica senior (arquitectura GIS desktop)
**Alcance:** Auditoría del repositorio real (`geourban`), no de una descripción abstracta del stack.
**Revisión:** 1 de agosto de 2026 — actualización de estado contra el código actual del repo (no contra lo que el documento original _asumía_ que se había hecho).

> **Cómo leer este documento:** es la misma auditoría original, con cuatro cambios: (1) cada fase tiene ahora su estado real verificado línea por línea contra el código, no una casilla optimista; (2) las Fases 3 a 6 quedan desglosadas en sub-fases con el mismo nivel de detalle que ya tenía la Fase 2; (3) se agrega una sección nueva (§5) con los bugs y la deuda técnica que esta revisión encontró leyendo el código — incluido uno que la auditoría original ya había señalado y que **sigue sin resolverse**; (4) **actualización del 1-ago-2026**: las Fases 2.2 a 2.5 (paridad de subdivisión, booleanas GEOS activas, reconciliación de fragmentos y cableado Tauri completo) **quedaron cerradas y verificadas con tests verdes en ambos lados** — ver §6. Los estados que figuran en este documento reflejan esa corrida, con el detalle de cada cambio en §6 y las consecuencias para la deuda pendiente en §5 y §7.

---

## 0. Antes de nada: tu "stack actual" no es el que describís

_(Sin cambios respecto a la versión original — este diagnóstico de partida sigue siendo válido.)_

Lo primero que tengo que decirte, porque cambia todo el diagnóstico: **`deck.gl` no está en tu `package.json`, y `MapLibre GL` tampoco**. Lo que hay en el repo es:

- `ol` (OpenLayers 10) como motor de mapa e interacción.
- Un renderer WebGL **artesanal**, propio, construido sobre `ol/layer/WebGLVector` (`src/map/scene/DrawLayerRenderer.ts`), no deck.gl.
- Un pipeline de **Canvas2D en postrender** (`src/map/scene/PostrenderPainter.ts` + 6 "painters" especializados) para todo lo que WebGL no cubre: cotas, calles, rotondas, snap guides, selección pulsante, previews de subdivisión.
- Web Workers con **JSTS** (puerto JS de una librería Java) y **polygon-clipping** (puro JS) para booleanas y uniones. **Actualizado el 1-ago-2026:** el motor Rust ya está cableado y es invocable desde el frontend (Fase 2.5 completa), pero el JS sigue activo como **fallback** detrás del flag "motor nativo" (`useNativeGeoEngineStore` + detección de runtime Tauri en `geoWorkerClient.ts`) — ver §2.2 y §6, Fase 2.5.
- Un **Command pattern** con undo/redo propio, bastante más sofisticado que lo que se ve en proyectos GIS típicos.
- Persistencia nativa vía `rusqlite` (esto sí cambió desde la versión original del documento — ver Fase 1, ya completada).

Esto importa porque tu pregunta original ("¿deck.gl + MapLibre o Rust?") partía de una premisa incorrecta. Lo que tenés **no es un stack "genérico de mapas"** — es un **motor CAD/GIS de edición vectorial vivo**. El veredicto de la auditoría original (Rust sí, MapLibre no) sigue siendo correcto y esta revisión no le encuentra motivos para cambiarlo. **Actualizado el 1-ago-2026:** el hallazgo de la revisión anterior ("el motor nuevo todavía no le entrega ningún beneficio real al usuario porque no está conectado") quedó **resuelto en lo estructural** — los seis tipos de request geométricos ya tienen comando Tauri y el frontend los invoca cuando el flag está activo. Lo que falta no es más cableado sino la **transición de producción**: quitar el fallback JS (Fase 2.7) una vez validada la paridad en la app real. Ver §5.2 (actualizado) y §6, Fase 2.5/2.7.

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

**Estado: SIN RESOLVER.** `src/commands/core/drawSourceSnapshot.ts` sigue serializando `source.getFeatures()` completo a GeoJSON en cada `AddStreetCommand`/`AddRoundaboutCommand`, dos veces (antes y después). No hubo trabajo en la Fase 3 todavía — ver el desglose ampliado en §6, Fase 3.

### 2.2 — El motor de geometría corre en JS puro, interpretado, en el hilo del navegador

**Estado: RESUELTO EN LO ESTRUCTURAL (1-ago-2026), TRANSICIÓN DE PRODUCCIÓN PENDIENTE.** El crate Rust (`geourban-geo`) ya no es código muerto: los seis tipos de request que resolvía `geoWorker.ts` tienen comando Tauri equivalente y el frontend los invoca por defecto cuando corre en runtime Tauri con el flag "motor nativo" activo:

- `subdivide` / `subdivide_manzano` / `subdivide_manzano_batch` (Fase 2.5.a)
- `compute_manzanos_cmd` / `compute_manzanos_batch` (Fase 2.5.b)
- `compute_road_network_net_cmd` / `match_fragments_batch` (Fase 2.5.c)

Todos registrados en `src-tauri/src/lib.rs` y consumidos desde `src/workers/geoWorkerClient.ts` con **fallback automático al worker JS** (si `invoke` falla o no hay runtime Tauri, se reintenta en JSTS/polygon-clipping; cada fallback queda registrado en consola y en el panel de debug).

**Lo que sigue pendiente es la Fase 2.7:** el JS (`jsts`/`polygon-clipping`) sigue en `package.json` y sigue importado activamente como respaldo — no se puede borrar hasta que la paridad quede validada en la app real con datos de producción y el flag se encienda por defecto. Cero regresión hoy, y la mejora medible (el A/B de rendimiento) ya es posible desde el panel de debug.

### 2.3 — Índice espacial: bien diseñado, mal sincronizado

**Estado: BUG CONFIRMADO, SIGUE ACTIVO.** El parche defensivo que la auditoría original señalaba como anti-patrón ("no lo arregles con más `console.warn`") **sigue exactamente igual** en `src/map/scene/PostrenderPainter.ts`:

```ts
if (index.size === 0 && all.length > 0) {
  if (import.meta.env.DEV) {
    console.warn(
      'PostrenderPainter: índice espacial vacío con N feature(s) presentes — reconstruyendo...'
    );
  }
  index.load(all as unknown as Feature<Polygon>[]);
}
```

Esto es un bug real de causa-raíz no resuelta, no cosmético — ver el detalle y la propuesta de arreglo en §5.1, es el hallazgo más accionable de esta revisión.

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
│  • Cliente hacia Rust vía Tauri `invoke` (geoWorkerClient.ts,        │
│    con fallback al worker JS detrás del flag "motor nativo"):         │
│      - project_save/project_load/project_list/project_delete  ✅ USADO│
│      - geo_engine_version                                     ✅ USADO│
│      - subdivide / subdivide_manzano / subdivide_manzano_batch       │
│      - compute_manzanos_cmd / compute_manzanos_batch                  │
│      - compute_road_network_net_cmd / match_fragments_batch           │
│                                       ✅ EXISTEN Y SE INVOCAN (2.5, 1-ago-2026) │
│    → el JS de geoWorker.ts queda como fallback, no como única vía.    │
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

**Lectura honesta del diagrama (actualizada 1-ago-2026):** la mitad inferior (backend Rust) está completa en el alcance de la Fase 2 — persistencia, primitivas, subdivisión, booleanas GEOS y reconciliación de fragmentos, con tests de paridad verdes contra el motor TS. La mitad superior (frontend) ya tiene cables reales hacia esa mitad inferior para todo lo geométrico, pero con el motor JS conservado como red de seguridad. Lo que queda de Fase 2 es **retirar la red de seguridad** (2.7), no tender más cables.

---

## 5. Hallazgos de esta revisión: bugs y deuda técnica

Esta sección es nueva respecto al documento original. Son hallazgos de lectura de código, no suposiciones.

### 5.1 — BUG activo: la reconstrucción silenciosa del índice espacial sigue sin arreglarse

**Dónde:** `src/map/scene/PostrenderPainter.ts`, método `getVisibleFeatures`.

**Qué pasa:** si el índice espacial (`RBush`, singleton vía `getOrCreateSpatialIndex()`) aparece vacío en un frame donde `drawSource` ya tiene features, el código lo reconstruye entero (`index.load(all...)`) dentro del propio callback de `postrender`, y solo deja un rastro (`console.warn`) cuando `import.meta.env.DEV` es verdadero. **En producción esto sucede en absoluto silencio.**

**Por qué importa:** un `index.load()` completo dentro de `postrender` es, por definición, un recálculo O(n log n) disparado desde el hilo de render — exactamente el tipo de trabajo que no debería aparecer ahí. Si esto se dispara con cierta frecuencia en proyectos grandes (algo que hoy nadie puede saber, porque no hay telemetría de producción para este evento), es un causante silencioso de jank intermitente que ningún usuario va a poder reportar de forma útil ("a veces el mapa tiene un tirón").

**Hipótesis de causa raíz (igual que la auditoría original la planteaba, sin resolver):** un desorden entre el momento en que se instala el listener `addfeature`/`removefeature`/`changefeature` sobre `drawSource` (en `Map.tsx`) y el momento en que algo puebla `drawSource` en volumen (`restoreDrawFeatures` en `mapStore.ts`, o `loadProject` en `persistence/projectFile.ts`, que llama `drawSource.addFeatures(features)` directamente). En React 18/19 con Strict Mode, los efectos se montan/desmontan/remontan una vez extra en desarrollo — si `getOrCreateSpatialIndex()` devuelve el mismo singleton pero los listeners de un montaje anterior ya fueron limpiados por el `return () => {...}` del `useEffect`, podés terminar con features en `drawSource` pero sin ningún listener activo escuchándolas hasta el remount.

**Cómo se arregla (dos pasos concretos, no otro parche):**

1. **Hacer explícita la carga del índice en cada punto de entrada masivo**, en vez de confiar en que los eventos incrementales lo mantengan sincronizado. Tanto `restoreDrawFeatures` (`mapStore.ts`) como `loadProject` (`persistence/projectFile.ts`) deberían llamar `getOrCreateSpatialIndex().load(features)` explícitamente después de poblar `drawSource`, en vez de depender de que `addfeature` dispare `spatialIndex.insert()` feature por feature. Es más barato (`load()` es bulk, `insert()` repetido no) y elimina la ambigüedad de orden.
2. **Convertir el `console.warn` en una métrica real**, incluso fuera de DEV (`recordGeometrySanitizeEvent`-style, ya existe el patrón en `store/debug/geometryTelemetry.ts` — reusarlo), para poder confirmar en producción si esto sigue pasando después del paso 1, en vez de asumir que ya quedó resuelto.

Este es, de los hallazgos de esta revisión, el que tiene mejor relación costo/beneficio: es un arreglo acotado (dos call sites) contra un bug que ya lleva documentado desde la versión anterior de este mismo informe.

### 5.2 — El motor Rust existía pero estaba desconectado: riesgo de deuda duplicada — RESUELTO (1-ago-2026)

**Estado actual:** el riesgo estructural desapareció — la Fase 2.5 quedó cerrada (ver §6), el motor nativo se invoca desde `geoWorkerClient.ts` con fallback al JS, y la paridad entre ambos motores está automatizada con snapshots (ver §6, Fase 2.6). Sigue habiendo dos implementaciones del motor, pero ahora están **conectadas y comparadas por tests**, no divergiendo en silencio.

**Lo que queda de este hallazgo, reformulado:** la deuda de "mantenimiento doble" persiste mientras dure la Fase 2.7 (retiro del JS). Cada corrección de bug en `subdivisionCabeceraCuerpo.ts` o `geoOperations.ts` sigue debiendo aplicarse también al Rust mientras el fallback JS exista. La recomendación se mantiene con matiz: cerrar 2.7 (transición de producción) es ahora el bloqueante de mayor prioridad de la Fase 2 — no porque falte cableado, sino porque cada semana con los dos motores activos es una semana de mantenimiento doble sin contrapartida.

### 5.3 — Cobertura de tests del crate Rust — MAYORMENTE RESUELTA (1-ago-2026)

**Estado actual:** la cobertura dejó de ser desigual. Se agregaron tests unitarios a los tres módulos que no tenían ninguno, y los módulos de subdivisión/booleanas/reconciliación ahora tienen **tests de paridad de integración** contra el motor TS (snapshots generados por `npm run parity:sync`). Verificado archivo por archivo:

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

**Total verificado:** 64 unit tests sin feature + 6 con `geos-backend` (70), 4 archivos de paridad de integración — todo verde en la corrida del 1-ago-2026. El criterio de éxito original de las Fases 2.1/2.2 ("mismo set de polígonos por ambos lados, coincidencia dentro de tolerancia") **está cumplido para subdivisión (auto/exact/modo2), reconciliación y computeManzanos**; queda el fuzzing sistemático de la Fase 2.6 y ampliar el corpus con geometrías del dataset sintético real (Fase 6.1).

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

### Fase 2 — Motor de geometría en Rust — ✅ COMPLETA (1-ago-2026), salvo 2.6/2.7

**Estado:** las sub-fases 2.0 a 2.5 quedaron cerradas con tests verdes en ambos lados. Quedan pendientes la Fase 2.6 (fuzzing sistemático) y la 2.7 (retiro del motor JS). Detalle por sub-fase:

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

Los seis tipos de request que resolvía `geoWorker.ts` tienen comando Tauri registrado en `src-tauri/src/lib.rs` (`subdivide`, `subdivide_manzano`, `subdivide_manzano_batch`, `compute_manzanos_cmd`, `compute_manzanos_batch`, `compute_road_network_net_cmd`, `match_fragments_batch`). En el frontend, `geoWorkerClient.ts` los invoca **cuando el flag "motor nativo" está activo y corre en runtime Tauri**, con fallback automático al worker JS si el `invoke` falla. La secuencia interna que la revisión anterior sugería (2.5.a → 2.5.b → 2.5.c → 2.5.d) quedó ejecutada en su totalidad: los call-sites fueron reemplazados de a uno con A/B posible desde el panel de debug. El retiro definitivo del JS es la Fase 2.7.

#### 2.6 — Paridad y fuzzing — 🟡 PARIDAD COMPLETA, FUZZING PENDIENTE

La paridad contra snapshots TS quedó automatizada para los cuatro módulos del motor (auto, exact/modo2, fragmentos, computeManzanos) vía `npm run parity:sync` + `npm test` + `cargo test`. El fuzzing sistemático de geometría degenerada (reusando el corpus que dispara `sanitizeRing.ts`/`recordGeometrySanitizeEvent`) sigue pendiente — depende de que 2.5 esté en uso real (ya lo está) y del corpus ampliado de la Fase 6.1.

#### 2.7 — Validación de performance + limpieza — ❌ NO INICIADA (único pendiente de la Fase 2)

`jsts` y `polygon-clipping` siguen en `package.json` y siguen importados activamente como fallback en `geoWorkerClient.ts` / `geoOperations.ts`. **No se puede borrar nada de esto hasta validar la paridad en la app real con datos de producción** y confirmar que el motor nativo no regresa nada distinto en geometrías reales (el flag de debug permite el A/B). Esta es ahora la tarea de mayor impacto de la Fase 2.

**Resumen de Fase 2 (1-ago-2026):** el trabajo de "traducir el algoritmo" (2.0-2.4) y de "conectarlo al producto" (2.5) **está completo y verificado con tests en ambos lados** — el diagnóstico de la revisión anterior ("conectarlo no arrancó") quedó resuelto. Lo que queda es "probarlo en producción y borrar lo viejo" (2.6 fuzzing + 2.7 limpieza), que es exactamente la parte que la auditoría advertía que era la más fácil de subestimar.

---

### Fase 3 — Undo/redo estructural — ❌ NO INICIADA

Desglose ampliado (el documento original la trataba como bloque único de 2 semanas; se abre en sub-fases):

- **3.0 — Prerrequisito:** no diseñar el diff estructural en el vacío — reusar exactamente el mismo cálculo de `changedExtent`/grupos de manzanos afectados que `recomputeManzanosImmediate` ya hace en `recomputeManzanos.ts` para saber qué tocó una calle nueva. Es la misma información que necesita el undo estructural para saber qué manzanos/lotes registrar como "antes/después", así que no debería calcularse dos veces.
- **3.1 — Diseño del formato de diff** (2-3 días): decidir si se registra por comando `{ manzanosAfectados: [{id, geomAntes, geomDespues}], lotesCreados: [...], lotesEliminados: [...] }` o algo más granular. Debe cubrir tanto `AddStreetCommand`/`AddRoundaboutCommand` como cualquier comando futuro que hoy use snapshot completo.
- **3.2 — Port de `AddStreetCommand`/`AddRoundaboutCommand`** (1 semana): reemplazar `snapshotDrawSource`/`restoreDrawSourceSnapshot` por el diff de 3.1. Es el comando más usado (cada trazo de calle) y el de mayor impacto medible.
- **3.3 — Auditoría de otros call-sites** (2-3 días): confirmar que no queden otros comandos apoyándose en snapshot completo por comodidad (revisar `SubdivideCommand.ts`, `GenerateLotsCommand.ts` — estos ya trabajan por id individual, probablemente no necesiten cambios, pero hay que confirmarlo explícitamente, no asumirlo).
- **3.4 — Medición de regresión** (2-3 días): correr el dataset sintético de 200k features, trazar una calle, confirmar que la asignación de memoria del comando ya no es proporcional al tamaño total del proyecto (criterio de éxito original, sin cambios).

**Total estimado:** 2-2.5 semanas, similar al original, con el trabajo mejor secuenciado.

---

### Fase 4 — Índice espacial y render a escala — ❌ NO INICIADA

- **4.0 — Arreglar primero el bug de §5.1** (2-3 días): antes de construir un índice nuevo (`rstar`) encima de la sincronización actual, hay que resolver la causa raíz de por qué el índice JS a veces aparece vacío. Si no se resuelve acá, el índice Rust va a heredar el mismo síntoma bajo una forma distinta (p. ej. una consulta de viewport contra un índice Rust desactualizado, ahora sin ningún `console.warn` que lo delate porque cruza un `invoke`).
- **4.1 — `rstar` del lado Rust + comando de consulta de viewport** (1.5 semanas): bulk-load (`RTree::bulk_load`, no inserción incremental — ver §7.4) al hidratar un proyecto grande desde SQLite.
- **4.2 — Umbral de decisión medido** (2-3 días): usar el instrumental de Fase 0 para fijar el número real de features a partir del cual conviene pagar el costo de un `invoke` en vez de resolver en RBush JS local. No adivinar el umbral — medirlo con el dataset sintético.
- **4.3 — Rediseño de `LabelPainter` con caché por dirty-flag** (1 semana): usar `metricsUpdatedAt` (que ya existe en el modelo de feature) para gatear la reconstrucción de `collisionGrid`, no solo el caché de área en pantalla que ya tiene.
- **4.4 — Presupuesto de capas físicas WebGL** (3-4 días): por encima de ~32 capas de usuario, pasar a un modelo de N capas físicas con atributo `layerColorId` resuelto por expresión de estilo, generalizando el patrón que ya existe para `colorIdx` de manzanos.

**Total estimado:** 3-3.5 semanas.

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
- **6.2 — Profiling de memoria nativo** (3-4 días): confirmar el objetivo de <2GB con 1M features usando herramientas nativas (no el `performance.memory` de Chrome, que ya se usa en `DebugPanel.tsx` pero solo cubre el heap de JS, no la memoria del proceso Rust).
- **6.3 — Fuzzing de geometría degenerada contra el motor Rust activo** (1 semana, depende de que 2.5 esté cerrada): reusar el mismo corpus que hoy dispara `sanitizeRing.ts`/`recordGeometrySanitizeEvent` del lado JS.
- **6.4 — Pruebas de carga concurrente** (3-4 días): varios comandos Tauri geométricos en paralelo (p. ej. `subdivideManzanoBatch` corriendo mientras el usuario sigue paneando/dibujando) para confirmar que el runtime async de Tauri + `rayon` no compite de forma visible con la interacción en curso.

**Total estimado:** 2.5-3 semanas.

---

### Resumen de tiempos restantes (actualizado 1-ago-2026)

| Fase                               | Estado (1-ago-2026)                              | Trabajo restante estimado                          |
| ---------------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| 0 — Instrumentación                | ✅ Completa                                      | —                                                  |
| 1 — Persistencia                   | ✅ Completa                                      | —                                                  |
| 2.0-2.1 — Scaffolding + primitivas | ✅ Completa (tests agregados: sanitize/roads/roundabout) | —                                          |
| 2.2 — Subdivisión                  | ✅ Portado + paridad verificada (auto + exact/modo2) | — (ampliar corpus con dataset sintético en 6.1)  |
| 2.3 — Booleanas                    | ✅ Activa: GEOS on, build validado, paridad incl. MultiPolygon | —                                    |
| 2.4 — Reconciliación de fragmentos | ✅ Completa (portada + paridad 6 fixtures)       | —                                                  |
| 2.5 — Cableado Tauri               | ✅ Completa (los 7 comandos registrados + fallback JS) | —                                              |
| 2.6 — Fuzzing/paridad              | 🟡 Paridad completa; fuzzing pendiente           | 2-3 días                                           |
| 2.7 — Limpieza JS                  | ❌ No iniciada (único pendiente de Fase 2)       | 1 semana (A/B en app real + retiro de jsts/polygon-clipping) |
| 3 — Undo/redo estructural          | ❌ No iniciada                                   | 2-2.5 semanas                                      |
| 4 — Índice espacial + render       | ❌ No iniciada (bug 5.1 pendiente)               | 3-3.5 semanas                                      |
| 5 — CRS afín                       | ❌ No iniciada                                   | 1.5-2 semanas                                      |
| 6 — Estrés                         | ❌ No iniciada                                   | 2.5-3 semanas                                      |

**Total restante estimado: ~11-13 semanas** desde hoy, asumiendo 1-2 ingenieros senior dedicados — **menor que las 14-16 semanas que proyectaba la revisión anterior**, porque el cierre de 2.2-2.5 descontó el bloque más grande que quedaba (cableado + validación de la Fase 2). El trabajo que sigue es, en orden de impacto: 2.7 (retirar el JS de producción), Fase 3 (undo estructural, el otro cuello de botella crítico de §2.1) y Fase 4 (índice + render a escala, que además necesita el bug de §5.1 resuelto).

---

## 7. Trucos de nivel senior — estado

_(Preservados del original, con nota de estado agregada a cada uno.)_

**7.1 — Linealización afín de la proyección UTM** — ❌ pendiente (Fase 5).

**7.2 — WKB, no GeoJSON, en cualquier límite de serialización** — ✅ parcialmente aplicado: la persistencia (Fase 1) ya usa WKB. **Pendiente:** el snapshot de undo (Fase 3) y el IPC de geometría (Fase 2.5, hoy JSON vía `serde_json` por decisión explícita de 2.0, "optimizar después") todavía no. El cierre de 2.5 no cambió la decisión de IPC en JSON — es deuda de performance futura, medible recién cuando 2.7 esté cerrado y haya datos reales de roundtrip.

**7.3 — Transferables, no clonado estructurado, en `postMessage`** — ❌ sin cambios, sigue pendiente en `geoWorkerClient.ts` mientras siga en uso.

**7.4 — Bulk-load STR, no inserción incremental** — el lado JS (`RBush.load()`) ya lo hace bien y sigue así. El lado Rust (`rstar`) todavía no existe — cuando se construya (Fase 4.1), aplicar el mismo criterio desde el día uno.

**7.5 — Progreso vía eventos del backend** — ❌ sin cambios, sigue pendiente de que exista trabajo pesado corriendo en Rust para que tenga sentido.

**7.6 — Preservar el patrón de "firma para gatear trabajo caro"** — el patrón sigue vivo donde ya estaba (`layerSignature`, `streetsHash`), pero **sigue sin aplicarse en `LabelPainter`**, que es justo el ejemplo que el documento original señalaba como pendiente. Sin cambios ahí — ver Fase 4.3.

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
6. No parchees la race condition del índice espacial con más `console.warn` — **sigue sin resolverse, ver §5.1. Este es el ítem más urgente de toda la lista de anti-patrones, porque es el único que ya lleva tres revisiones señalado sin acción.**
7. No avances de una sub-fase de la Fase 2 a la siguiente sin su criterio de éxito verificado — **resuelto en la práctica (1-ago-2026):** las sub-fases 2.2-2.5 se cerraron con tests de paridad verdes en ambos lados, y la cobertura de tests del crate quedó pareja (§5.3). La regla sigue aplicando para 2.6/2.7 y para cualquier trabajo futuro del motor.
8. **Nuevo en la revisión anterior: no sigas escribiendo más código Rust nuevo (2.4 en adelante) mientras 2.5.a siga sin hacerse.** — **cumplido (1-ago-2026):** 2.5 quedó completa (los 7 comandos geométricos registrados y consumidos desde el frontend con fallback). El anti-patrón se actualiza: **no retires `jsts`/`polygon-clipping` de `package.json` hasta validar el A/B nativo vs JS en la app real con datos de producción** (Fase 2.7) — retirar el fallback antes de esa validación reintroduciría silenciosamente el riesgo que este punto prevenía.

---

## 9. Cómo vas a saber que funcionó — métricas actualizadas

| Métrica                                     | Estado hoy (1-ago-2026)                                                                 | Objetivo post-migración                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Carga de proyecto urbano completo           | ✅ Resuelto en Fase 1, confirmado en código                                              | < 500ms                                                                      |
| Trazar 1 calle en proyecto de 200k features | ❌ Sin cambios — sigue siendo O(n) por snapshot GeoJSON completo (Fase 3 sin iniciar)     | O(cambios reales), independiente de n                                        |
| Unión de red vial, 5.000 segmentos          | 🟡 Medible vía flag "motor nativo" (A/B desde el panel de debug); paridad correcta, benchmark de rendimiento aún sin correr | < 100ms |
| FPS con 200k features en viewport           | ❌ Sin cambios — LOD tiers degradan desde 350-900 features                               | 60fps sostenidos                                                             |
| Memoria con dataset de 1M features          | ⏸ Sin medir (heap de JS sí se mide; memoria nativa del proceso, no)                      | < 2GB confirmado con profiler nativo                                         |
| Motor de geometría en producción            | 🟡 Motor Rust cableado y activable por flag (Tauri + `useNativeGeoEngineStore`), con fallback automático a JSTS/polygon-clipping — el JS sigue siendo lo que corre por defecto | GEOS/`geo` nativo vía Rust como vía única |
| Índice espacial                             | RBush JS, con bug de resincronización activo (§5.1) sin resolver                         | RBush JS + `rstar` nativo, con causa raíz del bug corregida antes de escalar |
| Cobertura de tests de paridad JS↔Rust       | ✅ 4 de 4 módulos del motor con paridad automática (subdivisión auto/exact/modo2, fragmentos, computeManzanos) + tests unitarios en los 9 archivos del crate | Fuzzing sistemático + corpus ampliado con dataset sintético (Fase 6.1) |

---

Esta sigue siendo una hoja de ruta, no una promesa — la diferencia con la versión anterior de este documento es que ahora cada casilla de "completado" está respaldada por una lectura real del código y por tests verdes en ambos lados, no por la expectativa de que el plan se ejecutó tal como se escribió. El hallazgo central de esta revisión (1-ago-2026), si hay que quedarse con uno solo: **la parte que la auditoría original señalaba como la más difícil de estimar (portar el algoritmo) y la que señalaba como la más fácil de subestimar (conectarlo y probarlo) ya están hechas y verificadas — lo que queda de la Fase 2 es la tercera y última pierna: probar el motor nativo en la app real y borrar el JS (2.6/2.7). Después de eso, el cronograma restante (Fases 3-6) es el mismo que este documento ya tenía desglosado, con el bug del índice espacial (§5.1) como única deuda que arrastra desde la primera revisión sin acción.**
