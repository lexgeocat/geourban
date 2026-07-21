# Diagnóstico técnico profundo — GeoUrban

## Motor gráfico y motor geométrico (SIG/CAD, Desktop + Web)

**Alcance:** revisión estática de los ~96 archivos fuente provistos (React + Zustand/Immer + OpenLayers 10 + WebGL + JSTS en Web Worker + Tauri 2). No incluye profiling en runtime (ver Fase 0).
**Objetivo:** identificar qué conservar, mejorar, quitar o añadir en el pipeline de renderizado y en el motor geométrico, y proponer un plan de optimización robusto para que el editor no se degrade con proyectos grandes, tanto en Desktop (Tauri) como en Web.

---

## 0. Resumen ejecutivo

La arquitectura de base es correcta en su intención: WebGL para relleno/trazo masivo, un worker con JSTS para operaciones booleanas pesadas, un índice espacial (RBush) para snapping, y un pintor de overlays en Canvas2D para etiquetas/cotas. El problema no es la elección de tecnologías, sino **cómo se fueron acoplando** a medida que el proyecto creció:

1. **Hallazgo más crítico (H1):** el sistema de Undo/Redo real (`useCommandStack.undo/redo`) **no usa** la lógica `Command.undo()`/`Command.redo()` que cada comando implementa cuidadosamente. Usa snapshots completos de `drawSource` (`historyStore`). Como calles, rotondas y métodos de subdivisión **no viven en `drawSource`** sino en stores separados (`streetStore`, `roundaboutStore`, `manzanoStore`), deshacer un trazado de calle o una rotonda **no las elimina realmente**. Esto es un bug de robustez, no solo de performance.
2. **Renderizado duplicado (H2):** cada feature se dibuja dos veces por frame — una en WebGL (visible) y otra en un `VectorLayer` Canvas2D invisible que existe solo para hit-testing, con `declutter: true` activo sin necesidad.
3. **Trabajo pesado en el hilo principal:** la subdivisión de manzanos (hasta 200 iteraciones de bisección por lote) y el recálculo de métricas de **todas** las features en **cada** comando corren de forma síncrona en el hilo de UI, mientras que operaciones booleanas equivalentes (JSTS) sí están correctamente en un Web Worker.
4. **Persistencia desktop rota/duplicada (H15):** el autosave usa IndexedDB (Dexie) siempre, pero el "Gestor de Proyectos" de escritorio lee de una base `sql.js` en memoria que no persiste a disco y que nunca ve lo que el autosave guardó. Además, `@tauri-apps/plugin-sql` está en `package.json` pero no se usa en ningún archivo revisado.
5. **Sin gating de trabajo por frame:** el pintor de overlays (`PostrenderPainter`) recalcula texto, colisiones de etiquetas y fillets en cada frame de render, sin caché ni "modo barato mientras se interactúa".

Ninguno de estos problemas requiere reescribir el motor — son **quirúrgicos**: eliminar duplicación, mover cómputo al worker que ya existe, cerrar el círculo del Command Stack, y desacoplar bien las capas de estado. El plan de fases más abajo está ordenado por relación impacto/riesgo.

---

## 1. Tabla maestra de hallazgos

| ID  | Hallazgo                                                                                      | Dominio      | Veredicto                        | Severidad | Fase          |
| --- | --------------------------------------------------------------------------------------------- | ------------ | -------------------------------- | --------- | ------------- |
| H1  | Undo/Redo no invoca `Command.undo/redo`; calles/rotondas no se deshacen                       | Transversal  | 🔴 Rediseñar                     | Crítica   | F2            |
| H2  | Doble render (WebGL + Canvas hit-layer) sobre el mismo `VectorSource`, con `declutter` inútil | Gráfico      | 🟡 Mejorar                       | Alta      | F1/F3         |
| H3  | Grilla CAD reconstruida como `Feature`/`LineString` de OL en cada pan/zoom                    | Gráfico      | 🟡 Mejorar                       | Media     | F3            |
| H4  | `PostrenderPainter` sin caché de `measureText` ni dirty-check por frame                       | Gráfico      | 🟡 Mejorar                       | Alta      | F3            |
| H5  | `pointermove` sin throttling dispara 2 updates de Zustand por pixel de mouse                  | Gráfico      | 🟡 Mejorar                       | Alta      | F1            |
| H6  | Monkeypatch global `willReadFrequently=true` en todo `getContext('2d')`                       | Gráfico      | 🔴 Acotar/Quitar                 | Media     | F1            |
| H7  | 3 algoritmos distintos de redondeo de esquina (street/roadNetwork/ringFillet)                 | Gráfico/Geo  | 🟡 Mejorar (consolidar)          | Baja      | Deuda técnica |
| H8  | Subdivisión de manzanos (bisección, hasta 200 iters) 100% en hilo principal                   | Geométrico   | 🔴 Mover a Worker                | Crítica   | F4            |
| H9  | `refreshSourceMetrics` recalcula TODO el source en cada comando                               | Geométrico   | 🟡 Mejorar (incremental)         | Alta      | F4            |
| H10 | Cambio de CRS/zona UTM no dispara recálculo de métricas                                       | Geométrico   | 🔴 Bug a corregir                | Alta      | F1            |
| H11 | `findOverlaps`/`findGaps`/`validateTopology` sin broad-phase espacial (O(n²))                 | Geométrico   | 🟡 Mejorar                       | Media     | F4            |
| H12 | `recomputeManzanos()` completo por cada calle/rotonda agregada, sin debounce                  | Geométrico   | 🟡 Mejorar                       | Media     | F4            |
| H13 | Índice espacial (RBush) no se reindexa en `changefeature` (drag en vivo)                      | Geométrico   | 🔴 Bug a corregir                | Alta      | F1            |
| H14 | `historyStore` serializa propiedades derivadas que se recalculan igual al restaurar           | Geométrico   | 🟡 Mejorar / 🔴 obsoleto tras F2 | Media     | F2            |
| H15 | Dos backends de persistencia desktop desincronizados; `plugin-sql` sin usar                   | Persistencia | 🔴 Rehacer                       | Crítica   | F5            |
| H16 | `streetSource` acumula features huérfanas indefinidamente (memory leak lento)                 | Gráfico      | 🔴 Quitar/limpiar                | Baja      | F3            |
| H17 | Utilidades vectoriales reimplementadas en ~7 archivos con epsilons distintos                  | Geométrico   | 🟡 Consolidar                    | Baja      | Deuda técnica |
| H18 | Sin LOD/simplificación geométrica en zoom alejado                                             | Gráfico      | 🔵 Añadir                        | Media     | F6            |
| H19 | `StatsPanel` no se re-renderiza al mutar features del mismo `drawSource`                      | Gráfico/UI   | 🔴 Bug a corregir                | Media     | F1            |
| H20 | Estrategias de generación de ID inconsistentes entre comandos                                 | Transversal  | 🟡 Menor                         | Muy baja  | Deuda técnica |

