# Diagnóstico avanzado del motor gráfico de GeoUrban (WebGL + Canvas2D) y plan de escalado a nivel QGIS/AutoCAD

**Alcance:** auditoría de `src/map/**`, `src/store/entities/layersRegistryStore.ts`, `src/store/entities/manzanoStore.ts`, `src-tauri/tauri.conf.json`.
**Contexto de ejecución:** Tauri 2 + WebView2 (Windows) como target desktop principal.
**Síntoma reportado:** el motor se "relentiza" a medida que crece el proyecto, sospecha sobre WebView2 y sobre la cantidad de capas.

---

## 0. Veredicto corto

**Sí, las capas son el multiplicador principal del problema — pero no por "tener muchos polígonos", sino por una decisión de arquitectura:** cada capa del registro (`useLayersStore`) tiene su **propio `WebGLVectorLayer`** (`LayeredWebglRenderer` en `src/map/scene/DrawLayerRenderer.ts`), es decir, **un contexto/pipeline WebGL independiente por capa**, no un único motor con N estilos. Sobre eso hay una segunda capa de problemas: **repintados Canvas2D completos por frame** (`PostrenderPainter` + sus 6 painters) que no respetan el flag `interacting` de forma consistente, y una tercera capa de **renders forzados por reactividad de stores mal segmentada** (subscribes sin selector que disparan `render()` en cada tecla escrita en un input). WebView2 no es la causa raíz, pero **amplifica** cada uno de estos problemas porque su modelo de composición multi-superficie y su backend ANGLE (D3D11) son estructuralmente más caros que Chrome nativo para este patrón de "muchas superficies GPU pequeñas + muchos draw calls Canvas2D por frame".

---

## 1. Arquitectura actual del pipeline de render

```
Map (OpenLayers)
├─ BaseLayer (CAD grid | OSM | Google Sat | Google Roadmap)     [ImageCanvasSource, redraw completo por extent]
├─ N × WebGLVectorLayer  (uno por capa del registro + 1 fallback) [LayeredWebglRenderer]
├─ streetLayer (VectorLayer Canvas2D, boceto de calles en trazado)
├─ postrenderLayer (VectorLayer Canvas2D "vacía", hook de dibujo custom) [PostrenderPainter]
├─ highlightLayer (VectorLayer Canvas2D, selección/erase)         [InteractionModeController]
├─ snapIndicatorLayer (VectorLayer Canvas2D, glifo de snap activo) [Map.tsx]
└─ rotateLots tempLayer (VectorLayer Canvas2D, gizmo de rotación)  [RotateLotsInteraction]
```

Con los 10 `kind` base de `LAYER_SUGGESTIONS` (`lote`, `manzana`, `calle`, `equipamiento`, `area_verde`, `urbanizacion`, `georreferenciado`, `rotonda`, `vert_geo`, `perimetro`) más la capa `unassigned` de fallback, **un proyecto recién iniciado ya arranca con 8-11 `WebGLVectorLayer` activos**, y crece con cada capa que el usuario crea o duplica (`AddLayerModal`, `DuplicateLayerCommand`). Cada uno de esos `WebGLVectorLayer`:

- Administra su propio render target/contexto WebGL (`ol/layer/WebGLVector.js` es 1 instancia = 1 pipeline de shaders + buffers propio, no comparte programa con las demás).
- Se recompone sobre el canvas final del mapa en cada frame (composición extra por capa).
- Tiene su propio `style` (expresión JSON que OL compila a shader) que se reconstruye completo con `buildSingleLayerStyle()` — incluyendo, para capas `colorMode: 'colorIdx'`, un `match` de 10 ramas de color (`MZN_COLORS`).

Esto **no es "usar WebGL", es "usar N motores WebGL en paralelo"**. Es el equivalente a que QGIS abriera un contexto OpenGL nuevo por cada capa del panel de capas en vez de un único canvas compuesto por symbology — ningún motor CAD/GIS serio funciona así a partir de más de un puñado de capas.

---

## 2. Causas raíz, ordenadas por impacto real

