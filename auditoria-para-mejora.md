# Auditoría de Arquitectura — Motor GIS "GeoUrban"

### Diagnóstico, veredicto y hoja de ruta hacia rendimiento de clase catastro-masivo

**Autor:** Revisión técnica senior (arquitectura GIS desktop)
**Alcance:** Auditoría del repositorio real (`geourban`), no de una descripción abstracta del stack.
**Revisión:** 31 de julio de 2026 — actualización de estado contra el código actual del repo (no contra lo que el documento original _asumía_ que se había hecho).

> **Cómo leer este documento:** es la misma auditoría original, con tres cambios: (1) cada fase tiene ahora su estado real verificado línea por línea contra el código, no una casilla optimista; (2) las Fases 3 a 6 quedan desglosadas en sub-fases con el mismo nivel de detalle que ya tenía la Fase 2; (3) se agrega una sección nueva (§5) con los bugs y la deuda técnica que esta revisión encontró leyendo el código — incluido uno que la auditoría original ya había señalado y que **sigue sin resolverse**.

---

## 0. Antes de nada: tu "stack actual" no es el que describís

_(Sin cambios respecto a la versión original — este diagnóstico de partida sigue siendo válido.)_

Lo primero que tengo que decirte, porque cambia todo el diagnóstico: **`deck.gl` no está en tu `package.json`, y `MapLibre GL` tampoco**. Lo que hay en el repo es:

- `ol` (OpenLayers 10) como motor de mapa e interacción.
- Un renderer WebGL **artesanal**, propio, construido sobre `ol/layer/WebGLVector` (`src/map/scene/DrawLayerRenderer.ts`), no deck.gl.
- Un pipeline de **Canvas2D en postrender** (`src/map/scene/PostrenderPainter.ts` + 6 "painters" especializados) para todo lo que WebGL no cubre: cotas, calles, rotondas, snap guides, selección pulsante, previews de subdivisión.
- Web Workers con **JSTS** (puerto JS de una librería Java) y **polygon-clipping** (puro JS) para booleanas y uniones. **Esto sigue siendo así hoy** — ver §5 y §6.2 para el detalle de por qué el motor Rust que se empezó a construir todavía no reemplaza nada de esto en producción.
- Un **Command pattern** con undo/redo propio, bastante más sofisticado que lo que se ve en proyectos GIS típicos.
- Persistencia nativa vía `rusqlite` (esto sí cambió desde la versión original del documento — ver Fase 1, ya completada).

Esto importa porque tu pregunta original ("¿deck.gl + MapLibre o Rust?") partía de una premisa incorrecta. Lo que tenés **no es un stack "genérico de mapas"** — es un **motor CAD/GIS de edición vectorial vivo**. El veredicto de la auditoría original (Rust sí, MapLibre no) sigue siendo correcto y esta revisión no le encuentra motivos para cambiarlo — pero la ejecución de ese veredicto está **a mitad de camino**, y el hallazgo más importante de esta revisión es que **"a mitad de camino" en este caso específico significa que el motor nuevo todavía no le entrega ningún beneficio real al usuario**, porque no está conectado. Ver §5.2.

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

**Estado: PARCIALMENTE ATENDIDO EN CÓDIGO, CERO IMPACTO EN PRODUCCIÓN TODAVÍA.** Existe un crate Rust (`geourban-geo`) con una porción sustancial del motor ya portada (ver Fase 2 en §6). Pero:

- `src/workers/geoOperations.ts` sigue importando `jsts` y `polygon-clipping` y sigue siendo el único código que efectivamente corre cuando el usuario dibuja algo.
- El crate Rust **no tiene un solo comando de Tauri** que lo exponga al frontend, salvo `geo_engine_version` (un ping de diagnóstico). `src-tauri/src/geo_bridge.rs` lo dice explícitamente en su propio comentario: _"Las Fases 2.1-2.5 van a ir agregando acá los comandos reales"_ — y esos comandos todavía no están.
- El feature flag `geos-backend` (que habilita la parte de uniones/booleanas del crate) está **apagado por defecto** en `src-tauri/Cargo.toml`. Es intencional según `README-fase-2.0.md`, pero el efecto práctico es que `boolean_ops.rs` ni siquiera se compila dentro del binario que corre hoy.