Leyenda de veredicto: 🟢 Conservar · 🟡 Mejorar · 🔴 Quitar/Corregir/Rehacer · 🔵 Añadir.

---

## 2. Hallazgo crítico transversal: el Undo/Redo no usa el Command Stack (H1)

Esto merece una sección propia porque conecta robustez **y** performance, y condiciona el orden del plan.

**Evidencia:**

- `src/commands/CommandStack.ts` → `useCommandStack.undo()` y `.redo()` llaman a `useHistoryStore.getState().undo()/redo()`, que devuelven un snapshot GeoJSON y lo aplican con `applyRestoredSnapshot(drawSource, snapshot)`.
- Ese snapshot proviene de `historyStore.pushState(ctx.drawSource.getFeatures())` — **solo** serializa `drawSource`.
- Sin embargo, cada `Command` (`AddStreetCommand`, `AddRoundaboutCommand`, `SubdivideCommand`, `GenerateLotsCommand`, `RecomputeManzanoLotsCommand`, `ModifyGeometryCommand`, `DeleteFeaturesCommand`, `AddFeatureCommand`, `ClearFeaturesCommand`) implementa un método `undo(ctx)` propio, específico y ya optimizado (por ejemplo, `AddStreetCommand.undo()` llama `useStreetStore.getState().removeStreet(id)`). **Ninguno de estos métodos se invoca nunca** en el flujo real de Ctrl+Z.
- Calles (`useStreetStore`) y rotondas (`useRoundaboutStore`) **no son features de `drawSource`** — viven en stores Zustand aparte. El snapshot de `historyStore` no las conoce.

**Consecuencia real:** al trazar una calle, `recomputeManzanos()` corta las parcelas y dejan fragmentos de manzano en `drawSource` (sí capturados por el snapshot). Si el usuario presiona Ctrl+Z, el snapshot revierte los fragmentos de manzano, **pero la calle sigue en `useStreetStore.streets`** — resultado: una calle "fantasma" sin manzanos coherentes alrededor, un estado inconsistente entre el panel de calles y el mapa. Lo mismo aplica a rotondas.

Además, esto explica por qué existe `streetSource` (H16): OL's `Draw` interaction necesita un `VectorSource` propio para dibujar el sketch, pero como el sistema real de estado vive en `streetStore`, ese source queda huérfano — se llena de LineStrings que nunca se limpian ni se usan para render (el estilo del `streetLayer` es `undefined`; el pintado real ocurre en `PostrenderPainter` leyendo `useStreetStore`).

**Por qué esto también es un tema de performance:** el modelo de snapshot completo obliga a serializar (`GeoJSON.writeFeatures`) **todo** el proyecto en cada comando no coalescido, y a mantener hasta 50 copias completas en memoria (`MAX_HISTORY = 50`). Un modelo de comandos reversibles (lo que ya está 90% escrito) es órdenes de magnitud más barato: cada `undo()` solo toca las features que ese comando cambió.

**Recomendación:** pasar a un Command Stack real (pila de comandos ejecutados + puntero de posición), invocando `command.undo(ctx)` / `command.redo(ctx)`. Ver Fase 2.

---

## 3. Motor gráfico (rendering)

### 3.1 Inventario

| Componente                              | Archivo                                         | Rol actual                                                                       | Veredicto                                                 |
| --------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `WebGLVectorLayer` (drawLayer)          | `map/scene/DrawLayerRenderer.ts`, `map/Map.tsx` | Relleno/trazo GPU de lotes, manzanas, vías (color por capa vía `match` expr.)    | 🟢 Conservar, 🟡 mejorar estilo                           |
| `VectorLayer` measurementLayer          | `DrawLayerRenderer.ts`                          | Hit-testing invisible, mismo `VectorSource` que el WebGL                         | 🟡 Mejorar fuerte (quitar `declutter`, evaluar reemplazo) |
| `streetLayer` (vacío de estilo)         | `DrawLayerRenderer.ts`                          | Ancla; el pintado real es canvas custom                                          | 🟢 Conservar mecanismo                                    |
| `postrenderLayer` + `PostrenderPainter` | `map/scene/PostrenderPainter.ts`                | Motor canvas: labels, cotas, calles, rotondas, snap guides, lasso                | 🟡 Mejorar fuerte (memoización)                           |
| `cadGridLayer` (grilla CAD)             | `map/cadGridLayer.ts`                           | `VectorLayer` con `Feature` por línea, reconstruida en cada `moveend`/resolución | 🟡 Migrar a canvas puro                                   |
| `snapIndicatorLayer`                    | `map/Map.tsx`                                   | Indicador de snap (1 feature)                                                    | 🟢 Conservar                                              |
| Gizmo de `RotateLotsInteraction`        | `map/scene/RotateLotsInteraction.ts`            | 3 features, capa dedicada                                                        | 🟢 Conservar                                              |
| `BaseLayerManager`                      | `map/scene/BaseLayerManager.ts`                 | Selector OSM/Google/CAD                                                          | 🟢 Conservar                                              |
| Monkeypatch `willReadFrequently`        | `map/Map.tsx` (top-level)                       | Fuerza contexto software en **todos** los canvas 2D de la app                    | 🔴 Acotar/Quitar                                          |
| Handlers `pointermove` (cursor, snap)   | `map/Map.tsx`, `map/snapInteraction.ts`         | Actualizan Zustand sin throttle                                                  | 🟡 Mejorar (throttle)                                     |

### 3.2 Detalle de hallazgos

