# Diagnóstico avanzado y plan de mejora — GeoUrban (cuelgue + crash de topología)

**Fecha del análisis:** revisión estática completa del código fuente compartido (≈150 archivos).
**Síntoma reportado por el usuario:**

```
DEBUG
FPS 0            FPS avg 38.4
WebGL layers 5   Features 1227
Postrender last 57269.00 ms   Postrender avg 1127.60 ms
setStyle/min 0   syncLayerSet/min 0   syncGizmo/min 0

recomputeManzanos.ts:302 Validación topológica automática falló
TypeError: Cannot read properties of undefined (reading 'features')
    at runBackgroundTopologyCheck (recomputeManzanos.ts:300:74)
```

---

## 0. Resumen ejecutivo

Hay **dos problemas distintos pero entrelazados**:

| #   | Problema                                                                                              | Severidad                                                          | Causa raíz confirmada                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `TypeError: Cannot read properties of undefined (reading 'features')` en `runBackgroundTopologyCheck` | 🔴 Crítico — se dispara de forma **determinista**, no intermitente | Bug de concurrencia en `src/workers/geoWorkerClient.ts`: dos requests distintos (`findOverlaps` y `findGaps`) comparten el mismo `Worker` singleton y **no hay correlación de mensajes**, por lo que sus promesas se resuelven cruzadas.                                                                                                                                                                |
| 2   | Cuelgue de UI: `Postrender last = 57269 ms`, `avg = 1127.60 ms`, `FPS = 0`                            | 🔴 Crítico — la app es inutilizable con 1227 features              | Trabajo de geometría computacional **pesado y sin límite de complejidad**, ejecutado **de forma síncrona dentro del hilo principal y dentro del propio callback de `postrender`** (`StreetPainter.update → computeRoadNetworkNet → polygon-clipping`), combinado con un pintado de etiquetas/cotas **O(n²) por frame** en `LabelPainter` que se re-ejecuta en cada tick de render sin memoización real. |

Los contadores del panel de debug (`setStyle/min: 0`, `syncLayerSet/min: 0`, `syncGizmo/min: 0`) **descartan** al renderer WebGL de capas (`DrawLayerRenderer.ts`) como causa — el problema está 100% en el pipeline canvas-2D de overlay (`PostrenderPainter` y sus painters) y en el pipeline de recompute de manzanos/calles (`recomputeManzanos.ts`, `fragmentReconciliation.ts`, `roadNetworkNet.ts`).

Ambos problemas comparten un patrón de fondo: **operaciones costosas y sin cota de tiempo, corriendo en el hilo principal, dentro o cerca del camino de render**, sin telemetría que permita aislar cuál geometría específica dispara el peor caso.

---

## 1. Mecanismo exacto del crash (`gaps.features` undefined)

### 1.1 Código involucrado

`src/geo/recomputeManzanos.ts`:

```ts
const [overlaps, gaps] = await Promise.all([
  findOverlapsInWorker(collection),
  findGapsInWorker(collection),
]);
...
useTopologyWarningsStore.getState().setResults(overlaps.length, gaps.features.length, affected); // línea ~300
```

`src/workers/geoWorkerClient.ts`:

```ts
const INTERACTIVE_TYPES = new Set(['subdivide', 'subdivideManzano', 'computeManzanos']);

function pickWorker(type) {
  return INTERACTIVE_TYPES.has(type) ? getInteractiveWorker() : getBatchWorker();
}

function runWorker(request) {
  return new Promise((resolve, reject) => {
    const w = pickWorker(request.type);
    const onMessage = (event) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data); // ⚠️ no valida event.data.type
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage(request);
  });
}
```

`findOverlapsInWorker` y `findGapsInWorker` **no** están en `INTERACTIVE_TYPES` ⇒ **ambos usan el mismo `batchWorker` singleton**. `subdivideManzanoBatchInWorker` (usado por "Generar todos los lotes") **también** cae en el mismo bucket `batch`.

### 1.2 Secuencia exacta que produce el error (100% reproducible, no es una carrera rara)