### 2.1. `setStyle()` en cascada sobre TODAS las capas por cualquier cambio de propiedad (🔴 crítico)

`LayeredWebglRenderer.syncLayerSet()` (en `DrawLayerRenderer.ts`) se suscribe así:

```ts
this.unsubscribeStore = useLayersStore.subscribe((state, prevState) => {
  if (state.layers !== prevState.layers) this.syncLayerSet(state.layers);
});
```

Es una suscripción **sin selector** a todo `useLayersStore`. Ese store no solo contiene `layers`: también contiene `activeLayerId`, `isolatedLayerId`, `isolatePrevVisibility`. Cualquier cambio en **cualquiera** de esos campos —activar una capa, aislar una capa, etc.— dispara `syncLayerSet(layers)`, y ese método, para **cada** capa existente, hace:

```ts
entry.layer.setStyle(buildSingleLayerStyle(layer));
entry.layer.setZIndex(layer.zIndex);
entry.layer.setVisible(layer.visible);
```

`setStyle()` sobre un `WebGLVectorLayer` no es un `set` barato: OL debe re-parsear la expresión de estilo (incluyendo el `match` de 10 ramas para capas `colorIdx`, con `withAlpha()` haciendo parseo de regex + hex por cada rama) y reconstruir el pipeline de shaders internos. Multiplicá eso por el número de capas.

**El peor caso concreto:** `LayerPanel.tsx` → `OpacitySlider` dispara `UpdateLayerCommand` en cada evento `onChange` del `<input type="range">`, que en la mayoría de navegadores se dispara **muchas veces por segundo mientras se arrastra**. Cada uno de esos eventos:

1. Actualiza `useLayersStore` (una sola capa cambió).
2. Dispara el subscribe global → `syncLayerSet` recorre **todas** las capas.
3. Cada capa reconstruye su `style` completo (aunque su color/opacidad no cambió).

Esto significa que **mover un slider de opacidad de una capa recompila el estilo de shader de todas las demás capas, muchas veces por segundo.** Esto explica directamente la sensación de "se relentiza al tener más capas": el costo de cualquier edición de UI escala con el total de capas del proyecto, no con la capa tocada.

### 2.2. Reactividad de Zustand sin selector fuera del store de capas (🔴 crítico)

El mismo patrón se repite en `RotateLotsInteraction.install()`:

```ts
this.unsubscribe = useManzanoStore.subscribe((state) => {
  this.syncGizmo(state.rotateAnchor, state.rotateHandle);
});
```

`useManzanoStore` también contiene `targetAreaM2` y `frontMinM`, que están atados directamente a `<input type="number">` en `LotParamsCard.tsx` (`onChange={(e) => setTargetAreaM2(...)}`). **Cada tecla** escrita en el campo "Área objetivo (m²)" o "Frente mínimo (m)" dispara este subscribe global, que llama `source.clear()` + reconstruye 3 features del gizmo + `this.hostMap.render()` — es decir, **fuerza un frame completo del mapa** (todas las capas WebGL + los 6 painters Canvas2D) aunque el usuario solo esté tipeando un número en un panel, sin ninguna rotación en curso.

Mismo patrón (más leve) en `Map.tsx`:

```ts
useStreetStore.subscribe(() => {
  mapInstanceRef.current?.render();
});
useRoundaboutStore.subscribe(() => {
  mapInstanceRef.current?.render();
});
```

Estos stores mezclan estado que sí afecta el render (streets, roundabouts) con estado que no (`panelVisible`, `defaultWidthM` antes de trazar) — cualquier cambio dispara `render()`.

### 2.3. Painters Canvas2D que redibujan todo, todos los frames, sin gate de interacción completo (🟠 alto)

`PostrenderPainter.handle()` corre en el evento `postrender`, que se dispara **en cada frame renderizado del mapa** (pan, zoom, cualquier `map.render()` forzado como los del punto 2.2). Dentro:

```ts
this.labelPainter.paint(ctx, visibleFeatures, zoom, resolution, toPx, this.interacting); // ok, se apaga en interacting
this.streetPainter.paint(ctx, zoom, resolution, toPx, this.interacting); // solo apaga LABELS, no el relleno/stroke de calles
this.roundaboutPainter.paint(ctx, toPx, resolution); // sin gate
this.vertexPainter.paint(ctx, visibleFeatures, toPx); // sin gate — dibuja TODOS los vértices visibles en cada frame
this.snapGuidePainter.paint(ctx, resolution);
this.overlayPainter.paint(ctx, toPx);
```

`VertexPainter.paint()` no chequea `interacting` en absoluto: itera todas las features visibles de tipo `lote`/`manzana`/`perimetro`, y por cada vértice hace `ctx.save()/arc()/fill()/stroke()/restore()` — más `fillText` duplicado (halo + texto) si las etiquetas de vértice están activas. En un manzano con 200-500 lotes esto es miles de operaciones de canvas **por frame**, incluyendo durante el arrastre de pan.

`StreetPainter.paint()` reconstruye y rellena/traza los polígonos de calzada + vereda desde cero en cada frame (`paintRings`, con `toPx()` reproyectando cada vértice de cada anillo), sin cachear el path en píxeles entre frames cuando la resolución/extent no cambiaron.

`CadGridLayer` (`createCadBaseMap` → `ImageCanvasSource.canvasFunction`) recalcula la grilla completa (líneas menores + mayores + ejes) en cada llamada, que ocurre en cada cambio de extent/resolución — es decir, en cada frame de un pan continuo. Esto es especialmente relevante porque **`cad` es el `baseMap` por defecto** (`useUiShellStore`), así que todo usuario nuevo arranca con este costo activo.

### 2.4. Reactividad de UI atada a `change` de la fuente de datos, no a lo que realmente cambió (🟡 medio)

`useDrawSourceTick` escucha `addfeature`/`removefeature`/`change` sobre el `drawSource` completo. `LayerPanel`, `ManzanoPanel` y `StatsPanel` usan ese tick para recalcular, vía `useMemo`, funciones que **recorren todas las features del proyecto** (`computeLayerFeatureCounts`, `computeLayerExtent`, `readManzanoRows`, `computeStats`). El evento `change` de OpenLayers se dispara en **cada modificación de geometría**, incluyendo cada micro-movimiento durante un arrastre con la interacción `Modify`/`SafeTranslate` (`EditMode.ts`). Con el panel de Capas o el de Manzanos abierto durante una edición de vértices, esto añade trabajo de React + recorridos O(n) del dataset completo en el hilo principal, en paralelo al costo de render de la sección 2.3.

### 2.5. Infraestructura de LOD ya construida pero no conectada al pipeline (🟡 medio, oportunidad barata)

`src/geo/math/lod.ts` define `getSimplifiedGeometryCached()` y `clearSimplifyCache()` — un sistema de simplificación de geometría cacheado por _bucket_ de resolución, exactamente el tipo de mecanismo que usan QGIS/Mapbox GL para no renderizar detalle innecesario a zoom bajo. **No hay ningún call site** de `getSimplifiedGeometryCached` en el código relevado fuera de su propia definición (solo `resolutionAwareSegments` se usa, para generar geometría de rotondas). Es decir: ya existe medio motor de LOD escrito y sin cablear al `LayeredWebglRenderer` ni a los painters.

### 2.6. Índice espacial bien resuelto, pero subutilizado por los painters de detalle (🟢 correcto, con margen)

`SpatialIndex` (RBush) está bien implementado y se usa para culling en `PostrenderPainter.getVisibleFeatures()` — esto es correcto y es lo que evita que labels/vértices se calculen para todo el dataset. El problema no es la falta de culling espacial (eso está bien hecho), sino que, **una vez culleado a "visibles"**, el costo por feature visible (vértices, cotas, calles) sigue siendo demasiado alto para pagarse en cada frame sin cache de path/pixel.

---

## 3. ¿Por qué esto pega más fuerte en WebView2 que en Chrome de escritorio?

No es que WebView2 sea "lento" en abstracto — es Chromium. Pero hay diferencias reales relevantes para este patrón específico:

1. **Más contextos GPU = más overhead de traducción ANGLE.** WebView2 en Windows usa ANGLE sobre Direct3D11 (o WARP/software si el driver o el entorno —RDP, VM, GPU bloqueada por política corporativa— no calza). Cada contexto WebGL adicional (uno por capa, sección 2.1) paga el costo de traducción D3D11 por separado; en Chrome de escritorio con la misma GPU el overhead relativo es menor porque el resto del proceso de composición está más optimizado para multi-superficie. Con `SwiftShader`/`WARP` como fallback (frecuente en VMs corporativas y sesiones RDP, comunes en entornos de oficina de estudios de ingeniería/urbanismo), N contextos WebGL se vuelven N pipelines de software — ahí el "se relentiza mucho" se vuelve literal.
2. **Composición multi-superficie más cara.** Cada `WebGLVectorLayer` + cada `VectorLayer` Canvas2D adicional (street, postrender, highlight, snap, gizmo) es una superficie que el compositor debe mezclar por frame. WebView2 usa su propio árbol de composición (DirectComposition) integrado con el host nativo (la ventana Win32/Tauri), que históricamente tiene más fricción con muchas superficies transparentes semi-solapadas que el compositor de Chrome standalone.
3. **`ctx.font` reasignado por draw call sin agrupar.** `LabelPainter`, `StreetPainter` y `VertexPainter` cambian `ctx.font` string por string en cada etiqueta (aunque casi siempre es el mismo valor calculado). El re-shaping de texto en el backend de Skia que usa WebView2 es sensible a estos cambios de estado repetidos; agrupar draws por fuente/estilo idéntico reduce esto de forma significativa.
4. **`tauri.conf.json` no pasa ningún argumento de inicialización al motor.** El bloque `app.windows[0]` no define `additionalBrowserArgs`. Por defecto, WebView2 no fuerza rasterización GPU agresiva ni descarta el fallback a software silenciosamente — queda a criterio del entorno del usuario final, sin que la app pueda detectarlo ni compensarlo hoy.

**Conclusión de esta sección:** WebView2 es un multiplicador de un problema que ya existe en el código (secciones 2.1–2.3), no el origen del problema. Arreglar solo "cosas de WebView2" sin tocar la arquitectura de capas dejará el síntoma prácticamente intacto.

---

## 4. Plan de mejora por fases

Diseñado para poder pausar entre fases sin dejar el motor en un estado roto. Cada fase indica objetivo, acciones concretas, esfuerzo, riesgo e impacto esperado.

### Fase 0 — Instrumentación y baseline (obligatoria antes de tocar nada)

**Objetivo:** dejar de diagnosticar a ojo. Sin esto, cualquier "mejora" de las fases siguientes es indemostrable.

- Agregar un panel de debug (toggle, oculto por defecto) que muestre: FPS instantáneo/promedio (via `requestAnimationFrame` delta), cantidad de `WebGLVectorLayer` activos, cantidad de features en `drawSource`, tiempo de `PostrenderPainter.handle()` por frame (envolver con `performance.now()` al entrar/salir), y conteo de invocaciones de `setStyle()` por minuto.
- Instrumentar `syncLayerSet` y `syncGizmo` con contadores temporales (`console.count` o acumulador expuesto en el panel de debug) para confirmar en runtime la frecuencia real de los dos problemas de la sección 2.1/2.2 con datos del propio proyecto del usuario.
- Definir 2-3 escenarios de prueba reproducibles y fijos: (a) proyecto con 5 manzanos / ~150 lotes / 8 calles, pan+zoom continuo 10s; (b) arrastrar el slider de opacidad de una capa con 15 capas totales en el proyecto; (c) editar el campo "Área objetivo" con el panel de Manzanos abierto y 300 lotes en el mapa.
- Medir estos 3 escenarios en: Chrome de escritorio, build Tauri/WebView2 en la máquina de desarrollo, y build Tauri/WebView2 en una VM o RDP si es posible (para exponer el caso `WARP`/software).

**Esfuerzo:** 0.5–1 día. **Riesgo:** ninguno (solo lectura/instrumentación). **Impacto:** ninguno directo, pero condiciona la validación de todo lo demás.