#### 3.2.1 Renderizado duplicado (H2)

`buildDrawLayers()` crea **un único** `VectorSource` (`source`) y lo comparte entre `webglLayer` (visible) y `measurementLayer` (invisible, `createMeasurementStyle()` retorna fill/stroke casi transparentes). Cada `addFeature`/`removeFeature`/`change` dispara el pipeline de render de **ambas** capas. `Select`, `Modify` y `SafeTranslate` usan `measurementLayer` como `hitDetectionLayer` porque `disableHitDetection: true` está seteado en la capa WebGL.

Esto es una decisión de diseño razonable (WebGL no hace hit-testing barato out-of-the-box en esta versión de OL), pero tiene dos problemas concretos:

- `measurementLayer` tiene `declutter: true`, lo cual activa cómputo de colisión de labels sobre geometría **invisible** — coste sin ningún beneficio visual. Es un quick-fix de una línea.
- El costo de re-tesselar y re-rasterizar en Canvas2D **toda** la geometría del proyecto en cada frame de interacción escala linealmente con el número de features, en paralelo al costo de WebGL. Para proyectos grandes (miles de lotes) esto es, literalmente, pagar el render dos veces.

#### 3.2.2 Grilla CAD como Features de OL (H3)

`cadGridLayer.ts::rebuildGridFeatures()` calcula el extent visible, aplica `snapSpacing()` y construye un `Feature` + `LineString` por cada línea horizontal/vertical dentro del extent (con padding), en cada `moveend` y `change:resolution`. Está bien acotado al extent visible (no es O(mundo)), pero usa el motor de Features/estilos de OL (`style: (feature) => GRID_STYLES[...]`) para algo que es, en esencia, dibujar líneas rectas repetidas. `PostrenderPainter` ya demuestra que este proyecto sabe pintar directamente en Canvas2D para casos similares (calles, cotas) — la grilla es la única pieza que sigue el camino más caro para un resultado visual más simple.

#### 3.2.3 `PostrenderPainter` sin memoización por frame (H4)

`PostrenderPainter.handle()` se ejecuta en **cada** evento `postrender` (es decir, en cada frame de render del mapa, no solo al soltar el mouse). Dentro:

- `paintFeatureLabels()` itera **todas** las features del proyecto en cada frame, llama `ctx.measureText()` para cada etiqueta candidata (colisión de cajas) sin cachear por `(texto, fuente)`.
- `pickStreetLabelSlots()` (dentro de `paintStreets`) también llama `ctx.measureText()` por calle, por frame.
- `computeStreetFillets()` se llama **dos veces** por cada cambio de calles (`outer:false` y `outer:true`), cada una O(n²) sobre el número de calles — el 90% del cálculo geométrico (intersección de rectas, ángulo, offset) es el mismo entre ambas llamadas, solo cambia el offset final.
- No hay gating de "vista sin cambios → no repintar labels": incluso durante una animación de zoom donde solo cambia la escala, se recalculan colisiones de texto para todas las features visibles en cada frame intermedio.

Para un proyecto con cientos/miles de lotes con cotas activas, este es probablemente el cuello de botella más perceptible durante pan/zoom.

#### 3.2.4 `pointermove` sin throttling (H5)

`map.on('pointermove', ...)` en `Map.tsx` llama `setCursorCoords(...)` en cada evento nativo del navegador (potencialmente cientos por segundo al mover el mouse). `SnapEngine` hace lo mismo con `useSnapLiveStore.getState().setActive(result)` en `snapInteraction.ts`. Ambos son _state updates_ de Zustand que disparan re-render de React (`StatusBar`, `SnapPanel`) en cascada, **además** del propio ciclo de render de OpenLayers y del trabajo de `PostrenderPainter`. Es de las optimizaciones más baratas y con mejor retorno del diagnóstico completo.

#### 3.2.5 Monkeypatch global `willReadFrequently` (H6)

En `map/Map.tsx`, a nivel de módulo, se parchea `HTMLCanvasElement.prototype.getContext` para forzar `willReadFrequently: true` en **todo** contexto `2d`/`bitmaprenderer` creado en la app. Este flag le indica al navegador que priorice lecturas de píxeles (`getImageData`) sobre velocidad de dibujo, típicamente cambiando a un backend de software. No se identificó ningún uso de `getImageData`/`getImageData`-like en el código provisto (la exportación PNG usa `canvas.toBlob`, que no lo requiere). Aplicado globalmente, este patch puede estar **penalizando** silenciosamente el rendimiento de dibujo puro (fillRect/stroke/fillText) de absolutamente todos los canvas de la app, incluido el propio canvas de OpenLayers y el de `PostrenderPainter`.

#### 3.2.6 Triplicación de algoritmos de redondeo de esquina (H7)

Tres implementaciones independientes de "redondear una esquina según su ángulo":

1. `geo/streetEngine.ts::computeStreetFillets` — intersección de rectas offset, O(n²) sobre calles, para pintar el borde de calzada/vereda.
2. `geo/roadNetworkEngine.ts::offsetPolylineMiter` — offset a inglete (sin redondeo) para construir los anillos que se restan booleanamente de las parcelas.
3. `geo/ringFillet.ts::roundRingReflex` — detecta vértices reflex del anillo resultante de la resta booleana y los redondea con arcos, usando la misma tabla de radios (`streetEngine.ts::getFilletRadiusForAngle`, reutilizada correctamente aquí).

No es un bug — resuelven necesidades distintas (visual de calzada vs. geometría de manzano post-resta) — pero triplica la superficie de mantenimiento de una misma idea ("radio de fillet según ángulo interno"). Riesgo: cualquier ajuste a la tabla de radios debe replicarse mentalmente en 3 lugares para mantener coherencia visual.

---

## 4. Motor geométrico

### 4.1 Inventario