1. `Promise.all([findOverlapsInWorker(collection), findGapsInWorker(collection)])` invoca **ambas** llamadas de forma síncrona, una después de otra.
2. `findOverlapsInWorker` → `runWorker({type:'findOverlaps'})` → obtiene `batchWorker`, registra el listener **L1** (`message`/`error`), hace `postMessage(req1)`.
3. `findGapsInWorker` → `runWorker({type:'findGaps'})` → obtiene el **mismo** `batchWorker`, registra el listener **L2**, hace `postMessage(req2)`.
4. En este punto **L1 y L2 están ambos suscritos al mismo evento `message` del mismo Worker**, sin ningún `requestId` que los distinga.
5. El worker (hilo único) procesa `req1` (`findOverlaps`) primero y responde con `resp1 = {type:'findOverlaps', overlaps:[...]}`.
6. Ese `resp1` dispara el evento `message` en el hilo principal. **Ambos** listeners (L1 y L2) reciben el mismo evento:
   - L1 (el correcto) resuelve `findOverlapsInWorker` con `resp1` → ✅ correcto.
   - L2 (el de `findGaps`, que no filtra por tipo) **también** resuelve `findGapsInWorker` con `resp1` → ❌ recibe `{type:'findOverlaps', overlaps:[...]}`, que **no tiene** propiedad `gaps`.
   - Ambos listeners se auto-eliminan (`removeEventListener`) tras disparar.
7. `findGapsInWorker` hace `return response.gaps` → `undefined` (porque `response` es en realidad la respuesta de overlaps).
8. Cuando llega `resp2` (la respuesta real de `findGaps`), **ya no queda ningún listener** en el worker (ambos se removieron en el paso 6) ⇒ el mensaje correcto se descarta silenciosamente.
9. `gaps` termina siendo `undefined` → `gaps.features.length` explota con el `TypeError` reportado.

> **Esto no es una condición de carrera improbable: es determinista.** Ocurre cada vez que dos requests "batch" se disparan en paralelo sobre el mismo worker — lo cual pasa en **cada ciclo de `recomputeManzanos()`**, ya que `runBackgroundTopologyCheck` siempre llama a `findOverlapsInWorker` + `findGapsInWorker` juntos vía `Promise.all`. Con 1227 features y ediciones frecuentes de calles/manzanos, esto se dispara constantemente.

### 1.3 Efecto colateral: corrupción silenciosa, no solo crash

El mismo patrón afecta a `subdivideManzanoBatchInWorker` (usado en "Generar todos los lotes", `GenerateLotsCommand.ts`) porque **también** usa el bucket `batch`. Si una validación de topología (`checkTopologyInBackground`, disparada al final de cada `recomputeManzanosImmediate`) queda en vuelo mientras el usuario dispara "Generar todos", **ambos flujos comparten el mismo worker y pueden cruzar respuestas** — no solo se rompería con un `TypeError` visible, sino que en combinaciones donde las formas de respuesta _coinciden por casualidad_ (p. ej. ambas tienen un array), se podría **inyectar silenciosamente geometría incorrecta** en el pipeline de manzanos, generando anillos degenerados que después alimentan a `polygon-clipping` (ver sección 2) con datos patológicos.

---

## 2. Mecanismo probable del cuelgue de 57 segundos / 1127 ms promedio

### 2.1 Lo que el propio panel de debug descarta

`setStyle/min: 0`, `syncLayerSet/min: 0`, `syncGizmo/min: 0` ⇒ el renderer WebGL de capas (`DrawLayerRenderer.ts` / `LayeredWebglRenderer`) **no** recompiló shaders ni resincronizó capas en el último minuto. El cuello de botella está exclusivamente en:

- el callback `postrender` (canvas 2D overlay) — `src/map/scene/PostrenderPainter.ts` y sus painters, y/o
- el pipeline síncrono de recompute que corre en el hilo principal — `src/geo/recomputeManzanos.ts`, `src/geo/roads/roadNetworkNet.ts`, `src/geo/roads/fragmentReconciliation.ts`.

### 2.2 Causa crónica (explica el promedio de 1127 ms, no solo el pico)

`PostrenderPainter.handle()` se ejecuta **en cada frame de render de OpenLayers**, sin ningún mecanismo de "skip si nada cambió" salvo el flag `dirty` (que solo gatea el recálculo de `lotGroupCounts`, no el pintado en sí). Dentro:

```ts
this.labelPainter.paint(ctx, visibleFeatures, zoom, resolution, toPx, this.interacting);
this.streetPainter.paint(...);
```

`LabelPainter.paintFeatureLabels` recorre **todas** las features visibles y, por cada una, llama a `isColliding(...)`:

```ts
function isColliding(ctx, coord, text, boxes, toPx) {
  ...
  for (const b of boxes) { /* compara contra TODAS las cajas ya colocadas */ }
  boxes.push(...);
  return false;
}
```

Esto es **O(n²)** en el número de features con etiqueta (con 1227 features, ~1.5M comparaciones por frame). A eso se le suma `drawSegmentLabels`, que —si el zoom supera `COTA_APPEAR_ZOOM = 19.6`— dibuja **una etiqueta de cota por cada segmento de cada polígono** (líneas de extensión, ticks, texto rotado, `ctx.save/restore` por segmento). Los manzanos con esquinas redondeadas (`roundRingReflex` → `cornerFilletArc`) pueden generar **decenas de vértices adicionales por esquina** (`steps = ceil(Δángulo / 0.18)`), multiplicando el número real de segmentos muy por encima del número de "lados lógicos" del polígono.