---

### Fase 1 — Quick wins de bajo riesgo (cortar la hemorragia sin refactor estructural)

**Objetivo:** eliminar los disparadores de trabajo redundante identificados en 2.1, 2.2 y 2.3 sin cambiar la arquitectura de capas todavía. Esta fase sola debería producir una mejora perceptible inmediata.

1. **Selectors en vez de subscribe global.**
   - `LayeredWebglRenderer.attach()`: cambiar `useLayersStore.subscribe((state) => syncLayerSet(state.layers))` por una suscripción con comparador que solo dispare cuando `state.layers` cambió por referencia (Zustand permite pasar un selector + `equalityFn`, o comparar manualmente el array antes de re-ejecutar).
   - `RotateLotsInteraction.install()`: reemplazar el `subscribe` de todo `useManzanoStore` por un `subscribe` selectivo solo a `rotateAnchor`/`rotateHandle` (zustand `subscribeWithSelector` middleware, o comparar manualmente esos dos campos antes de llamar `syncGizmo`).
   - `Map.tsx`: acotar los subscribes de `useStreetStore`/`useRoundaboutStore` para no disparar `render()` en cambios que no afectan geometría visible (ej. `panelVisible`, `defaultSides`).

2. **`setStyle` diferencial, no en cascada.**
   - En `syncLayerSet`, calcular un hash/firma liviana por capa (color, fillColor, opacity, colorMode, kind) y solo llamar `entry.layer.setStyle(...)` para las capas cuya firma cambió respecto del último sync, no para todas.
   - Debounce del `onChange` del `OpacitySlider`/color pickers en `LayerPanel.tsx` (ej. 80-120ms) antes de emitir el `UpdateLayerCommand`, para no generar un comando (y su `setStyle`) por cada pixel arrastrado. Usar `onInput` solo para feedback visual local del propio control, no para escribir al store en cada evento.

3. **Gate de interacción completo en los painters pesados.**
   - `VertexPainter.paint()`: recibir y respetar `interacting` (igual que ya hace `LabelPainter`), o degradar a un modo "solo bounding hint" durante el drag.
   - `StreetPainter.paint()`: separar el relleno/stroke de calzada (costoso) de las etiquetas (ya gateadas); si `interacting`, dibujar una versión simplificada (solo el eje punteado que ya existe) en vez de recomputar y volver a rellenar los anillos completos.
   - Cachear en el propio painter los puntos en píxeles de calles/rotondas cuando `resolution` y `extent` no cambiaron entre frames (comparar contra el frame anterior antes de recalcular `toPx` para cada vértice).

4. **CAD grid: limitar frecuencia de recomputo.**
   - En `cadGridLayer.ts`, cachear el canvas dibujado por combinación `(resolutionBucket, origin redondeado)` similar al patrón de `resolutionBucket` de `lod.ts`, y solo invalidar cuando cambia el bucket, no en cada micro-movimiento de pan.

5. **`useDrawSourceTick` más selectivo.**
   - Separar el evento `change` (geometría) de un evento propio para "conteos/UI" que se dispare con throttle (ej. cada 150-200ms) en vez de en cada micro-cambio de `Modify`. `LayerPanel`, `ManzanoPanel`, `StatsPanel` no necesitan recalcular en tiempo real mientras se arrastra un vértice.

**Riesgo:** bajo-medio (tocar reactividad de stores compartidos requiere testear undo/redo y sincronización de paneles). **Impacto esperado:** alto — esta fase ataca directamente los tres disparadores más frecuentes de trabajo innecesario.

---

### Fase 2 — Motor de estilos WebGL unificado (el cambio estructural real)

**Objetivo:** pasar de "N `WebGLVectorLayer`, uno por capa" a un número fijo y pequeño de `WebGLVectorLayer` (idealmente 1 para polígonos + 1 para líneas/puntos, o como máximo uno por _z-order group_ si hace falta intercalar con capas de referencia), donde el color/relleno/visibilidad se resuelve **por feature vía expresión de estilo data-driven**, no por instancia de capa.