| Componente                                                 | Archivo                                                              | Rol                                                              | Veredicto                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------ |
| Motor 2D propio (área, centroide, clipping, point-in-poly) | `geo/polygonEngine.ts`                                               | Núcleo de geometría plana usado por subdivisión                  | 🟢 Conservar núcleo                  |
| Subdivisión "Auto/Exacto/Modo2"                            | `geo/subdivisionAlgorithms.ts`                                       | Bisección iterativa (hasta 200 iters) por lote/columna/fila      | 🔴 Mover a Worker                    |
| Subdivisión "Cabecera+Cuerpo"                              | `geo/subdivisionCabeceraCuerpo.ts`                                   | Igual de intensivo, es el método por defecto (`auto`)            | 🔴 Mover a Worker                    |
| Métricas por feature                                       | `geo/metrics.ts`                                                     | Longitudes/área/perímetro, transform de coordenadas por vértice  | 🟡 Mejorar (incremental)             |
| Operaciones booleanas (JSTS)                               | `workers/geoOperations.ts` + `geoWorker.ts`                          | Union/diff/intersección/validación/overlaps/gaps/computeManzanos | 🟢 Conservar, 🟡 mejorar broad-phase |
| Offset de red vial                                         | `geo/roadNetworkEngine.ts`                                           | Anillos para restar booleanamente                                | 🟢 Conservar                         |
| Fillets visuales de calle                                  | `geo/streetEngine.ts`                                                | Redondeo visual de esquinas                                      | 🟢 Conservar (consolidar con H7)     |
| Fillet post-boolean                                        | `geo/ringFillet.ts`                                                  | Redondeo de manzano tras resta de vías                           | 🟢 Conservar (consolidar con H7)     |
| Arcos DXF                                                  | `geo/arcMath.ts`                                                     | Muestreo de arcos/círculos (import DXF)                          | 🟢 Conservar                         |
| CRS / UTM                                                  | `geo/crsTransform.ts`, `geo/utmZones.ts`, `geo/customProjections.ts` | Transformaciones de proyección                                   | 🟢 Conservar, corregir H10           |
| Undo/Redo por snapshot                                     | `store/historyStore.ts`                                              | Serializa `drawSource` completo                                  | 🔴 Reemplazar (ver F2)               |
| Índice espacial                                            | `map/spatialIndex.ts`                                                | RBush para snap                                                  | 🟢 Conservar, corregir H13           |
| Detección de overlaps/gaps                                 | `workers/geoOperations.ts`                                           | O(n²) sin broad-phase                                            | 🟡 Mejorar                           |

### 4.2 Detalle de hallazgos

#### 4.2.1 Subdivisión síncrona en el hilo principal (H8)

`subdivideManzanoCabeceraCuerpo`, `subdivideManzanoAuto` y `subdivideManzanoExact` recorren el manzano con búsquedas binarias por columna/fila/cabecera, cada una ejecutando hasta 120–200 iteraciones (`computeCuts`: 120, `subdivideHalf`: 160, `sliceBisectManzano`/`sliceBisectLote`: 200), y **cada iteración** reconstruye un polígono recortado (`clipToStrip`/`hbClipPolyHalf`) sobre el anillo completo del manzano. Esto corre:

- Síncronamente en el click del botón "Generar lotes" (`TopBar.tsx::handleGenerateLots` → `GenerateLotsCommand`, que además lo hace **para todos los manzanos del proyecto en un solo `execute()`**).
- Síncronamente en la vista previa del diálogo de subdivisión (`SubdivisionDialog.tsx::runPreview`), en el propio handler de click de React.
- Síncronamente en `RecomputeManzanoLotsCommand` (usado al rotar la dirección de corte de un manzano, un gesto interactivo).

A diferencia de las operaciones booleanas JSTS (correctamente offloadeadas al worker en `workers/geoOperations.ts`), esta es matemática pura sin dependencias de DOM/OL — es la candidata más directa y de mayor impacto para mover a un Web Worker.

#### 4.2.2 Recalculo de métricas de TODO el source en cada comando (H9)

`refreshSourceMetrics(source)` itera `source.getFeatures()` completo y llama `updateFeatureMetrics()` por cada una (que a su vez llama `transform()` de proj4/OL por cada vértice del anillo). Se invoca, sin excepción, tras: `GenerateLotsCommand`, `RecomputeManzanoLotsCommand`, `SubdivideCommand`, `ModifyGeometryCommand` (incluso cuando solo 1 feature cambió su geometría), y en `applyRestoredSnapshot` (undo/redo). No hay razón geométrica para recalcular las features **no tocadas** por el comando — cada comando ya conoce exactamente qué features creó/modificó/eliminó (`newLotIds`, `targets`, etc.).

#### 4.2.3 CRS no dispara refresh de métricas (H10)

`projectCrsStore.setMode / setUtmZone / autoDetectFromLonLat` cambian el modo/zona de proyección pero **no** llaman `refreshSourceMetrics`. Como `metrics.ts::projectRingToMetricPlane` depende directamente de `useProjectCrsStore.getState()`, cambiar de zona UTM (o de "dibujo libre" a UTM) deja las etiquetas de área/perímetro/longitud **desactualizadas** hasta que ocurra, por casualidad, algún otro comando que dispare un refresh global.

#### 4.2.4 `findOverlaps`/`findGaps`/`validateTopology` sin broad-phase (H11)

En `workers/geoOperations.ts`, `findOverlaps()` hace un doble loop `for i / for j=i+1` sobre **todas** las features del proyecto, ejecutando una intersección JSTS exacta por cada par, sin descartar primero por bounding box. Con cientos de lotes esto es perfectamente aceptable; con miles, es un O(n²) de operaciones booleanas (las más caras del sistema). El proyecto ya tiene la pieza para resolver esto — RBush (`map/spatialIndex.ts` en el hilo principal) o el propio STRtree que trae JSTS — solo falta usarla como filtro previo dentro del worker.

#### 4.2.5 `recomputeManzanos()` sin debounce (H12)

`AddStreetCommand.execute()` y `AddRoundaboutCommand.execute()` llaman `await recomputeManzanos()` **en cada llamada**, que a su vez serializa **todas** las parcelas del proyecto a GeoJSON y las envía al worker para resta booleana contra la red vial completa. Si un usuario traza 10 calles seguidas (o se importa un archivo con muchas calles), esto dispara 10 recomputes completos y consecutivos, cada uno reprocesando parcelas que no cambiaron.

#### 4.2.6 Índice espacial: reindexado incompleto (H13)