Con 1227 features (muchas de ellas manzanos/lotes con esquinas filleteadas) y zoom alto, esto fácilmente explica un promedio sostenido de >1 segundo por frame — **la app nunca llega a ser fluida, con o sin el pico de 57 s.**

### 2.3 Causa del pico (57269 ms) — geometría computacional pesada dentro del callback de render

`updateCaches()` (llamado al **inicio** de `handle()`, o sea, dentro de la ventana medida por `recordPostrenderDuration`) invoca:

```ts
this.streetPainter.update(ctx, zoom, this.dirty, resolution);
```

y dentro de `StreetPainter.update`, si el hash de alguna calle cambió desde el último frame:

```ts
if (groupStreetsChanged || groupCornerModeChanged) {
  cache.net = computeRoadNetworkNet(group.streets); // ⬅️ UNIÓN DE POLÍGONOS + FILLETS
}
```

`computeRoadNetworkNet` (`src/geo/roads/roadNetworkNet.ts`) llama a `unionRings(...)`, que usa **`polygon-clipping` (algoritmo tipo Martinez-Rueda)** para unir todos los anillos de calzada/vereda, y luego aplica `roundRingReflex` (fillets) anillo por anillo. Esto:

- **Corre síncronamente en el hilo principal**, dentro del propio callback de `postrender` — cualquier cosa costosa acá bloquea el frame y **se mide como parte de `postrenderLastMs`**, lo que calza exactamente con el valor reportado (57269 ms).
- Solo tiene una cota de **cantidad de puntos** (`MAX_UNION_POINTS = 15000`), **no una cota de tiempo**. `polygon-clipping` no es O(n) en el peor caso: geometría degenerada (segmentos casi-colineales, vértices casi-duplicados, self-intersections tras el redondeo a `UNION_PRECISION = 1e6`) puede disparar un número de intersecciones espurias muy superior a lo esperado, haciendo que la unión tarde órdenes de magnitud más de lo normal — sin ningún guardarraíl que lo corte.
- **El trigger es sensible a cambios**: el hash de calles (`streetsHash`) se recalcula por posición exacta. Si en algún flujo las calles cambian de forma continua (arrastre de un extremo, sliders de ancho en `StreetPanel.tsx` disparando `updateStreet` en cada `onChange`), **cada micro-cambio puede volver a disparar la unión completa** dentro del próximo `postrender`, en vez de estar debounced fuera del camino de render.

Además, `src/geo/roads/fragmentReconciliation.ts::matchFragmentsToMembers` (usado en `recomputeManzanosImmediate`, también en el hilo principal) hace:

```ts
for (let fi = 0; fi < fragments.length; fi++) {
  for (let mi = 0; mi < members.length; mi++) {
    const overlap = ringIntersectionArea(fragments[fi], members[mi].ring); // polygonClipping.intersection
  }
}
```

Esto es **O(fragmentos × miembros)** llamadas a `polygonClipping.intersection`, **sin ningún límite superior**, y **sin mover el trabajo a un worker** (a diferencia de `computeManzanosInWorker`, que sí corre en worker). Con manzanos muy fragmentados (muchas calles cruzándose) esto escala mal y de forma impredecible.

### 2.4 Cadena causal más probable (crash → corrupción → cuelgue)

1. El bug de la sección 1 corrompe/pierde respuestas de operaciones geométricas en el `batchWorker` compartido.
2. En el peor caso, esto puede filtrar geometría degenerada (anillos mal cerrados, duplicados, vacíos) hacia `recomputeManzanosImmediate`.
3. Esa geometría llega, sin sanear, a `unionRings` / `matchFragmentsToMembers`, que la procesan **síncronamente en el hilo principal**, dentro (o justo antes) del callback de `postrender`.
4. El caso patológico de `polygon-clipping` sobre esa geometría produce el pico de 57 segundos; mientras tanto, el trabajo O(n²) de `LabelPainter` ya venía consumiendo ~1.1 s por frame de base, por lo que **el usuario percibe la app como completamente colgada** (FPS 0) incluso fuera del pico.

Esta cadena es la hipótesis mejor soportada por el código, pero **independientemente de si se confirma la corrupción cruzada como disparador exacto del pico**, los tres problemas de diseño (worker sin correlación de mensajes, geometría sin cota de tiempo en el hilo principal, pintado O(n²) por frame) son reales, están confirmados por lectura directa del código, y **deben resolverse los tres** para que la app sea estable con >1000 features.