- Cada feature ya tiene `layerId` como propiedad (`f.get('layerId')`). En vez de enrutar la feature a una `VectorSource` distinta por capa (lo que hace `place()` hoy), mantener **una sola `VectorSource` maestra** (ya existe: `master` en `LayeredWebglRenderer`) y construir un **único `style` con expresión `match` sobre `layerId`** que resuelva color/fill/opacidad/visibilidad, análogo a como ya se arma `buildWebglStyle()` (que de hecho **ya existe en el archivo pero no se usa como reemplazo de los mirrors** — es la base lista para esta fase).
- El orden de dibujo (`zIndex` por capa) que hoy se resuelve con una `WebGLVectorLayer` por capa (cada una con su propio `zIndex`) deberá resolverse de otra forma: opción A) ordenar las features dentro de la única fuente por `zIndex` de su capa antes de insertarlas (reinsertar en orden cuando cambia `reorder`); opción B) mantener un número acotado de "buckets" de capas (ej. agrupar por rango de zIndex en 3-4 `WebGLVectorLayer` en vez de 1 por capa) como paso intermedio de menor riesgo si el reordenamiento por feature resulta complejo con la API de OL.
- La visibilidad por capa (`layer.visible`) deja de ser `layer.setVisible()` de una `WebGLVectorLayer` entera y pasa a ser parte de la expresión de estilo (`case ['in', ['get','layerId'], ['literal', hiddenIds]], 'transparent', ...]`), reutilizando la lógica que ya existe en `buildLayerFilter()`.
- Mantener el mirror `fallback` (capa "Sin capa") como caso especial dentro de la misma expresión, no como layer aparte.

**Resultado esperado:** de "8-30 contextos WebGL" a "1-2 contextos WebGL" para todo el proyecto, independientemente de cuántas capas cree el usuario. El costo de `setStyle()` deja de escalar con el número de capas porque solo hay una (o dos) instancias de layer para recompilar, y el diffing de Fase 1 ya evita recompilarla salvo cuando algo realmente relevante cambió.

**Esfuerzo:** (es el cambio de mayor superficie: toca placement, estilos, z-order, e interacción con `hitTest`/`spatialIndex` que hoy asumen una sola `VectorSource` de todos modos, así que el hit-testing no debería verse afectado). **Riesgo:** medio-alto — requiere test exhaustivo de reorder de capas, aislar/duplicar capas, y el modo `colorMode: 'colorIdx'` de manzanos (que ya usa `match` sobre `colorIdx`, ahora deberá combinarse con el `match` de `layerId`). Recomendado hacerlo detrás de un feature flag y correr en paralelo con el renderer actual en un entorno de staging antes de reemplazarlo.

---

### Fase 3 — Painters Canvas2D: de "redibujar todo" a "repintar lo que cambió"

**Objetivo:** que el costo de los painters de detalle (vértices, cotas, calles) deje de ser proporcional a "features visibles × frames por segundo" y pase a ser proporcional a "features visibles que efectivamente cambiaron desde el último frame pintado".

- Introducir un cache de "capa de detalle" en un `<canvas>` offscreen (`OffscreenCanvas` si está disponible, o un canvas 2D auxiliar) por painter (vértices, cotas), que solo se re-renderiza cuando: cambia el extent/resolución más allá de un umbral, o cambian las features involucradas (usar el mismo mecanismo de hash/dirty-tracking de Fase 1). Durante pan puro sin cambio de resolución, trasladar (`ctx.drawImage` con offset) el buffer cacheado en vez de recalcular cada punto.
- Conectar finalmente `getSimplifiedGeometryCached()` (Fase de la sección 2.5) al pipeline de `VertexPainter`/`LabelPainter`: a resoluciones bajas (zoom alejado), no iterar vértice por vértice de polígonos con cientos de puntos si la simplificación ya los reduce a una fracción — hoy ese trabajo está escrito y sin conectar.
- Mover el cálculo de colisión de etiquetas (`isColliding` en `LabelPainter`, actualmente O(n²) contra un array `placedBoxes` recorrido linealmente por cada candidata) a una estructura espacial ligera (grid hash o reutilizar RBush) para que no degrade cuadráticamente con la cantidad de etiquetas visibles simultáneas.
- Evaluar mover el cómputo de layout de etiquetas (no el dibujo, solo el cálculo de posiciones/colisiones) a un Web Worker, ya que el proyecto **ya tiene infraestructura de workers** (`geoWorkerClient.ts`, `geoWorker.ts`) para cálculos geométricos pesados — es consistente con el patrón ya establecido en el código, no una tecnología nueva para el equipo.