`map/Map.tsx` registra `drawSrc.on('addfeature', onSpatialInsert)` y `drawSrc.on('removefeature', onSpatialRemove)`, pero **no** escucha `changefeature`. Cuando `Modify` o `SafeTranslate` mutan la geometría de una feature en vivo (arrastre de vértice, traslado), el bounding box indexado en RBush queda desactualizado hasta el próximo ciclo add/remove real. Durante ese lapso, el snap engine (que usa este índice como broad-phase) puede evaluar mal la cercanía de otras features co-seleccionadas que se movieron junto con la editada. Adicionalmente, `SpatialIndex.remove()` reconstruye un objeto plano nuevo a partir de la geometría **actual** de la feature para removerla del árbol — si esa geometría cambió desde el insert original, el nodo indexado con el bbox viejo puede no encontrarse (riesgo a validar contra el comportamiento exacto de `rbush`, pero es un patrón conocido de fuga: nodos huérfanos que abultan el árbol con el tiempo). El guard de `featureMap.get(id)` en `search()`/`searchPoint()` evita que esto produzca resultados incorrectos, pero no evita la degradación de memoria/performance del árbol a largo plazo.

#### 4.2.7 Utilidades vectoriales duplicadas (H17)

`normalize`, `dist`/`hypot`, `midpoint`, intersección de rectas, y checks de "casi cero" están reimplementados de forma independiente en `geo/arcMath.ts`, `geo/roundaboutEngine.ts`, `geo/streetEngine.ts`, `geo/roadNetworkEngine.ts`, `geo/ringFillet.ts`, `geo/subdivisionCabeceraCuerpo.ts` y `geo/polygonEngine.ts`, cada uno con su propio épsilon de tolerancia (`1e-3`, `1e-4`, `1e-6`, `1e-7`, `1e-9`, `1e-10`, `1e-12` conviven en el proyecto). No es un bug hoy, pero es la clase de inconsistencia que produce bugs sutiles de geometría difíciles de reproducir ("¿por qué este caso límite se comporta distinto en subdivisión vs. en fillets de calle?").

---

## 5. Persistencia y almacenamiento (Desktop vs Web)

| Elemento                         | Archivo                                                                       | Problema                                                                                                                                                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autosave universal               | `io/persistence.ts` (`startAutosave`, Dexie/IndexedDB)                        | Se usa **siempre** desde `App.tsx`, incluso en Tauri, sin chequear `isTauri()`.                                                                                                                                   |
| "Gestor de Proyectos" desktop    | `io/persistenceDesktop.ts` (`listProjectsDesktop`, `loadProjectDesktop`, ...) | Usa una base `sql.js` (SQLite compilado a WASM) que se crea **en memoria** en `initDb()`, sin ninguna escritura a disco/`Tauri.fs` visible. Cada reinicio de la app de escritorio implica una base nueva y vacía. |
| Resultado combinado              | —                                                                             | En Desktop, el autosave (Dexie) y el navegador de proyectos (sql.js) son **dos almacenes completamente distintos y desincronizados**: lo que autosave guarda nunca aparece en "Gestor de Proyectos", y viceversa. |
| Dependencia declarada sin usar   | `package.json` → `@tauri-apps/plugin-sql`                                     | Está instalada pero no se referencia en ningún archivo revisado — sugiere una migración a persistencia nativa que quedó a medias.                                                                                 |
| `sql.js` también usado para GPKG | `io/gpkg.ts`                                                                  | Este uso **sí es legítimo** (GeoPackage es literalmente un archivo SQLite) — no debe confundirse con el uso (incorrecto) para persistencia de proyectos.                                                          |

**Impacto:** en la versión de escritorio, el usuario puede perder trabajo (cree que "Guardar" lo persiste en el gestor de proyectos, pero autosave usa otro backend) o ver una lista de proyectos vacía/desactualizada. Esto es más grave que cualquier tema de rendimiento — es pérdida de datos percibida.

---

## 6. Matriz de impacto vs. esfuerzo

```
Impacto alto  │ H1 (undo)      H8 (subdiv worker)   H15 (persistencia)
              │ H2 (doble render, quick-win parcial) H9 (métricas incr.)
              │ H5 (throttle)  H13 (spatial index)   H10 (CRS→metrics)
              │ H19 (StatsPanel)
              │
Impacto medio │ H4 (postrender memo)   H11 (broad-phase)   H12 (debounce)
              │ H3 (grilla canvas)     H18 (LOD)
              │
Impacto bajo  │ H6 (willReadFrequently)   H7 (fillets)   H16 (streetSource)
              │ H17 (vec utils)   H20 (ids)
              └───────────────────────────────────────────────────────────
                Esfuerzo bajo         Esfuerzo medio         Esfuerzo alto
```

Las celdas de **impacto alto / esfuerzo bajo** (H5, H19, H10, H13, H6, parte de H2) son las primeras candidatas — se resuelven en horas, no días, y no tocan arquitectura.

---

## 7. Plan de acción por fases

### Fase 0 — Instrumentación y línea base (previo a optimizar)

**Objetivo:** dejar de optimizar "a ojo" y tener números reales antes/después.

- Agregar marcas de performance (`performance.mark`/`performance.measure`) alrededor de: `PostrenderPainter.handle()`, `CommandStack.run()`, llamadas al worker (`geoWorkerClient.ts`), `refreshSourceMetrics`.
- HUD opcional de desarrollo (FPS + frame time + nº de features) activable por flag, para medir con proyectos sintéticos de 100 / 1.000 / 5.000 lotes.
- Definir el proyecto de prueba "stress" (script que genere N manzanos + subdivisión automática) para reproducir cargas grandes de forma determinística.

**Esfuerzo:** S. **Riesgo:** ninguno (solo instrumentación, no toca comportamiento).

---

### Fase 1 — Correcciones críticas de bajo riesgo (quick wins)

No requieren rearquitectura; se pueden desplegar de forma independiente.