En criollo: escribiste una porción real del motor nuevo, pero el usuario de la app de hoy sigue ejecutando exactamente el mismo JSTS/polygon-clipping que describía la auditoría original, con los mismos límites de seguridad (`MAX_UNION_POINTS`, `console.warn` a los 300ms, etc.) actuando de la misma manera que antes. Cero regresión, pero también cero mejora medible todavía.

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

El trabajo hecho en Fase 2.0-2.2 (ver §6) confirma en la práctica lo que la auditoría original predecía: las primitivas geométricas y el motor de subdivisión se portan casi 1:1 a Rust sin fricción, con tests que dan paridad exacta contra los casos conocidos. No hay nada en el código nuevo que sugiera revertir esta decisión.

Lo que **sí** cambia respecto al documento original es la urgencia de terminar el cableado (Fase 2.5): tener el motor escrito y no conectado es, en la práctica, el peor de los dos mundos — mantenés dos implementaciones del mismo algoritmo (la JS que corre y la Rust que no) y pagás el costo de mantenimiento de ambas sin cobrar ningún beneficio de rendimiento todavía. Ver §7, ítem nuevo "8."

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
│  • Cliente hacia Rust vía Tauri `invoke`:                              │
│      - project_save/project_load/project_list/project_delete  ✅ USADO│
│      - geo_engine_version                                     ✅ USADO│
│      - subdivide / computeManzanos / subdivideManzanoBatch /          │
│        computeRoadNetworkNet / matchFragmentsBatch          ❌ NO EXISTEN│
│    → el frontend sigue hablando 100% con geoWorkerClient.ts (JS)       │
│      para todo lo geométrico.                                          │
└───────────────────────────┬────────────────────────────────────────┘
                             │ IPC (hoy: JSON vía serde_json; sin definir aún si se migra a binario)