**Riesgo:** medio (dirty-tracking mal calibrado puede generar artefactos visuales — necesita QA visual explícito, no solo de performance). **Impacto esperado:** alto en proyectos con muchos lotes/cotas visibles, que es exactamente el caso de uso principal de la herramienta (parcelamiento urbano denso).

---

### Fase 4 — Afinado específico de WebView2/Tauri

**Objetivo:** asegurar que, una vez resuelta la arquitectura (Fases 1-3), WebView2 no vuelva a introducir un piso de rendimiento por configuración por defecto.

- Agregar `additionalBrowserArgs` en `src-tauri/tauri.conf.json` (bajo la config de la ventana, target Windows) probando: `--enable-gpu-rasterization --enable-zero-copy --enable-features=CanvasOopRasterization,VaapiVideoDecoder --disable-features=CalculateNativeWinOcclusion`. Validar cada flag individualmente contra el baseline de Fase 0 — no todos aportan en todas las GPUs, y alguno puede ser contraproducente en hardware viejo.
- Agregar una verificación en runtime (solo en build Tauri) que detecte si el contexto WebGL cayó a software (`gl.getParameter(gl.RENDERER)` conteniendo `"SwiftShader"`/`"WARP"`/`"Software"`) y, si es así, mostrar un aviso al usuario sugiriendo revisar drivers de GPU o política de la organización — hoy el usuario no tiene forma de saber que está en ese escenario, solo percibe "lentitud".
- Reducir activamente el número de `<canvas>`/superficies compuestas simultáneas: con la Fase 2 ya aplicada, revisar si `highlightLayer`, `snapIndicatorLayer` y el `tempLayer` del gizmo de rotación pueden compartir una sola `VectorLayer` de "overlays de interacción" en vez de 3 instancias separadas, ya que ninguna de las tres necesita WebGL (son unos pocos features a la vez).
- Documentar un procedimiento de verificación manual: abrir DevTools embebidas del WebView (clic derecho → Inspeccionar en build de desarrollo) y confirmar en la pestaña de rendimiento que no hay recompilación de shaders en cascada durante interacciones simples (validación cualitativa de que Fase 1/2 funcionaron en el entorno real, no solo en Chrome).

**Riesgo:** bajo (son flags reversibles y detección informativa). **Impacto esperado:** medio por sí solo, alto como multiplicador de las fases anteriores en el entorno de producción real (RDP/VM/hardware corporativo).

---

### Fase 5 — Nivel "motor CAD/GIS": LOD real, culling por tiles y presupuesto de frame

**Objetivo:** llevar el comportamiento a algo comparable a QGIS/AutoCAD en proyectos grandes (miles de lotes), no solo "aceptable" en proyectos medianos.