| Tarea                                                                                                                                                                    | Resuelve     | Archivos                                                                          | Esfuerzo |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------- | -------- |
| Throttle de `pointermove` (cursor coords + snap live) vía `requestAnimationFrame` o intervalo mínimo (~50–80ms)                                                          | H5           | `map/Map.tsx`, `map/snapInteraction.ts`                                           | S        |
| `StatsPanel`: suscribirse a cambios reales del `drawSource` (mismo patrón `tick` que ya usa `ManzanoPanel.tsx`) en vez de depender de que cambie la referencia del store | H19          | `components/StatsPanel.tsx`                                                       | S        |
| Disparar `refreshSourceMetrics(drawSource)` al cambiar modo/zona CRS                                                                                                     | H10          | `store/projectCrsStore.ts` (o wrapper en `StatusBar.tsx`/`ProjectSetupModal.tsx`) | S        |
| Escuchar `changefeature` en `drawSrc` y reinsertar en `SpatialIndex` (throttleado, o al menos en `modifyend`/`translateend`)                                             | H13          | `map/Map.tsx`, `map/spatialIndex.ts`                                              | S/M      |
| Quitar `declutter: true` de `measurementLayer` (capa invisible, sin beneficio)                                                                                           | H2 (parcial) | `map/scene/DrawLayerRenderer.ts`                                                  | S        |
| Acotar o eliminar el monkeypatch de `willReadFrequently`; si algún caso puntual lo necesita, aplicarlo solo a ese canvas                                                 | H6           | `map/Map.tsx`                                                                     | S        |

**Criterio de aceptación:** los 6 ítems son independientes entre sí y no cambian ningún flujo de usuario visible (excepto que el panel de estadísticas y las cotas quedan siempre actualizados). Se pueden mergear uno por uno.

**Esfuerzo total:** S/M (días, no semanas). **Riesgo:** bajo.

---

### Fase 2 — Rediseño del Undo/Redo (Command Stack real)

**Objetivo:** resolver H1 (el hallazgo más crítico) y, de paso, eliminar el costo de serialización completa por comando (H14).

1. Reemplazar `useHistoryStore` (snapshot-based) por una pila de comandos ejecutados (`executed: Command[]`, `pointer: number`) dentro de `useCommandStack`.
2. `run(command)`: ejecutar, y si tiene éxito, truncar la pila a `pointer` y hacer `push`.
3. `undo()`: llamar `executed[pointer].undo(ctx)`, decrementar `pointer`.
4. `redo()`: incrementar `pointer`, llamar `executed[pointer].redo(ctx)` (o `execute(ctx)` si `redo` no está implementado — auditar cada comando).
5. Verificar que cada `Command.undo()` existente sea realmente completo (varios ya tocan `streetStore`/`roundaboutStore` correctamente vía `getState()` directo, así que "simplemente empiezan a ejecutarse" sin cambios adicionales).
6. Cerrar el caso borde de `InteractionModeController.ts::modify.on('modifyend', ...)` donde, si `pendingModify` es `null` (no se capturó `modifystart`), la edición se aplica **sin pasar por `runCommand`** — asegurar que siempre haya una captura antes de modificar, o forzar creación de comando en ese fallback.
7. Mantener (opcional) un snapshot ligero de **solo geometría** cada N comandos como red de seguridad ante bugs de `undo()` individuales mal implementados, pero sin las propiedades derivadas (`segmentLengths`, `labelPoint`, `areaM2`, etc. — se recalculan solas al restaurar).
8. Retirar `store/historyStore.ts` una vez validado (o dejarlo detrás de un flag por un tiempo, para rollback rápido).

**Criterio de aceptación:** trazar una calle/rotonda y presionar Ctrl+Z debe eliminarla completamente (del mapa **y** del panel de calles/rotondas), sin dejar manzanos huérfanos. Suite de pruebas manuales: crear → editar → subdividir → deshacer × N → rehacer × N, verificando paridad de estado en cada paso.

**Esfuerzo:** M/L. **Riesgo:** medio — es el cambio de mayor superficie del plan, pero está muy acotado (un solo archivo central, `CommandStack.ts`, más ajustes puntuales en `InteractionModeController.ts`).

---

### Fase 3 — Motor gráfico: eliminar renderizado duplicado y trabajo innecesario por frame

| Tarea                                                                                                                                                                                                                                                                                               | Resuelve        | Detalle                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Migrar `cadGridLayer` de `VectorLayer`+`Feature` a una capa de canvas puro (mismo patrón que `PostrenderPainter`: función `render` custom sobre un `Layer` de OL)                                                                                                                                   | H3              | Elimina la creación de cientos de objetos `Feature`/`LineString` por pan/zoom y la función de estilo por feature.            |
| Caché de `ctx.measureText` en `PostrenderPainter` por clave `(texto, fuente)`, invalidada solo si cambia el texto/tamaño de fuente                                                                                                                                                                  | H4              | Reduce drásticamente las llamadas a `measureText` en `paintFeatureLabels` y `pickStreetLabelSlots`.                          |
| Dirty-check por frame en `PostrenderPainter.handle()`: comparar un hash barato (nº de features + bbox de vista redondeado + zoom redondeado + `selectedIds.size`) contra el del frame anterior; si no cambió, reusar el último resultado pintado (o simplemente no recalcular colisiones de labels) | H4              | Evita recomputar layout de texto en frames donde nada relevante cambió (p. ej. frames intermedios de una animación de zoom). |
| Unificar el doble cálculo de `computeStreetFillets(outer:false)` / `computeStreetFillets(outer:true)` en una sola pasada que devuelva ambos offsets a partir del mismo cómputo de intersección/ángulo                                                                                               | H4/H7           | Evita repetir el O(n²) completo dos veces por cada cambio de calles.                                                         |
| Modo "barato durante interacción": mientras hay un `movestart` sin `moveend` (pan/zoom activo), omitir el pintado de labels de texto (dejar solo geometría vía WebGL) y repintar labels completos en `moveend`                                                                                      | H4              | Patrón estándar en motores de mapas para mantener FPS durante gestos.                                                        |
| Limpiar `streetSource` tras extraer la geometría en `drawend` (o no usarlo como acumulador — extraer coords y hacer `source.clear()` inmediatamente)                                                                                                                                                | H16             | Evita la fuga lenta de features huérfanas.                                                                                   |
| (Opcional, mayor esfuerzo) Diseñar hit-testing propio con `SpatialIndex` (RBush) + `pointInPoly` (ya existe en `polygonEngine.ts`) para `Select`/`Modify`/`SafeTranslate`, permitiendo eliminar `measurementLayer` como fuente de verdad de interacción                                             | H2 (definitivo) | Ver Fase 6 — es el único ítem de esta fase que toca la lógica de interacción, por eso se separa como stretch goal.           |