┌───────────────────────────▼────────────────────────────────────────┐
│  BACKEND NATIVO (Rust, dentro del mismo binario Tauri)                │
│  • Persistencia SQLite nativa (rusqlite, WKB)              ✅ COMPLETO │
│  • Primitivas geométricas puras (math.rs, sanitize.rs,                │
│    roundabout.rs, roads.rs)                                ✅ COMPLETO │
│  • Motor de subdivisión (subdivision.rs,                               │
│    subdivision_cabecera_cuerpo.rs)               🟡 PORTADO, SIN TESTS │
│  • Booleanas (boolean_ops.rs, union/difference vía GEOS)   🟡 ESCRITO, │
│    INACTIVO (feature `geos-backend` off, sin bridge Tauri)            │
│  • Reconciliación de fragmentos (matchFragmentsToMembers)   ❌ NO EXISTE│
│  • Índice espacial nativo (rstar)                           ❌ NO EXISTE│
│  • Comandos Tauri de geometría (los 5 que faltan)           ❌ NO EXISTEN│
└─────────────────────────────────────────────────────────────────────┘
```

**Lectura honesta del diagrama:** la mitad inferior (backend Rust) tiene más código escrito de lo que un vistazo rápido al plan original sugeriría, pero la mitad superior (frontend) todavía no tiene ningún cable conectado a esa mitad inferior salvo para persistencia. El "motor de geometría nativo" existe como librería Rust standalone, testeable con `cargo test`, pero no como parte del producto que corre.

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

### 5.2 — El motor Rust existe pero está desconectado: riesgo de deuda duplicada

No es un bug de comportamiento (el usuario no nota nada raro), pero sí un riesgo de arquitectura: hoy hay **dos** implementaciones del motor de subdivisión y de geometría de rotondas/calles — la de `src/geo/**.ts` (activa) y la de `src-tauri/crates/geourban-geo/src/**.rs` (inactiva). Mientras la Fase 2.5 no cierre:

- Cualquier corrección de bug o cambio de comportamiento en el algoritmo de subdivisión (`subdivisionCabeceraCuerpo.ts`, por ejemplo) tiene que aplicarse **dos veces** para no generar divergencia silenciosa el día que finalmente se conecte el puente.
- No hay ningún test que compare automáticamente el output de ambos motores sobre el mismo input — ver 5.3.

**Recomendación:** tratar el cierre de la Fase 2.5 (cableado de comandos Tauri) como bloqueante de alta prioridad, no como "una fase más" — cada semana que pasa con el motor Rust escrito pero inactivo es una semana de mantenimiento doble sin contrapartida.

### 5.3 — Cobertura de tests desigual dentro del propio crate Rust

Verificado archivo por archivo:

| Archivo                          | Tiene tests unitarios propios                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `math.rs`                        | ✅ Sí — extensos, con casos concretos y tolerancias                                                        |
| `types.rs`                       | ✅ Sí — serialización/formato                                                                              |
| `geojson.rs`                     | ✅ Sí — roundtrip básico                                                                                   |
| `boolean_ops.rs`                 | 🟡 Solo 2 smoke tests triviales (unión y diferencia de dos rectángulos), detrás del feature `geos-backend` |
| `roads.rs`                       | ❌ Ninguno                                                                                                 |
| `roundabout.rs`                  | ❌ Ninguno                                                                                                 |
| `sanitize.rs`                    | ❌ Ninguno                                                                                                 |
| `subdivision.rs`                 | ❌ Ninguno                                                                                                 |
| `subdivision_cabecera_cuerpo.rs` | ❌ Ninguno                                                                                                 |

Esto significa que el criterio de éxito que la Fase 2.1/2.2 originales se proponían ("correr el mismo set de polígonos de prueba por ambos lados y que área/perímetro coincidan dentro de tolerancia") **está cumplido solo para `math.rs`**. El resto del motor de subdivisión (que es, según el propio documento original, "el corazón de tu motor") fue traducido con cuidado manual visible en el código, pero no tiene ninguna prueba automatizada que lo confirme. No es lo mismo "está portado" que "está probado" — ver Fase 2.2/2.6 actualizadas en §6.

### 5.4 — Reconciliación de fragmentos: no iniciada, y es la dependencia que bloquea el resto

`src/geo/roads/fragmentReconciliation.ts` (`matchFragmentsToMembers`, basado en `polygonClipping.intersection`) no tiene ningún equivalente en el crate Rust. Esto importa porque **es la pieza que le da identidad estable a un manzano a través de ediciones** (mantener su id, sus lotes hijos, su método de subdivisión cuando una calle nueva lo recorta) — sin ella, exponer `computeRoadNetworkNet`/`matchFragmentsBatch` como comandos Tauri no tiene sentido, porque el resultado no se podría reconciliar contra el estado existente del proyecto. Es, en la práctica, el ítem que bloquea el cierre de la Fase 2 completa (ver Fase 2.4 en §6).

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

### Fase 2 — Motor de geometría en Rust — 🟡 EN CURSO (≈40% del valor entregado, no del código escrito)

Sub-fases con estado verificado:

#### 2.0 — Decisión de librería + scaffolding — ✅ COMPLETADA

Crate `geourban-geo` creado, tipos compartidos definidos (`types.rs`), decisión tomada: GEOS vía crate `geos`, detrás de `geos-backend` (apagado por defecto). Comando de diagnóstico `geo_engine_version` cableado y funcional.

#### 2.1 — Primitivas puras, sin booleanas — ✅ COMPLETADA (con matiz de cobertura)

`math.rs`, `sanitize.rs`, `roads.rs` (offset de polilíneas + fillet/chamfer), `roundabout.rs` portados. `math.rs` tiene tests con paridad numérica confirmada; `sanitize.rs`/`roads.rs`/`roundabout.rs` no tienen test propio pero la traducción es fiel línea a línea contra el TS (revisión manual). **Pendiente real:** agregar los tests que faltan antes de dar por cerrado el criterio de éxito original de esta sub-fase.

#### 2.2 — Motor de subdivisión — 🟡 CÓDIGO PORTADO, CRITERIO DE ÉXITO NO VERIFICADO

`subdivision.rs` (`subdivideManzanoAuto`/`Exact`, `sliceBisectManzano`, dispatcher) y `subdivision_cabecera_cuerpo.rs` (el algoritmo `auto`, el usado por default) están escritos y — a juzgar por la lectura — son una traducción cuidadosa del TS, incluyendo las heurísticas de remanente y fusión de cabeceras. **Lo que falta específicamente:**

- Ningún test unitario compara su output contra el TS sobre manzanos reales.
- No hay ningún comando Tauri que lo exponga (eso es Fase 2.5).
- **Nuevo criterio de éxito explícito para cerrar esta sub-fase:** tomar 20-30 manzanos reales del dataset sintético (una vez ampliado en Fase 6.1 para incluir calles/rotondas, no solo lotes en grilla), correr `subdivideManzano` en TS y `subdivide_manzano` en Rust sobre los mismos anillos, y aserция automática de que `areaM2`/`frontM`/`depthM`/cantidad de lotes coinciden dentro de tolerancia. Esto se puede hacer **sin esperar a la Fase 2.5** — alcanza con un `cargo test` que embeba unos cuantos anillos de ejemplo como fixtures, algo que ya podría empezar hoy mismo con bajo esfuerzo.

#### 2.3 — Capa de booleanas — 🟡 ESCRITO, INACTIVO EN EL BINARIO

`boolean_ops.rs` implementa `union_rings` (con la misma lógica de reintento/auto-limpieza que `roadNetworkNet.ts`), `robust_union_road_network`/`compute_manzanos` (equivalente de `geoOperations.ts`), y — adelantado respecto al orden original del plan — **también `compute_road_network_net`** (que el documento original ubicaba recién como consecuencia de cerrar 2.4; resulta que no depende de la reconciliación de fragmentos, solo de `union_rings` + `round_ring_reflex`, ambos ya disponibles). Tiene 2 smoke tests de GEOS (unión y diferencia de rectángulos).
**Bloqueadores para cerrar esta sub-fase:**

- El feature `geos-backend` sigue apagado por defecto — nadie ha validado que compile y corra con GEOS realmente instalado/vendored en un entorno de build limpio.
- Cero comparación de paridad contra el JS con geometría real (solo casos sintéticos triviales).
- Versión del crate `geos` fijada en `"8"` sin revisar si sigue vigente — el propio `README-fase-2.0.md` ya señalaba esto como pendiente de verificar.

#### 2.4 — Reconciliación de fragmentos — ❌ NO INICIADA

Sin ningún puerto de `matchFragmentsToMembers`/`ringIntersectionAreaRaw` (`fragmentReconciliation.ts`). Es la pieza que falta para que `computeRoadNetworkNet` y `matchFragmentsBatch` tengan sentido de punta a punta (ver §5.4). Sub-tareas concretas para arrancarla:

- 2.4.a: puerto de `ringIntersectionAreaRaw` usando GEOS `intersection()` + `area()` (mismo patrón que `boolean_ops.rs` ya usa para union/difference — reutilizable casi 1:1).
- 2.4.b: puerto del algoritmo de asignación greedy por mejor solapamiento (`MATCH_MIN_RATIO = 0.35`), que es aritmética pura sin GEOS de por medio, portable independientemente de 2.4.a si se quiere paralelizar el trabajo.
- 2.4.c: test de paridad sobre el corpus de reconciliación real (parcelas con manzanos ya lotizados, recortadas por una calle nueva).

#### 2.5 — Cableado de comandos Tauri + reemplazo de `geoWorkerClient.ts` — ❌ NO INICIADA

Verificado en `src-tauri/src/lib.rs`: el único comando geométrico registrado es `geo_engine_version`. Ninguno de los 6 tipos de request que resuelve hoy `geoWorker.ts` (`subdivide`, `subdivideManzano`, `subdivideManzanoBatch`, `computeManzanos`, `computeRoadNetworkNet`, `matchFragmentsBatch`) tiene comando Tauri equivalente. Esta sub-fase depende de que 2.4 cierre (para los dos últimos tipos) pero **`subdivide`/`subdivideManzano`/`subdivideManzanoBatch`/`computeManzanos` ya podrían cablearse hoy** sin esperar nada más — es la ganancia más rápida disponible ahora mismo. Sugerencia de secuencia interna:

- 2.5.a: cablear primero `subdivide`/`subdivideManzano`/`subdivideManzanoBatch` (dependen solo de 2.1+2.2, ya escritos) detrás de un flag de "usar motor nativo" opcional, para poder hacer A/B en la propia app antes de sacar el JS.
- 2.5.b: cablear `computeManzanos` (depende de 2.3, requiere activar `geos-backend` en el build real).
- 2.5.c: cablear `computeRoadNetworkNet`/`matchFragmentsBatch` una vez cerrada 2.4.
- 2.5.d: recién ahí, reemplazar los call-sites de `geoWorkerClient.ts` uno por uno.

#### 2.6 — Paridad y fuzzing — ❌ NO INICIADA (bloqueada por 2.4/2.5, pero el fuzzing de math.rs/subdivision podría adelantarse, ver 2.2)

#### 2.7 — Validación de performance + limpieza — ❌ NO INICIADA

`jsts` y `polygon-clipping` siguen en `package.json` y siguen siendo importados activamente por `geoOperations.ts`/`roadNetworkNet.ts`/`fragmentReconciliation.ts`. No se puede borrar nada de esto hasta que 2.5 termine.

**Resumen de Fase 2 en una frase:** el trabajo de "traducir el algoritmo" (2.0-2.2, y buena parte de 2.3) está más avanzado de lo que el criterio de éxito formal puede confirmar todavía; el trabajo de "conectarlo al producto" (2.4, 2.5) prácticamente no empezó. Priorizar 2.5.a (cableado de lo que ya está listo) sobre seguir escribiendo más Rust sin conectar nada es la recomendación de mayor impacto de esta revisión.

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

### Resumen de tiempos restantes

| Fase                               | Estado                                               | Trabajo restante estimado                          |
| ---------------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| 0 — Instrumentación                | ✅ Completa                                          | —                                                  |
| 1 — Persistencia                   | ✅ Completa                                          | —                                                  |
| 2.0-2.1 — Scaffolding + primitivas | ✅ Completa (falta cobertura de tests en 3 archivos) | 2-3 días                                           |
| 2.2 — Subdivisión                  | 🟡 Portado, sin verificar                            | 3-5 días (tests de paridad)                        |
| 2.3 — Booleanas                    | 🟡 Escrito, inactivo                                 | 1 semana (activar feature, validar build, paridad) |
| 2.4 — Reconciliación de fragmentos | ❌ No iniciada                                       | 1-1.5 semanas                                      |
| 2.5 — Cableado Tauri               | ❌ No iniciada                                       | 1-1.5 semanas                                      |
| 2.6 — Fuzzing/paridad              | ❌ No iniciada                                       | 3-4 días                                           |
| 2.7 — Limpieza JS                  | ❌ No iniciada                                       | 2-3 días                                           |
| 3 — Undo/redo estructural          | ❌ No iniciada                                       | 2-2.5 semanas                                      |
| 4 — Índice espacial + render       | ❌ No iniciada (bug 5.1 pendiente)                   | 3-3.5 semanas                                      |
| 5 — CRS afín                       | ❌ No iniciada                                       | 1.5-2 semanas                                      |
| 6 — Estrés                         | ❌ No iniciada                                       | 2.5-3 semanas                                      |

**Total restante estimado: ~14-16 semanas** desde hoy, asumiendo 1-2 ingenieros senior dedicados — muy similar al remanente que ya proyectaba el documento original, porque el trabajo de Fase 2 que se hizo (código escrito) todavía no descontó tiempo de la parte que faltaba (cableado + validación), que sigue de punta a punta.

---

## 7. Trucos de nivel senior — estado

_(Preservados del original, con nota de estado agregada a cada uno.)_

**7.1 — Linealización afín de la proyección UTM** — ❌ pendiente (Fase 5).

**7.2 — WKB, no GeoJSON, en cualquier límite de serialización** — ✅ parcialmente aplicado: la persistencia (Fase 1) ya usa WKB. **Pendiente:** el snapshot de undo (Fase 3) y el IPC de geometría (Fase 2.5, hoy usaría `serde_json` por decisión explícita de 2.0, "optimizar después") todavía no.

**7.3 — Transferables, no clonado estructurado, en `postMessage`** — ❌ sin cambios, sigue pendiente en `geoWorkerClient.ts` mientras siga en uso.

**7.4 — Bulk-load STR, no inserción incremental** — el lado JS (`RBush.load()`) ya lo hace bien y sigue así. El lado Rust (`rstar`) todavía no existe — cuando se construya (Fase 4.1), aplicar el mismo criterio desde el día uno.

**7.5 — Progreso vía eventos del backend** — ❌ sin cambios, sigue pendiente de que exista trabajo pesado corriendo en Rust para que tenga sentido.

**7.6 — Preservar el patrón de "firma para gatear trabajo caro"** — el patrón sigue vivo donde ya estaba (`layerSignature`, `streetsHash`), pero **sigue sin aplicarse en `LabelPainter`**, que es justo el ejemplo que el documento original señalaba como pendiente. Sin cambios ahí — ver Fase 4.3.

**7.7 — SDF para labels** — sin cambios, sigue siendo "no lo hagas antes de necesitarlo".

**7.8 — Nuevo, agregado en esta revisión: no dejes crecer motor Rust sin consumidores reales.** Ver §5.2. La regla concreta: por cada sub-fase de Fase 2 que se cierre de ahora en más, cerrarla debería incluir _como mínimo_ un test de paridad contra el TS — no basta con que compile. Escribir Rust sin verificarlo contra el comportamiento real que reemplaza es acumular la misma clase de riesgo que "migrar todo de una" (§8 del documento original), solo que distribuido en el tiempo en vez de concentrado en un big-bang.

---

## 8. Lo que NO vas a hacer (anti-patrones a evitar activamente)

_(Preservado del original, con un ítem nuevo al final.)_

1. No reescribas la capa de interacción de OpenLayers.
2. No adoptes MapLibre.
3. No muevas todo detrás de IPC de Tauri sin distinguir hot-path de batch.
4. No sigas usando `sql.js`/`dexie` — **ya resuelto, este ítem queda cerrado.**
5. No optimices el pipeline de labels/SDF antes de tener el dato de que lo necesitás.
6. No parchees la race condition del índice espacial con más `console.warn` — **sigue sin resolverse, ver §5.1. Este es el ítem más urgente de toda la lista de anti-patrones, porque es el único que ya lleva dos revisiones señalado sin acción.**
7. No avances de una sub-fase de la Fase 2 a la siguiente sin su criterio de éxito verificado — **matizado por esta revisión:** en la práctica sí se avanzó de 2.1/2.2 a escribir 2.3 sin haber cerrado los tests de paridad de las anteriores. No es catastrófico todavía (el código nuevo no está en producción), pero es la razón exacta por la que §5.3 encuentra cobertura de tests desigual. Corregir el hábito antes de la Fase 2.4/2.5, no después.
8. **Nuevo:** no sigas escribiendo más código Rust nuevo (2.4 en adelante) mientras 2.5.a (cablear lo que YA está listo: `subdivide`/`subdivideManzano`/`subdivideManzanoBatch`) siga sin hacerse. Es la ganancia disponible más barata hoy y seguir posponiéndola es la forma más segura de que esta fase se estire indefinidamente sin que nadie pueda demostrar el beneficio.

---

## 9. Cómo vas a saber que funcionó — métricas actualizadas

| Métrica                                     | Estado hoy (esta revisión)                                                               | Objetivo post-migración                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Carga de proyecto urbano completo           | ✅ Resuelto en Fase 1, confirmado en código                                              | < 500ms                                                                      |
| Trazar 1 calle en proyecto de 200k features | ❌ Sin cambios — sigue siendo O(n) por snapshot GeoJSON completo                         | O(cambios reales), independiente de n                                        |
| Unión de red vial, 5.000 segmentos          | ⏸ No medible todavía — motor Rust escrito pero inactivo (feature off, sin comando Tauri) | < 100ms                                                                      |
| FPS con 200k features en viewport           | ❌ Sin cambios — LOD tiers degradan desde 350-900 features                               | 60fps sostenidos                                                             |
| Memoria con dataset de 1M features          | ⏸ Sin medir (heap de JS sí se mide; memoria nativa del proceso, no)                      | < 2GB confirmado con profiler nativo                                         |
| Motor de geometría en producción            | JS interpretado (JSTS + polygon-clipping) — sin cambios, es lo único que corre hoy       | GEOS/`geo` nativo vía Rust, con comandos Tauri reales                        |
| Índice espacial                             | RBush JS, con bug de resincronización activo (§5.1) sin resolver                         | RBush JS + `rstar` nativo, con causa raíz del bug corregida antes de escalar |
| Cobertura de tests de paridad JS↔Rust       | 1 de 9 módulos del crate (`math.rs`) con paridad numérica confirmada                     | Los 9 módulos, antes de retirar el motor JS equivalente                      |

---

Esta sigue siendo una hoja de ruta, no una promesa — la diferencia con la versión anterior de este documento es que ahora cada casilla de "completado" está respaldada por una lectura real del código, no por la expectativa de que el plan se ejecutó tal como se escribió. El hallazgo central de esta revisión, si hay que quedarse con uno solo: **el trabajo más difícil de estimar (portar el algoritmo) ya está bastante avanzado; el trabajo más fácil de subestimar (conectarlo, probarlo, y borrar lo viejo) todavía no arrancó, y es ahí donde está el resto del cronograma.**