- **LOD jerárquico real:** generalizar el `resolutionBucket` de `lod.ts` para aplicarse también a polígonos de lotes/manzanos (no solo a círculos de rotondas), generando 2-3 niveles de simplificación de geometría (Douglas-Peucker o similar, ya disponible vía `geometry.simplify()` de OL) cacheados por bucket de zoom, reutilizando la caché ya escrita.
- **Culling por tiles/grilla, no solo por extent del viewport:** hoy `getVisibleFeatures` filtra contra el extent actual expandido un 15%. Para datasets grandes conviene indexar en tiles fijos (similar a un esquema de vector tiles simplificado in-memory) para que el costo de "qué está visible" no dependa de recorrer toda la RBush en cada frame cuando el extent cambia de forma continua durante un zoom animado.
- **Presupuesto de frame (frame budget) explícito:** en vez de que cada painter haga "todo lo que tenga que hacer" en el callback de `postrender`, introducir un scheduler simple que reparta trabajo no crítico (etiquetas, cotas) en `requestIdleCallback`/fragmentado entre frames cuando el dataset visible supera un umbral, priorizando siempre completar el frame de geometría (WebGL) a 60fps y degradando primero el detalle secundario (así se comporta QGIS al hacer pan rápido: prioriza geometría, degrada etiquetas).
- **Buffers persistentes / dirty regions para el grid CAD:** en vez de recomputar la grilla por bucket (Fase 1), pre-renderizar un patrón tileable una sola vez y usar `ctx.createPattern`/repetición, evitando recalcular líneas matemáticamente en cada redraw.

**Riesgo:** medio — cada mecanismo (LOD, tiles, scheduler) es aditivo y puede introducirse detrás de flags sin romper lo anterior. **Impacto esperado:** el que determina si la herramienta escala a proyectos de "ciudad completa" vs. "barrio".

---

### Fase 6 — Telemetría continua y presupuesto de performance como gate de CI

**Objetivo:** que estos problemas no vuelvan a acumularse silenciosamente (el estado actual —painters sin gate, subscribes sin selector, LOD sin cablear— es exactamente lo que pasa cuando no hay un guardrail).

- Dejar el panel de debug de Fase 0 accesible permanentemente (oculto tras un atajo de teclado) en builds de desarrollo/QA, no solo como herramienta de una sola vez.
- Definir un "presupuesto" simple (ej. "el escenario B de Fase 0 no debe generar más de X llamadas a `setStyle` por interacción de 5 segundos") y agregar un test de regresión (aunque sea manual/checklist en el PR template) para cambios que toquen `DrawLayerRenderer.ts`, `PostrenderPainter.ts` o cualquier store con subscribers globales.
- Revisar periódicamente (cada feature grande) si se agregaron nuevos `subscribe()` sin selector sobre stores compartidos — es el patrón que causó 2 de los 3 problemas críticos de este diagnóstico, y es fácil de reintroducir sin querer.

**Riesgo:** ninguno. **Impacto:** preventivo, no correctivo — protege la inversión de las fases 1-5.

---

## 5. Resumen de priorización

| Fase                                       | Ataca                   | Riesgo     | Impacto                                |
| ------------------------------------------ | ----------------------- | ---------- | -------------------------------------- |
| 0. Instrumentación                         | Visibilidad             | Ninguno    | Habilita todo lo demás                 |
| 1. Quick wins (selectors, debounce, gates) | 2.1, 2.2, 2.3, 2.4      | Bajo-medio | **Alto e inmediato**                   |
| 2. Motor de estilos WebGL unificado        | 2.1 (raíz estructural)  | Medio-alto | Alto, resuelve el escalado con N capas |
| 3. Painters con dirty-tracking             | 2.3, 2.5                | Medio      | Alto en proyectos densos               |
| 4. Afinado WebView2/Tauri                  | Sección 3               | Bajo       | Medio solo, alto como multiplicador    |
| 5. LOD/tiles/frame budget                  | Escalado a "nivel QGIS" | Medio      | Determina el techo de escala           |
| 6. Telemetría/CI                           | Prevención              | Ninguno    | Preventivo                             |

**Recomendación de secuencia:** 0 → 1 → 4 (rápido y de bajo riesgo, se puede hacer en paralelo con 1) → 2 → 3 → 5 → 6 en paralelo desde la Fase 1 en adelante.

La Fase 1 por sí sola, al atacar los tres disparadores de trabajo redundante más frecuentes (recompilación de estilos en cascada por cualquier cambio de UI, `render()` forzado por inputs de texto sin relación visual, y painters sin gate de interacción), debería ser perceptible para el usuario en cuestión de días de trabajo, sin tocar la arquitectura de capas. La Fase 2 es la que resuelve el problema de fondo ("por qué escala mal con más capas") y es la inversión estructural real hacia un motor comparable a QGIS/AutoCAD.