**Esfuerzo:** M. **Riesgo:** bajo-medio (los primeros 5 ítems son locales a `PostrenderPainter`/`cadGridLayer` y no cambian comportamiento de interacción).

---

### Fase 4 — Motor geométrico: cómputo pesado fuera del hilo principal + recálculo incremental

| Tarea                                                                                                                                                                                                                                                                                           | Resuelve | Detalle                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portar `subdivideManzano` / `subdivide` (todas las variantes: auto, exacto, modo2, cabecera-cuerpo, manual-slice) al Web Worker existente (extender `geoWorker.ts`/`geoOperations.ts`, o crear un worker dedicado de subdivisión)                                                               | H8       | Las funciones de `polygonEngine.ts` y `subdivisionAlgorithms.ts` son puras (no tocan OL/DOM) — se envían anillos planos + parámetros, se reciben anillos resultantes; la construcción de `ol.Feature` se hace de vuelta en el hilo principal, igual patrón que `computeManzanosInWorker`. |
| `SubdivisionDialog.runPreview` / `applySubdivision` → async al worker, usando el `loading` que ya existe en `useSubdivisionStore`                                                                                                                                                               | H8       | Restaura feedback visual mientras se calcula, en vez de congelar la UI.                                                                                                                                                                                                                   |
| `GenerateLotsCommand` / `RecomputeManzanoLotsCommand` → delegar el loop de subdivisión al worker                                                                                                                                                                                                | H8       | Mismo patrón.                                                                                                                                                                                                                                                                             |
| Reemplazar los `refreshSourceMetrics(source)` "globales" dentro de comandos por recálculo puntual de las features realmente tocadas (`newLotIds`, `targets`, etc.); reservar el refresh global solo para: import de proyecto, restauración de snapshot (si aún existe tras F2), y cambio de CRS | H9       | Cada comando ya conoce su lista de features afectadas — es un cambio de alcance, no de algoritmo.                                                                                                                                                                                         |
| Debounce de `recomputeManzanos()` (150–300ms) cuando se agregan varias calles/rotondas en sucesión rápida, o exponer un modo "batch" explícito para importaciones masivas                                                                                                                       | H12      | Evita recomputar la red vial completa N veces cuando el usuario traza N calles seguidas.                                                                                                                                                                                                  |
| Agregar broad-phase espacial (RBush/STRtree) antes de las pruebas exactas JSTS en `findOverlaps` y `findGaps`/`validateTopology`                                                                                                                                                                | H11      | Pasa de O(n²) puro a ~O(n log n) + pares candidatos reales.                                                                                                                                                                                                                               |

**Esfuerzo:** L (la migración a worker es el ítem más grande del plan completo, pero es aislable: el motor geométrico ya es puro TypeScript sin dependencias de OL/DOM). **Riesgo:** medio — requiere cuidado en la transferencia de datos (arrays planos, no objetos `Pt` con métodos) y en mantener el mismo resultado numérico que la versión síncrona actual (usar el mismo código, solo cambiar dónde corre).

---

### Fase 5 — Persistencia unificada (Desktop + Web)

1. Definir una interfaz común de persistencia (`ProjectStore`: `save`, `load`, `list`, `delete`, `duplicate`) con dos implementaciones: `IndexedDbProjectStore` (web, Dexie — ya existe, reutilizar) y `TauriSqlProjectStore` (desktop, usando `@tauri-apps/plugin-sql` — ya está en `package.json` sin usar).
2. Migrar `io/persistenceDesktop.ts` de `sql.js` en memoria a `@tauri-apps/plugin-sql` (SQLite nativo, persistente a disco de verdad).
3. `App.tsx::startAutosave` debe elegir el backend según `isTauri()` (ya existe ese helper en `io/persistenceDesktop.ts`), en vez de usar Dexie incondicionalmente.
4. `ProjectBrowserModal.tsx` y el flujo de autosave deben apuntar al **mismo** backend en Desktop, eliminando la desincronización actual.
5. Conservar `sql.js` **exclusivamente** para lectura/escritura de archivos `.gpkg` (`io/gpkg.ts`), que es su uso legítimo — documentar esto explícitamente en el código para que no se vuelva a reutilizar por error como motor de persistencia de proyectos.
6. Migración de datos: si ya hay usuarios de desktop con proyectos en la base `sql.js` en memoria, esos datos probablemente ya se perdieron en cada reinicio — no hay migración real posible, pero conviene verificar si hay algún export/backup accesible antes de cortar el camino viejo.

**Esfuerzo:** M. **Riesgo:** medio-alto solo por ser un cambio de "dónde vive la verdad de los datos" — requiere pruebas exhaustivas de guardar/cerrar/reabrir la app.

---

### Fase 6 — Roadmap avanzado (stretch goals, no bloqueantes)

| Tarea                                                                                                                                                                  | Resuelve        | Nota                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hit-testing propio (RBush + `pointInPoly`) para reemplazar `measurementLayer` por completo                                                                             | H2 (definitivo) | Mayor esfuerzo de reescritura de `InteractionModeController.ts` (Select/Modify/Translate/Lasso); alto beneficio en proyectos grandes.                                      |
| LOD / simplificación geométrica dependiente de resolución (usar `geometry.simplify(tolerance)`, ya disponible en OL, para el estilo WebGL cuando el zoom está alejado) | H18             | Relevante sobre todo para geometría importada (DXF/KML) con muchos vértices por arco (`sampleArc` fijo en 32 segmentos) y rotondas con hasta 160 segmentos (`circleRing`). |
| Culling/quadtree de labels en vez de recorrer todas las features en `paintFeatureLabels`                                                                               | H4 (extensión)  | Solo pintar candidatos a etiqueta dentro del extent visible, no todo el proyecto.                                                                                          |
| Virtualización de listas largas en paneles (`ManzanoPanel`, `LayerPanel`) si el proyecto crece a cientos de manzanos/capas                                             | —               | Preventivo, no urgente con los volúmenes actuales del código.                                                                                                              |
| Web Worker dedicado para la serialización de snapshots (si se conserva algún snapshot de respaldo tras F2) en proyectos muy grandes                                    | H14 (residual)  | Solo si F2 conserva snapshots periódicos como red de seguridad.                                                                                                            |