---

## 3. Tabla de hallazgos por archivo

| Archivo                                                                                                 | Severidad                 | Hallazgo                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/workers/geoWorkerClient.ts`                                                                        | 🔴 Crítica                | Sin `requestId`/correlación de mensajes; múltiples requests del mismo bucket (`findOverlaps`+`findGaps`, y `subdivideManzanoBatch`) comparten un único `Worker` y se resuelven cruzados. Causa raíz del crash reportado.                                                                                                                                            |
| `src/geo/recomputeManzanos.ts`                                                                          | 🔴 Crítica                | `runBackgroundTopologyCheck` no valida forma de la respuesta antes de usarla; se ejecuta en _cada_ recompute sin cancelación de la corrida anterior (sin `AbortController`/contador de generación) — resultados obsoletos pueden pisar a los nuevos. `window.confirm(...)` bloqueante en medio del pipeline de recompute (mala UX, puede leerse como "se congeló"). |
| `src/geo/roads/roadNetworkNet.ts`                                                                       | 🔴 Crítica                | `unionRings` solo limita por cantidad de puntos, no por tiempo; se invoca de forma síncrona dentro de `StreetPainter.update`, que a su vez corre dentro del callback de `postrender`. Sin este límite de tiempo, un caso patológico bloquea el frame por completo (candidato directo al pico de 57 s).                                                              |
| `src/geo/roads/fragmentReconciliation.ts`                                                               | 🟠 Alta                   | `matchFragmentsToMembers` es O(fragmentos×miembros) con `polygonClipping.intersection` en cada celda, corre en el hilo principal, sin worker y sin límite de complejidad.                                                                                                                                                                                           |
| `src/map/scene/painters/LabelPainter.ts`                                                                | 🟠 Alta                   | `isColliding` es O(n²) por frame (recorre todas las cajas ya colocadas por cada feature). `drawSegmentLabels` dibuja una cota completa (líneas + texto) por cada segmento de cada polígono visible, sin LOD ni límite de densidad — con esquinas filleteadas, el conteo real de segmentos es mucho mayor al de "lados" del polígono.                                |
| `src/map/scene/painters/StreetPainter.ts`                                                               | 🟠 Alta                   | `update()` no está gateado por `interacting`; el recálculo costoso (`computeRoadNetworkNet`) puede dispararse en medio de una interacción (arrastre/slider) porque corre dentro del ciclo normal de render.                                                                                                                                                         |
| `src/map/scene/PostrenderPainter.ts`                                                                    | 🟡 Media                  | No hay presupuesto de tiempo por frame ni "frame budget"/time-slicing; todo el trabajo de `updateCaches` + 5 painters se ejecuta siempre de forma síncrona y completa, sin priorizar lo visible primero ni recortar trabajo si el frame anterior ya fue lento.                                                                                                      |
| `src/store/entities/streetStore.ts` / `src/components/panels/StreetPanel.tsx`                           | 🟡 Media                  | `updateStreet` se llama en cada `onChange` de inputs numéricos sin debounce local; cada cambio dispara `recomputeManzanos()` (sí debounced a 250 ms) pero también invalida el hash de `StreetPainter`, re-disparando la unión pesada en el próximo `postrender`.                                                                                                    |
| `src/geo/metrics.ts`                                                                                    | 🟡 Media                  | `refreshSourceMetrics` recorre y recalcula métricas de **todas** las features del `drawSource` (proyecciones punto a punto vía `proj4`) en operaciones masivas (import, undo, generar lotes); sin _chunking_ ni progreso, puede sumar tiempo notable con >1000 features.                                                                                            |
| `src/workers/geoWorkerClient.ts` (pool)                                                                 | 🟡 Media                  | Solo 2 workers fijos (`interactive`/`batch`); ambos son singletons de por vida de la sesión, sin _pool_ dinámico ni _warm restart_ si uno queda en mal estado tras un error no controlado.                                                                                                                                                                          |
| `src/store/topologyWarningsStore.ts`                                                                    | 🟢 Baja                   | `setResults`/`setChecking` no versionan la respuesta (sin _stale check_); una respuesta tardía de un chequeo viejo puede sobrescribir a una más reciente.                                                                                                                                                                                                           |
| `src/map/scene/DrawLayerRenderer.ts`                                                                    | ✅ Descartado como causa  | `setStyle/min` y `syncLayerSet/min` en 0 confirman que no es el origen del cuelgue reportado; queda como candidato secundario solo si en el futuro se ven esos contadores subir.                                                                                                                                                                                    |
| Resto de componentes React de panel (`ManzanoPanel`, `LayerPanel`, `StatsPanel`, `PropertyPanel`, etc.) | ✅ Sin hallazgos críticos | Usan `useDrawSourceTick` (throttle 150 ms) o `useMemo` correctamente; no están en el camino caliente del cuelgue reportado. Se listan optimizaciones menores en la Fase 6.                                                                                                                                                                                          |
| `src/geo/subdivision/*.ts` (algoritmos de lotización)                                                   | ✅ Sin hallazgos críticos | Todos los bucles tienen cotas explícitas (`if (++lotCount > 500) break`, `for (iter < 120/160/200)`), no son candidatos a bucle infinito.                                                                                                                                                                                                                           |

---

## 4. Plan de mejora por fases

> Cada fase es desplegable de forma independiente. Las Fases 1 y 2 son **hotfixes** y deberían salir juntas como un parche urgente; el resto es estabilización y performance estructural.

### Fase 1 — Hotfix crítico: correlación de mensajes en `geoWorkerClient.ts`

**Objetivo:** eliminar el crash determinista y la posibilidad de corrupción cruzada de datos entre workers compartidos.
**Prioridad:** 🔴 Inmediata (bloqueante).
**Esfuerzo estimado:** 0.5–1 día.

Tareas:

1. Añadir un `requestId` incremental a cada `GeoWorkerRequest` y devolverlo en cada `GeoWorkerResponse`.
2. En `runWorker`, filtrar el listener por `event.data.requestId === myId` (o, más simple y robusto: usar un `Map<requestId, {resolve, reject}>` por worker y un único listener de `message` por worker que despache al `resolve`/`reject` correcto).
3. Alternativa más simple si se prefiere no tocar el protocolo: crear **un `Worker` nuevo por request** en vez de reusar un singleton para operaciones "batch" (más costoso en arranque, pero elimina la clase de bug de raíz). Para el caso de este proyecto, se recomienda la opción del `Map` de correlación (mínimo costo, máxima robustez).
4. Sanear el uso de `Promise.all` en `runBackgroundTopologyCheck`: validar explícitamente `response?.type === 'findGaps'` antes de leer `.features`, y lanzar un error claro (no un `TypeError` genérico) si la forma no coincide — defensa en profundidad además del fix estructural.
5. Test de regresión: disparar `findOverlapsInWorker` y `findGapsInWorker` en paralelo 50 veces seguidas (incluyendo intercalado con `subdivideManzanoBatchInWorker`) y verificar que cada promesa resuelve con el `type` esperado.

**Criterio de aceptación:** el `TypeError` reportado deja de ocurrir bajo cualquier combinación de llamadas concurrentes a workers "batch"; test de estrés (50 corridas concurrentes) pasa sin cruces.

**Boceto de la solución (referencia, no diff final):**

```ts
// geoWorkerClient.ts
let nextRequestId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

function attachDispatcher(w: Worker) {
  w.addEventListener(
    'message',
    (event: MessageEvent<GeoWorkerResponse & { requestId: number }>) => {
      const entry = pending.get(event.data.requestId);
      if (!entry) return; // respuesta huérfana (timeout ya la limpió) — se ignora a propósito
      pending.delete(event.data.requestId);
      if (event.data.error) entry.reject(new Error(event.data.error));
      else entry.resolve(event.data);
    }
  );
  w.addEventListener('error', (err) => {
    // opcional: rechazar todas las pendientes de este worker y recrearlo
  });
}

function runWorker<T>(request: GeoWorkerRequest): Promise<T> {
  const requestId = nextRequestId++;
  const w = pickWorker(request.type);
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    w.postMessage({ ...request, requestId });
  });
}
```

(El worker debe hacer eco del `requestId` recibido al responder — un cambio de una línea en `geoWorker.ts`.)

---

### Fase 2 — Robustecer el pipeline de `recomputeManzanos`

**Objetivo:** evitar resultados obsoletos, checks redundantes y bloqueos de UI por diálogos síncronos.
**Prioridad:** 🔴 Alta.
**Esfuerzo estimado:** 1–2 días.

Tareas:

1. Añadir un **contador de generación** (`let topologyCheckGen = 0`) en `checkTopologyInBackground`: cada corrida incrementa el contador y captura su valor; al recibir la respuesta, si el contador global ya avanzó, descartar el resultado (evita que un chequeo lento "pise" a uno más reciente).
2. Evitar relanzar el chequeo de topología si ya hay uno en vuelo para el mismo `drawSource` — usar un flag `inFlight` o `AbortController` para cancelar el anterior antes de lanzar uno nuevo, en vez de dejarlos correr todos en paralelo.
3. Reemplazar `window.confirm(...)` (bloqueante, síncrono) dentro de `recomputeManzanosImmediate` por un modal asíncrono no bloqueante (ya existe infraestructura de `Modal` en el proyecto — reutilizar el patrón de `SubdivisionDialog`), para no congelar el hilo principal en medio del recompute.
4. Envolver la lectura de la respuesta del worker con _type guards_ explícitos (`isFindGapsResponse`, `isFindOverlapsResponse`) antes de acceder a sus campos, como defensa adicional a la Fase 1.

**Criterio de aceptación:** al disparar múltiples recomputes seguidos rápidamente (p. ej. editar 5 calles en menos de 1 segundo), solo se aplica el resultado del último chequeo de topología; no quedan promesas huérfanas escribiendo estado viejo.

---

### Fase 3 — Sacar la geometría pesada del camino de render

**Objetivo:** que ningún cálculo de unión/intersección de polígonos bloquee un frame de `postrender`.
**Prioridad:** 🔴 Alta (ataca directamente el pico de 57 s).
**Esfuerzo estimado:** 3–5 días.

Tareas:

1. **Mover `computeRoadNetworkNet` fuera de `StreetPainter.update`** hacia un cálculo desacoplado del ciclo de render: recalcular en un `useEffect`/suscripción al `streetStore` con **debounce explícito** (p. ej. 150–250 ms), guardando el resultado en un caché que `StreetPainter.paint` solo _lee_ (nunca recalcula). El callback de `postrender` debe ser **puramente de lectura/pintado**, nunca de cómputo geométrico pesado.
2. Añadir un **límite de tiempo duro** (no solo de puntos) a `unionRings`: envolver la llamada a `polygonClipping.union` con un _time-boxing_ cooperativo — si se dispone de Web Worker para esto (ver punto 4), usar `AbortController`/timeout allí; si debe quedar en el hilo principal como fallback, al menos loguear con `console.warn` + telemetría cuándo se supera un umbral (p. ej. 200 ms) para poder diagnosticar geometría problemática en producción.
3. Mover `matchFragmentsToMembers`/`ringIntersectionArea` (`fragmentReconciliation.ts`) a un **Web Worker dedicado** (puede reusar el `interactiveWorker` ya existente, agregando un nuevo tipo de request `matchFragments`), en vez de correr en el hilo principal dentro de `recomputeManzanosImmediate`.
4. Evaluar mover **toda** la unión de red vial (`unionRings`/`computeRoadNetworkNet`) a worker, ya que hoy corre 100% en el hilo principal pese a ser la operación más pesada del pipeline de calles.
5. Agregar un **presupuesto de complejidad** explícito (no solo `MAX_UNION_POINTS`): cortar temprano y devolver una aproximación (p. ej. bounding boxes simples) si el número de intersecciones detectadas durante la unión supera un umbral, en vez de dejar que el algoritmo intente resolver el caso patológico completo.

**Criterio de aceptación:** con un proyecto de prueba de 1200+ features y una red vial compleja (≥30 calles con múltiples cruces), el `postrenderLastMs` máximo medido en 5 minutos de uso normal no supera 100 ms; ningún cómputo de unión/intersección de polígonos aparece en el _call stack_ del callback de `postrender`.

---

### Fase 4 — Optimizar el pintado de etiquetas/cotas (`LabelPainter`, `StreetPainter`)

**Objetivo:** bajar el promedio de `postrenderAvgMs` de ~1127 ms a un rango compatible con 60 fps (<16 ms) o al menos <33 ms (30 fps) en proyectos densos.
**Prioridad:** 🟠 Alta.
**Esfuerzo estimado:** 3–4 días.

Tareas:

1. **Eliminar el O(n²) de `isColliding`**: reemplazar el arreglo lineal de `placedBoxes` por un índice espacial ligero (grilla uniforme por celdas de píxeles, o reusar `rbush` que ya es dependencia del proyecto) para consultas de colisión en O(log n) o O(1) amortizado.
2. **Level of Detail (LOD) para cotas de segmento**: no dibujar una cota por _cada_ segmento generado por el fillet de esquinas — agrupar/soltar segmentos redundantes generados solo por la discretización del arco (`cornerFilletArc`) y dibujar cota únicamente sobre los "lados lógicos" originales del polígono, no sobre cada micro-segmento del arco.
3. **Presupuesto de labels por frame**: si el número de features visibles supera un umbral (p. ej. 300–500), reducir progresivamente detalle (ocultar cotas de segmento primero, dejar solo badges de área; luego ocultar badges y dejar solo relleno/contorno) — similar al patrón ya usado para `interacting` (`if (interacting) return`), pero basado en densidad en vez de solo en estado de interacción.
4. **Cachear resultados de pintura estables entre frames**: si `dirty === false` y el viewport no cambió, evitar recorrer todas las features de nuevo — cachear un _snapshot_ de posiciones/etiquetas por resolución (similar al patrón ya usado en `geo/math/lod.ts::getSimplifiedGeometryCached`, extendido a labels).
5. Confirmar que `getVisibleFeatures` en `PostrenderPainter` siempre usa el índice espacial (`SpatialIndex`) — actualmente hace _fallback_ a "todas las features" si `index.size === 0`; verificar que el índice se puebla de forma confiable antes del primer render con datasets grandes (p. ej. tras una importación masiva) para que este fallback no se dispare de forma silenciosa en producción.

**Criterio de aceptación:** `postrenderAvgMs` <33 ms sostenido durante pan/zoom con 1200+ features a zoom con cotas visibles; `isColliding` deja de aparecer como hotspot en un profile de CPU.

---

### Fase 5 — Saneamiento de geometría / guardarraíles duros

**Objetivo:** que ninguna geometría degenerada (proveniente de un bug, una importación sucia o una edición manual) pueda alimentar a `polygon-clipping` sin control.
**Prioridad:** 🟠 Media-alta.
**Esfuerzo estimado:** 2–3 días.

Tareas:

1. Crear una función central `sanitizeRing(ring)` (deduplicar puntos casi-coincidentes, eliminar colinearidades espurias, garantizar cierre y orientación) y aplicarla **antes** de pasar cualquier anillo a `polygonClipping.union/intersection` en `roadNetworkNet.ts`, `fragmentReconciliation.ts` y `geoOperations.ts` (worker).
2. Envolver **todas** las llamadas a `polygon-clipping` (no solo la de `unionRings`) en `try/catch` con _fallback_ explícito (ya existe parcialmente en `roadNetworkNet.ts` y `geoOperations.ts::robustUnionRoadNetwork`; falta en `fragmentReconciliation.ts::ringIntersectionArea` — ahí ya hay `try/catch` que retorna `0`, mantenerlo pero loguear la excepción para diagnóstico).
3. Añadir validación de "anillo mínimo válido" (≥3 puntos únicos, área > epsilon) de forma consistente en los puntos de entrada de geometría externa: import DXF/SHP/GPKG/KML, resultado de `computeManzanosInWorker`, resultado de `subdivideManzano*`.
4. Instrumentar (telemetría/log estructurado, no solo `console.warn`) cuándo `sanitizeRing` tuvo que corregir algo, para poder identificar en producción qué operación del usuario genera la geometría problemática que dispara el peor caso.

**Criterio de aceptación:** con un set de geometrías adversariales de prueba (anillos con puntos duplicados, casi-colineales, auto-intersectantes) el pipeline completo (unión de calles + reconciliación de fragmentos) no supera 500 ms por operación y no lanza excepciones no controladas.

---

### Fase 6 — Observabilidad y regresión de performance

**Objetivo:** que el próximo cuelgue se detecte y diagnostique en minutos, no reconstruyendo el mecanismo a mano desde un screenshot del debug panel.
**Prioridad:** 🟡 Media.
**Esfuerzo estimado:** 2–3 días.

Tareas:

1. Extender `debugCounters.ts` para registrar **de dónde viene** cada pico de `postrenderLastMs`: envolver cada sub-etapa (`updateCaches`, `labelPainter.paint`, `streetPainter.paint`, etc.) con su propio `performance.mark`/`performance.measure`, y exponer en el panel de debug el desglose por etapa del último frame lento, no solo el total.
2. Agregar un contador específico para llamadas a `polygon-clipping` (unión/intersección) por minuto y su duración acumulada — hoy no hay ninguna métrica sobre el costo real de la geometría computacional, que es la sospecha principal del pico.
3. Agregar un umbral configurable (p. ej. `>500 ms`) que, al superarse, capture automáticamente un snapshot mínimo de contexto (cantidad de features, cantidad de calles, hash de la operación en curso) para facilitar reportes de bug reproducibles por parte de usuarios reales.
4. Crear un _test harness_ de performance (puede vivir fuera del bundle de producción) que genere proyectos sintéticos de 500/1000/2000/5000 features con distintas densidades de calles y mida `postrenderAvgMs` y tiempo de `recomputeManzanos` como _regression test_ en CI, para detectar regresiones de performance antes de que lleguen a producción.
5. Documentar en el propio repo (README o `/docs/performance.md`) los límites conocidos (`MAX_UNION_POINTS`, presupuestos de LOD, etc.) y el procedimiento para diagnosticar un futuro reporte de "se cuelga".

**Criterio de aceptación:** un futuro reporte de cuelgue viene acompañado de un desglose por etapa (no solo un número total), permitiendo saltar directo a la causa sin repetir este análisis manual.

---

### Fase 7 — Roadmap de mediano plazo (opcional, mayor esfuerzo)

**Objetivo:** escalar la app de forma sostenible más allá de ~2000–5000 features.
**Prioridad:** 🟢 Baja / oportunista.

Ideas a evaluar (no bloqueantes para resolver el incidente actual):

1. **Migrar el overlay de labels/cotas de canvas-2D a una capa WebGL de texto** (o a `ol/layer/WebGLPoints` con símbolos), aprovechando que ya existe infraestructura WebGL en el proyecto (`DrawLayerRenderer.ts`) — el canvas-2D por-frame es intrínsecamente más costoso a esta escala.
2. **Tiling/streaming de features**: para proyectos muy grandes, cargar y renderizar solo lo que está en el viewport + margen, en vez de mantener 100% de las features en un único `VectorSource` siempre activo.
3. **Ampliar el pool de workers** con una librería tipo _Comlink_ (o el patrón de correlación de la Fase 1 generalizado) para poder paralelizar de verdad operaciones geométricas independientes, en vez de serializarlas en 2 workers fijos.
4. **Web Worker con OffscreenCanvas** para el pintado de cotas/labels, si el presupuesto de ingeniería lo permite, sacando por completo ese trabajo del hilo principal.

---

## 5. Plan de validación / pruebas

1. **Test de regresión del crash (Fase 1):** 50 disparos concurrentes de pares `findOverlaps`+`findGaps` intercalados con `subdivideManzanoBatch`; assert de que cada promesa resuelve con el `type` correcto.
2. **Test de carga (Fases 3-4):** proyecto sintético con 1200 features (mezcla de manzanos con esquinas filleteadas, lotes y ≥30 calles con cruces), medir `postrenderAvgMs`/`postrenderLastMs` durante 5 minutos de pan/zoom/edición simulada.
3. **Test de geometría adversarial (Fase 5):** batería de anillos degenerados (duplicados, casi-colineales, auto-intersectantes) alimentados a `unionRings`/`ringIntersectionArea`, verificar tiempo acotado y ausencia de excepciones no controladas.
4. **Test de cancelación (Fase 2):** disparar 10 recomputes en <1 s, verificar que solo el resultado del último chequeo de topología queda aplicado en el store.
5. **Prueba manual guiada:** reproducir el flujo que originó el reporte (importar/editar hasta llegar a ~1200 features, luego editar calles) y confirmar que el panel de debug (extendido en la Fase 6) ya no muestra picos sin explicación ni el `TypeError` original.

---

## 6. Resumen de prioridades (para planificar sprints)

| Orden | Fase   | Motivo del orden                                                                                                                                   |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Fase 1 | Es la causa raíz **confirmada** del crash reportado; sin esto, cualquier otra mejora sigue conviviendo con un bug determinista de datos corruptos. |
| 2     | Fase 2 | Cierra el resto de la superficie de bugs alrededor del mismo pipeline (resultados obsoletos, diálogo bloqueante).                                  |
| 3     | Fase 3 | Ataca directamente el pico de 57 s (geometría pesada dentro del camino de render).                                                                 |
| 4     | Fase 4 | Ataca el promedio crónico de 1127 ms (la app debe ser usable, no solo "no explotar").                                                              |
| 5     | Fase 5 | Refuerza 3 y 4 contra el peor caso, previene regresiones futuras del mismo síntoma.                                                                |
| 6     | Fase 6 | Evita que el próximo incidente cueste otra sesión de diagnóstico manual completo como esta.                                                        |
| 7     | Fase 7 | Mejora estructural a futuro, no urgente para resolver el incidente actual.                                                                         |

---

## 7. Checklist de "quick wins" (si se necesita alivio inmediato antes de completar las fases)

- [ ] Aplicar el fix de correlación de mensajes de la Fase 1 (más alto impacto por menor esfuerzo de todo el plan).
- [ ] Envolver `gaps.features.length` (y equivalentes) con un chequeo defensivo (`gaps?.features?.length ?? 0`) como parche temporal mientras se despliega el fix real.
- [ ] Bajar el umbral de zoom en el que aparecen las cotas de segmento (`COTA_APPEAR_ZOOM`) o desactivar cotas por defecto en proyectos con >500 features, como mitigación manual del O(n²) mientras se implementa la Fase 4.
- [ ] Agregar un `console.time`/`console.timeEnd` alrededor de `computeRoadNetworkNet` y `matchFragmentsToMembers` para confirmar en el entorno real del usuario cuál de los dos es el que produce el pico de 57 s antes de invertir en la Fase 3 completa.