---

### Deuda técnica transversal (no bloqueante, hacer oportunistamente)

- **H7 / H17 — Consolidar utilidades vectoriales:** crear `geo/vec2.ts` con `normalize`, `dist`, `midpoint`, `lineLineIntersection`, y constantes de épsilon documentadas (`EPS_COORD`, `EPS_AREA`, `EPS_ANGLE`), y migrar los ~7 archivos que las reimplementan. Reduce riesgo de divergencia numérica entre subsistemas.
- **H20 — Generación de IDs:** unificar bajo un solo generador (contador global + prefijo, como ya usa `AddFeatureCommand`/`transforms.ts`) en vez de mezclar `Date.now()+Math.random()` en `SubdivideCommand`/`GenerateLotsCommand`.

---

## 8. Métricas de éxito (cómo medir que mejoró)

| Métrica                                                                | Método                                                                                        | Objetivo orientativo                                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Frame time durante pan/zoom con proyecto de 1.000+ lotes               | `performance.measure` alrededor de `PostrenderPainter.handle` + `requestAnimationFrame` delta | < 16ms (60fps) en pan simple; < 33ms (30fps) aceptable con cotas/labels activos                             |
| Latencia de "Generar lotes" en un manzano grande                       | Timestamp antes/después del comando                                                           | No debe bloquear el hilo de UI (verificable: la barra de progreso/spinner debe animarse durante el cálculo) |
| Tiempo de Ctrl+Z / Ctrl+Y                                              | Timestamp en `CommandStack.undo/redo`                                                         | Prácticamente instantáneo (<5ms) tras Fase 2, independiente del tamaño del proyecto                         |
| Memoria retenida por historial                                         | `performance.memory` (Chrome) o conteo de snapshots                                           | Debe dejar de crecer linealmente con `MAX_HISTORY × tamaño de proyecto` tras Fase 2                         |
| Consistencia de datos tras Ctrl+Z sobre calles/rotondas                | Prueba manual/E2E                                                                             | 0 discrepancias entre `useStreetStore`/`useRoundaboutStore` y lo visible en el mapa                         |
| Paridad de proyectos entre autosave y "Gestor de Proyectos" en Desktop | Prueba manual: guardar, cerrar, reabrir                                                       | 100% — un proyecto autosaveado debe aparecer en el gestor                                                   |

---

## 9. Riesgos y consideraciones de migración

- **Fase 2 (Undo/Redo)** es la de mayor riesgo funcional porque toca una función que el usuario usa constantemente y que hoy "funciona, aunque mal" (deshace la mayoría de las cosas, salvo calles/rotondas). Se recomienda feature-flag o rollout gradual, y una batería de pruebas manuales de regresión antes de retirar `historyStore` definitivamente.
- **Fase 4 (worker de subdivisión)** requiere que las funciones matemáticas involucradas sigan siendo deterministas y libres de referencias a `Feature`/`Polygon` de OL dentro del worker (ya lo son en su mayoría — son arrays `Pt[]`); el riesgo principal es de "costo de serialización" para anillos con miles de vértices (mitigable con `Transferable`/`ArrayBuffer` si hiciera falta, aunque para polígonos urbanos típicos no debería ser necesario).
- **Fase 5 (persistencia)** implica decidir qué pasa con datos ya "perdidos" en la base `sql.js` en memoria de instalaciones existentes — comunicar claramente que no hay migración retroactiva posible si esos datos nunca tocaron disco.
- **Desktop vs Web — diferencias de rendering:** el WebView de Tauri (WebView2 en Windows / WKWebView en macOS / WebKitGTK en Linux) no siempre garantiza la misma aceleración GPU que un navegador Chrome de escritorio. Se recomienda incluir explícitamente Tauri en la Fase 0 de instrumentación/baseline, no asumir que "si anda bien en Chrome, anda igual en la app de escritorio".

---

## 10. Anexo — Mapa de archivos por fase

- **Fase 1:** `map/Map.tsx`, `map/snapInteraction.ts`, `map/spatialIndex.ts`, `components/StatsPanel.tsx`, `store/projectCrsStore.ts`, `map/scene/DrawLayerRenderer.ts`
- **Fase 2:** `commands/CommandStack.ts`, `store/historyStore.ts` (retirar), `map/scene/InteractionModeController.ts`
- **Fase 3:** `map/cadGridLayer.ts`, `map/scene/PostrenderPainter.ts`, `geo/streetEngine.ts`, `map/scene/InteractionModeController.ts` (limpieza de `streetSource`)
- **Fase 4:** `geo/subdivisionAlgorithms.ts`, `geo/subdivisionCabeceraCuerpo.ts`, `geo/polygonEngine.ts`, `workers/geoWorker.ts`, `workers/geoOperations.ts`, `workers/geoWorkerClient.ts`, `geo/metrics.ts`, `commands/GenerateLotsCommand.ts`, `commands/RecomputeManzanoLotsCommand.ts`, `commands/SubdivideCommand.ts`, `components/SubdivisionDialog.tsx`, `store/mapStore.ts` (`recomputeManzanos`)
- **Fase 5:** `io/persistence.ts`, `io/persistenceDesktop.ts`, `io/sqlLoader.ts`, `io/gpkg.ts`, `App.tsx`, `components/ProjectBrowserModal.tsx`
- **Fase 6:** `map/scene/InteractionModeController.ts`, `geo/arcMath.ts`, `geo/roundaboutEngine.ts`, `components/ManzanoPanel.tsx`, `components/LayerPanel.tsx`

---

**Conclusión:** el diseño de fondo (WebGL + worker JSTS + RBush + canvas overlay) es una base correcta para un CAD/SIG web-first que también corre en desktop. Los problemas encontrados son de **integración incompleta** entre esas piezas (undo que no usa comandos, subdivisión que no usa el worker, persistencia con dos backends), más un puñado de gastos de render por frame sin memoización. Ninguno exige tirar código; el plan de fases prioriza justamente reconectar lo que ya está bien construido antes de agregar nada nuevo.
