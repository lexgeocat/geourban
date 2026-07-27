# Diagnóstico y Plan de Mejora — Sistema de Capas (Layer Panel)

### GeoUrban — CAD/GIS Editor

---

## 0. Resumen ejecutivo

Se pidieron tres cambios de comportamiento sobre el sistema de capas:

1. **Proyecto nuevo = 0 capas.** Hoy todo proyecto arranca con 5 capas ya creadas.
2. **Asignación de capa obligatoria** para toda entidad que se dibuje o genere (polígono, línea, rectángulo, trazado vial, rotonda, generación automática de lotes, subdivisión de manzano, y la futura función "generar vértices"). Si no existe la capa, el sistema debe crearla — nunca debe quedar una entidad sin capa asignada. Se propone además un catálogo sugerido de 9 capas (6 polígono, 2 línea, 1 punto).
3. **Simplificar las herramientas de cada fila de capa** en el panel: quitar el reordenamiento por arrastre (drag & drop) y quitar el número de porcentaje de opacidad visible.

Este documento diagnostica el estado real del código para cada uno de esos tres puntos, identifica huecos de arquitectura no evidentes a simple vista (particularmente en Rotondas y Vías, que **no viven en el mismo mecanismo de capas** que el resto de las entidades), y entrega un plan de implementación por fases con archivos y funciones puntuales a modificar.

---

## 1. Diagnóstico del estado actual

### 1.1 Requisito 1 — "El panel de capas debe iniciar en cero"

**Estado actual: NO se cumple.** El registro de capas nace con 5 capas de fábrica.

| Archivo                                     | Qué hace                                                                                                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/objectModel.ts`                   | `DEFAULT_LAYERS` define 5 capas fijas: `lots` (Lotes), `manzanas` (Manzanos), `streets` (Viales), `equipment` (Equipamientos), `greenareas` (Áreas verdes).                            |
| `src/store/entities/layersRegistryStore.ts` | El store `useLayersStore` inicializa `layers: DEFAULT_LAYERS.map((l) => ({ ...l }))` — es decir, el registro **nunca empieza vacío**, ni siquiera antes de que el usuario dibuje nada. |
| `src/io/types.ts`                           | `createEmptyProject()` también siembra `layers: DEFAULT_LAYERS.map(...)` — todo "Nuevo proyecto" hereda las mismas 5 capas.                                                            |
| `src/store/entities/layersRegistryStore.ts` | `resetToDefaults()` (usado en "Nuevo proyecto", ver `useTopBarActions.handleNewProject`) vuelve a sembrar `DEFAULT_LAYERS`, reforzando el mismo comportamiento.                        |

**Consecuencia directa:** aunque el usuario nunca dibuje nada, el `LayerPanel` ya muestra 5 filas. Esto contradice el requisito 1 de forma estructural, no cosmética — está en el estado inicial de tres módulos distintos que hay que tocar en conjunto.

---

### 1.2 Requisito 2 — "Toda entidad dibujada/generada debe preguntar o crear su capa"

**Estado actual: cumplimiento parcial e inconsistente.** Existe un mecanismo (`layerPickerStore` + `LayerPickerModal`) que en teoría pregunta la capa destino, pero:

- No se aplica a **todas** las acciones que crean geometría.
- Incluso donde se aplica, **tiene bypasses silenciosos** que permiten saltarse la pregunta.
- No tiene una opción de **"crear capa nueva"** integrada en el propio diálogo — hoy son dos flujos separados (elegir capa existente vs. crear capa) sin puente entre sí.

#### 1.2.1 Cobertura real, acción por acción

| Acción                                                                            | Dispara pregunta hoy? | Dónde                                                                            | Problema                                                                                                                         |
| --------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Dibujar **polígono** (lote/área verde/equipamiento)                               | Sí                    | `PolygonMode.ts` → `pickLayerForKind(areaKind)`                                  | Sujeto a los bypasses descritos en 1.2.2                                                                                         |
| Dibujar **línea**                                                                 | Sí                    | `LineMode.ts` → `pickLayerForKind('linea')`                                      | Ídem                                                                                                                             |
| Dibujar **rectángulo**                                                            | Sí                    | `RectangleMode.ts` → `pickLayerForKind(areaKind)`                                | Ídem                                                                                                                             |
| **Trazar calle/vía**                                                              | Sí                    | `StreetMode.ts` → `pickLayerForKind('calle')`                                    | Ídem, y además ver 1.2.3                                                                                                         |
| **Rotonda** (trazado de 2 clics)                                                  | **No, nunca**         | `RoundaboutMode.ts` → `AddRoundaboutCommand` → `roundaboutStore.addRoundabout()` | **No existe ningún `layerId` en el modelo de rotonda.** Nunca se pregunta ni se puede asignar. Ver 1.2.3.                        |
| **Generar lotes automático** ("Generar todos")                                    | **No**                | `GenerateLotsCommand.applyChunkResults` → `resolveLayerId(undefined, 'lote')`    | Resuelve en silencio contra la capa activa o la primera capa de kind `lote`; si no hay ninguna, el lote queda **sin `layerId`**. |
| **Recalcular lotes de un manzano** (botón individual/rotar lotes)                 | **No**                | `RecomputeManzanoLotsCommand.execute` → `resolveLayerId(undefined, 'lote')`      | Igual que arriba.                                                                                                                |
| **Subdividir manzano** (diálogo, cualquier método: auto/exact/modo2/manual-slice) | **No**                | `SubdivideCommand.execute` → `resolveLayerId(undefined, 'lote')`                 | Igual que arriba.                                                                                                                |
| **Generar vértices** (aplicar a capas seleccionadas)                              | No existe todavía     | —                                                                                | Función a construir desde cero; debe nacer ya con el flujo obligatorio incorporado.                                              |
| Manzanos creados automáticamente al cortar una vía                                | **No**                | `recomputeManzanos.ts` → `resolveManzanaLayerId()`                               | Caso especial: es geometría derivada, no un "dibujo" directo del usuario — ver nota en 3.4.                                      |

**Conclusión:** de las acciones explícitamente listadas por el requisito, **3 de 8 nunca preguntan nada** (Rotonda, Generar lotes automático, Subdivisión de manzano — y también el recálculo puntual), y la función de vértices ni siquiera existe. Esto no es un detalle menor: son justamente las que generan más volumen de features de una sola vez.

#### 1.2.2 Los bypasses silenciosos del mecanismo existente

Incluso en las 4 acciones que sí llaman a `pickLayerForKind` (Polígono, Línea, Rectángulo, Calle), la pregunta **puede evitarse** de tres maneras distintas, todas presentes hoy:

1. **Interruptor global "Preguntar capa al crear geometría"** (`layerPickerStore.askEnabled`, expuesto como checkbox en `LayerPanel.tsx`). Si está en `false`, `request()` resuelve `undefined` de inmediato sin mostrar nada — cae al fallback silencioso de `resolveLayerId` (capa activa → primera capa que matchee el kind → sin capa).
2. **"No preguntar de nuevo para <kind> en esta sesión"** (checkbox dentro de `LayerPickerModal`). Una vez tildado, `rememberedByKind[kind]` queda fijado y todas las siguientes entidades de ese kind se asignan en silencio, sin ningún indicio visual de que ya no se está preguntando.
3. **Botón "Cancelar (usar capa activa)"** dentro del propio modal — cierra el diálogo y cae al mismo fallback silencioso (`resolvePending(undefined)`).

El requisito dice explícitamente **"SI O SI preguntarán... o si no se creará la capa"**. Los tres puntos de arriba son exactamente lo opuesto: formas de que el sistema _no_ pregunte y _no_ cree nada, dejando la entidad con `layerId` ausente o heredado por casualidad.

#### 1.2.3 Hueco de arquitectura: Vías y Rotondas no son "features de capa"

Este es el hallazgo más importante del diagnóstico, porque no es un bug puntual sino una limitación de diseño:

- Los **lotes, manzanos, equipamientos y áreas verdes** son `Feature` de OpenLayers dentro de un único `drawSource` compartido, y cada uno lleva su propio atributo `layerId`. El render pasa por `LayeredWebglRenderer` (`DrawLayerRenderer.ts`), que crea **un `WebGLVectorLayer` real por cada capa del registro** y "espeja" cada feature hacia el mirror-layer de su `layerId`. Por eso estas entidades sí pueden tener color, opacidad y visibilidad **por capa individual**.
- Las **calles** (`streetStore`) y las **rotondas** (`roundaboutStore`) **no viven en `drawSource`**. Son arrays en stores de Zustand aparte, y se dibujan a mano, cuadro a cuadro, por `StreetPainter` y `RoundaboutPainter` sobre un único canvas 2D de postrender (`PostrenderPainter`).
- Su visibilidad y color hoy **no vienen de un `layerId` individual**: `StreetPainter.paint()` resuelve todo contra `useLayersStore.getState().getLayerForKind('calle')` (una única capa compartida por _todas_ las calles), y `RoundaboutPainter.paint()` resuelve visibilidad contra `useLayersStore.getState().hasKindVisible('calle')` — ni siquiera tiene su propia capa `kind`, comparte literalmente la de "Viales".

**Implicación para el plan:** pedir que "Vías" y "Rotonda" sean dos capas sugeridas _distintas y seleccionables por el usuario al trazar_ no es solo agregar una entrada al catálogo — requiere:

1. Agregar `layerId` al modelo `Street` (el campo **ya existe** como opcional en `streetStore.ts`, pero **nadie lo usa para pintar**) y a `Roundabout`/`RoundaboutParams` (**no existe**, hay que crearlo).
2. Que `StreetPainter` y `RoundaboutPainter` resuelvan color/opacidad/visibilidad **por el `layerId` de cada feature individual**, no por un único kind compartido.
3. Que el conteo de features por capa (`computeLayerFeatureCounts`, usado para el badge numérico en `LayerPanel`) también cuente calles y rotondas, hoy solo recorre `drawSource`.

Esto se detalla como workstream propio en la sección 3.

---

### 1.3 Requisito 3 — "Herramientas de cada capa: quitar arrastre y quitar % de opacidad"

**Estado actual:** ambas cosas existen hoy en `src/components/panels/LayerPanel.tsx`.

- **Arrastre (drag & drop):** en `LayerRow`, el ícono `IconGrip` tiene `draggable`, `onDragStart`/`onDragEnd`; el contenedor de fila en `LayerPanel` tiene `onDragOver`/`onDragLeave`/`onDrop` y el handler `handleDrop`, que termina llamando `ReorderLayersCommand`. Convive con botones de teclado ↑/↓ (`IconChevronSmall`, función `moveLayer`) que **hacen exactamente lo mismo** (mismo comando `ReorderLayersCommand`) por un camino accesible por teclado.
- **Porcentaje de opacidad:** el componente `OpacitySlider` (mismo archivo) renderiza el `<input type="range">` **más** un `<span>` con `{Math.round(value * 100)}%`. Es ese `<span>` el que hay que eliminar.

No hay complejidad oculta aquí — es un recorte de UI acotado a un archivo, pero hay que decidir qué se conserva como mecanismo de reordenamiento (ver recomendación en 3.3) y cómo no perder accesibilidad al esconder el número de opacidad.

---

## 2. Síntesis de hallazgos (para referencia rápida)

| #   | Hallazgo                                                                                                                                          | Severidad                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| H1  | `DEFAULT_LAYERS` puebla 5 capas en 3 puntos de entrada (`objectModel.ts`, `layersRegistryStore.ts`, `io/types.ts`)                                | Alta — bloquea requisito 1                                |
| H2  | Rotonda nunca pregunta capa ni tiene `layerId`                                                                                                    | Alta — bloquea requisito 2                                |
| H3  | Generar lotes automático / recálculo / subdivisión resuelven capa en silencio                                                                     | Alta — bloquea requisito 2                                |
| H4  | `askEnabled` + "no preguntar de nuevo" + botón "Cancelar (usar capa activa)" son 3 bypasses que vuelven la pregunta opcional                      | Alta — contradice el "SI O SI"                            |
| H5  | No existe "crear capa" dentro del flujo de pregunta — son dos modales desconectados (`LayerPickerModal` vs `AddLayerModal`)                       | Media-alta                                                |
| H6  | Vías y Rotondas no están integradas al sistema de capas por-feature (`layerId` ignorado en `StreetPainter`, inexistente en `Roundabout`)          | Alta — condiciona cómo se implementa el catálogo sugerido |
| H7  | El catálogo de `kind` actual (`GeoUrbanFeatureKind`) no contempla `urbanizacion`, `georreferenciado`, `rotonda` ni un tipo punto (`vert_geo`)     | Media — hay que extender el enum                          |
| H8  | "Urbanización" y "Georreferenciado" hoy son overlays efímeros calculados por `BoundaryPainter` (envolvente convexa), no features reales editables | Media — hay que decidir su naturaleza como capa           |
| H9  | Función "Generar vértices" no existe                                                                                                              | Media — a construir desde cero                            |
| H10 | `LayerPanel` tiene drag & drop + número de opacidad a remover                                                                                     | Baja — cambio acotado                                     |
| H11 | `NON_REMOVABLE` en `LayerPanel.tsx` protege por id hardcodeado los 5 ids de `DEFAULT_LAYERS`, que dejarán de existir                              | Baja — hay que revisar la regla                           |

---

## 3. Plan de mejora

### 3.1 Bloque A — Proyecto nuevo sin capas (Requisito 1)

**Objetivo:** que `useLayersStore` y todo proyecto (`createEmptyProject`) nazcan con `layers: []`.

1. `src/core/objectModel.ts`: `DEFAULT_LAYERS` pasa a ser `[]` (se mantiene el símbolo exportado por compatibilidad, pero vacío). El catálogo de colores/nombres/kind que hoy vive ahí **se traslada** a un nuevo catálogo de _sugerencias_ (ver Bloque B, no auto-sembrado).
2. `src/store/entities/layersRegistryStore.ts`: estado inicial `layers: []`, `index: new Map()`. `resetToDefaults()` pasa a vaciar (`layers: []`) — considerar renombrar a `resetToEmpty()` para que el nombre no induzca a pensar que reaplica un set de defaults.
3. `src/io/types.ts::createEmptyProject`: `layers: []`.
4. **Import/export y migración:** `loadLayers()` (usado al abrir/importar un proyecto) hoy hace _"si `layers` viene vacío, sembrar `DEFAULT_LAYERS`"_. Con `DEFAULT_LAYERS = []`, ese fallback deja de tener efecto — lo cual es correcto para proyectos nuevos, pero hay que decidir qué pasa con **proyectos viejos guardados antes de este cambio** que sí dependían de esas 5 capas por nombre/id (`lots`, `manzanas`, `streets`, `equipment`, `greenareas`). Recomendación: mantener esos 5 ids reconocibles únicamente dentro del catálogo de _sugerencias_ (Bloque B) para que, si un proyecto viejo referencia esos `layerId` en sus features pero no trae `layers` en el JSON, el mecanismo de huérfanos (`reconcileOrphanFeatures`, ya existente) los mueva a "Sin capa" — nunca "adivinar" y recrear las 5 automáticamente.
5. **Estado vacío en la UI:** el `LayerPanel` ya renderiza condicionalmente (`registryRowsDisplay.length` puede ser 0 sin romper nada); agregar un mensaje explícito tipo _"Todavía no hay capas. Se crearán automáticamente al dibujar tu primera entidad."_ para que el estado en cero no se perciba como un error.
6. El **fallback mirror-layer** (`FALLBACK_STYLE` / "Sin capa" en `LayeredWebglRenderer`) se mantiene intacto como red de seguridad — sigue siendo necesario para features importadas cuyo `layerId` no resuelva.

---

### 3.2 Bloque B — Asignación obligatoria + catálogo sugerido (Requisito 2)

#### 3.2.1 Catálogo sugerido (nuevo, separado de `DEFAULT_LAYERS`)

Se crea un catálogo **estático de sugerencias** (no se auto-siembra; solo se usa para prellenar el formulario de "crear capa nueva"):

| Sugerencia             | `kind` propuesto             | Geometría | Notas                                                                                                                                         |
| ---------------------- | ---------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Urbanización           | `urbanizacion` _(nuevo)_     | Polígono  | Hoy es un overlay calculado (envolvente convexa), no una capa real — ver 3.2.5                                                                |
| Georreferenciado       | `georreferenciado` _(nuevo)_ | Polígono  | Ídem                                                                                                                                          |
| Manzano                | `manzana` _(existente)_      | Polígono  | Ya soportado end-to-end                                                                                                                       |
| Lote                   | `lote` _(existente)_         | Polígono  | Ya soportado end-to-end                                                                                                                       |
| Áreas verdes           | `area_verde` _(existente)_   | Polígono  | Ya soportado end-to-end                                                                                                                       |
| Áreas de equipamientos | `equipamiento` _(existente)_ | Polígono  | Ya soportado end-to-end                                                                                                                       |
| Vías                   | `calle` _(existente)_        | Línea     | Requiere refactor de render (H6)                                                                                                              |
| Rotonda                | `rotonda` _(nuevo)_          | Línea*    | Requiere `layerId` end-to-end (H2, H6). *Se pinta con anillos, pero se agrupa como capa "de línea" a nivel de catálogo/ícono, igual que Vías. |
| Vert_Geo               | `vert_geo` _(nuevo)_         | Punto     | Destino por defecto de "Generar vértices" y de cualquier punto geo-referenciado suelto                                                        |

`GeoUrbanFeatureKind` (en `core/objectModel.ts`) se extiende con `'urbanizacion' | 'georreferenciado' | 'rotonda' | 'vert_geo'`, sumándose a los ya existentes (`lote`, `manzana`, `calle`, `equipamiento`, `area_verde`, `linea`, `texto`, `cota` — estos últimos dos se mantienen disponibles para las herramientas de texto/cota, fuera del catálogo "sugerido" pero seleccionables igual).

`geometryIconForKind` / `geometryLabelForKind` (`LayerPanel.tsx`) y `LAYER_KIND_ICONS` equivalentes se actualizan para los 4 kinds nuevos.

#### 3.2.2 Resolver único y obligatorio: `requireLayerForKind()`

Se reemplaza el par actual `pickLayerForKind()` (opcional, con bypasses) por una función que **siempre resuelve a un `layerId` válido o aborta la operación**:

```
requireLayerForKind(kind, { suggestedName, suggestedColor, geometryType }): Promise<string | null>
```

- Si hay capas existentes cuyo `kind` matchea → el modal las lista primero (comportamiento actual, se conserva).
- Si el usuario elige "Crear capa nueva" (o si **no hay ninguna capa todavía**, el modal abre directo en modo creación) → formulario prellenado con la entrada del catálogo de sugerencias correspondiente a `kind`, editable antes de confirmar.
- **Se elimina**: el interruptor global `askEnabled`, el "no preguntar de nuevo" silencioso, y el botón "Cancelar (usar capa activa)".
- **Cancelar** pasa a significar _"abortar la creación de la entidad"_: si el usuario cierra el modal sin elegir/crear, la geometría recién dibujada **no se persiste** (se revierte el `Draw` de OpenLayers / no se ejecuta el `Command`). Esto es coherente con el "SI O SI" del requisito: no puede quedar geometría sin capa.
- Unificación de UI: `LayerPickerModal.tsx` y `AddLayerModal.tsx` se fusionan en un único componente (`LayerResolverModal.tsx`) con dos pestañas: **"Elegir existente"** / **"Crear nueva"**.

#### 3.2.3 Integración por acción

| Acción                                                                                                               | Cambio necesario                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PolygonMode.ts`, `LineMode.ts`, `RectangleMode.ts`                                                                  | Reemplazar `pickLayerForKind` → `requireLayerForKind`. Bajo esfuerzo, la llamada ya está en el lugar correcto (`drawend`).                                                                                                                                    |
| `StreetMode.ts`                                                                                                      | Ídem, más pasar el `layerId` resultante a `AddStreetCommand` (el parámetro ya existe en el constructor).                                                                                                                                                      |
| `RoundaboutMode.ts` / `AddRoundaboutCommand` / `roundaboutStore.ts`                                                  | **Nuevo trabajo:** agregar `layerId?: string` a `RoundaboutParams`/`Roundabout`; llamar `requireLayerForKind('rotonda', …)` en `onComplete` antes de `runCommand(new AddRoundaboutCommand(...))`; propagar `layerId` a `addRoundabout`/`addRoundaboutWithId`. |
| `LotParamsCard` → `useManzanoActions.handleGenerarTodos` → `GenerateLotsCommand`                                     | Preguntar la capa **una sola vez por acción** (no por lote generado) antes de ejecutar el comando; agregar `layerId?` a `GenerateLotsOpts` y usarlo en `resolveLayerId(this.opts.layerId, 'lote')` dentro de `applyChunkResults`.                             |
| `ManzanoCard` (botones de método / "↺ Regenerar") → `useManzanoActions.runRecompute` → `RecomputeManzanoLotsCommand` | Mismo patrón: `layerId?` en `RecomputeManzanoLotsOpts`.                                                                                                                                                                                                       |
| `SubdivisionDialog` "Aplicar" → `SubdivideCommand`                                                                   | Mismo patrón: agregar `layerId?` a `SubdivideCommandOpts`, preguntar antes de `runCommand`.                                                                                                                                                                   |
| **Generar vértices** (nueva)                                                                                         | Ver 3.2.4.                                                                                                                                                                                                                                                    |

**Regla de granularidad:** cuando una sola acción del usuario genera N features (ej. "Generar todos los lotes" puede crear cientos de lotes), se pregunta **una vez por acción**, no una vez por feature — la capa resultante aplica a todo el lote de features creado en esa ejecución.

#### 3.2.4 Nueva función: "Generar vértices"

No existe en el código actual; se especifica desde cero:

- **Entrada:** capa(s) actualmente seleccionada(s) en `LayerPanel` (o, si no hay selección de capa, las features actualmente seleccionadas en el mapa vía `selectionStore`).
- **Lógica:** recorrer los polígonos/líneas de las features de la(s) capa(s) origen, extraer cada vértice único, crear un `Feature<Point>` por vértice con `kind: 'vert_geo'`.
- **Salida:** al igual que el resto de acciones generadoras, dispara `requireLayerForKind('vert_geo', …)` **una vez** antes de crear los puntos, con "Vert_Geo" como sugerencia prellenada.
- **Comando:** `GenerateVerticesCommand` (nuevo, en `src/commands/features/`), undoable como el resto (`Command` base ya provee el contrato).
- **UI:** nuevo botón en el ribbon (Tab "Editar" o "Insertar"), habilitado solo si hay una capa/selección de origen válida.

#### 3.2.5 Urbanización / Georreferenciado: decisión de producto

Hoy no son features editables — son un contorno (envolvente convexa) que `BoundaryPainter` calcula en cada frame a partir de los manzanos/lotes existentes, puramente visual. Si se quiere que el usuario pueda **dibujar y asignar manualmente** un polígono a la capa "Urbanización" o "Georreferenciado" (como pide el catálogo sugerido), hace falta:

- Permitir que la herramienta de polígono genérica ofrezca estos dos `kind` nuevos como destino (ya cubierto por el resolver del punto 3.2.2, una vez extendido el enum).
- Decidir si el overlay automático de `BoundaryPainter` se **desactiva** cuando ya existen features reales en la capa `urbanizacion`/`georreferenciado` (para no duplicar visualmente el contorno automático con el dibujado a mano), o si conviven como capas independientes. Se recomienda la primera opción: si la capa tiene features propias, se prioriza su render real por sobre el cálculo automático de envolvente.

---

### 3.3 Bloque C — Simplificación de herramientas del panel (Requisito 3)

En `src/components/panels/LayerPanel.tsx`:

1. **Quitar arrastre:**
   - Eliminar el `<span draggable ...><IconGrip /></span>` de `LayerRow`.
   - Eliminar `onDragOver`/`onDragLeave`/`onDrop` del contenedor de fila en `renderRow`.
   - Eliminar el estado `dragId`/`dropTarget` y la función `handleDrop` de `LayerPanel`.
   - **Se conservan** los botones ↑/↓ (`IconChevronSmall` + `moveLayer`) como único mecanismo de reordenamiento: ya usan el mismo comando (`ReorderLayersCommand`), ya son accesibles por teclado, y su remoción no estaba pedida — quitar _solo_ el arrastre cumple la letra del requisito sin perder la función de reordenar.
2. **Quitar el número de opacidad:**
   - En `OpacitySlider`, eliminar el `<span>{Math.round(value * 100)}%</span>`.
   - Para no perder accesibilidad (el número era el único indicador legible del valor para lectores de pantalla), agregar `aria-valuetext={`${Math.round(value*100)}%`}` y/o `title` en el propio `<input type="range">`, que no se renderiza visualmente pero sigue siendo anunciado por tecnologías asistivas.
3. Ajustar `NON_REMOVABLE` (ver H11 / sección 3.4): al no haber capas de fábrica, este set hardcodeado de ids ya no aplica — reemplazar por una regla dinámica (ver abajo).

---

### 3.4 Consideraciones transversales

- **`NON_REMOVABLE` (LayerPanel.tsx):** hoy protege por id (`lots`, `manzanas`, `streets`, `equipment`, `greenareas`) contra borrado. Al eliminarse las capas de fábrica, esos ids dejan de existir. Reemplazar por una política basada en uso real: cualquier capa es removible, pero `LayerDeleteModal` (ya existente) sigue exigiendo decidir qué pasa con las features asociadas (mover o borrar) antes de confirmar — no se necesita ninguna protección especial por id.
- **Manzanos generados automáticamente al cortar una vía** (`recomputeManzanos.ts`, función interna `recomputeManzanosImmediate`): esto **no es una acción de dibujo directa del usuario** sino un efecto derivado (recortar una parcela existente contra la red vial). Preguntar la capa en cada recompute sería disruptivo, porque corre en un debounce automático cada vez que se edita una calle. Recomendación: el manzano derivado **hereda el `layerId`** de la parcela/manzano original que le dio origen (ya existe un mecanismo de "grupo de origen", `origParcelId`/`origPts`), y solo se pregunta si esa parcela de origen no tenía capa asignada (caso borde, no debería ocurrir una vez aplicado el Bloque B).
- **Capa activa (`activeLayerId`):** con la pregunta ahora obligatoria, su rol cambia de "asignación silenciosa por defecto" a **preselección conveniente** dentro del modal (para reducir clics), nunca un bypass total.
- **Import/Export:** validar con proyectos `.geourban` guardados con el esquema viejo (5 capas de fábrica) que el flujo de apertura siga funcionando — `reconcileOrphanFeatures` ya cubre el caso de `layerId` no resoluble.
- **Conteo de features por capa** (`computeLayerFeatureCounts`, en `geo/selectors/layerStats.ts`): hoy solo recorre `drawSource`. Una vez que Calles/Rotondas tengan `layerId`, esta función debe sumar también `streetStore.streets` y `roundaboutStore.roundabouts` agrupados por su `layerId`, para que el badge numérico en el panel sea correcto para esas capas.

---

## 4. Roadmap propuesto (por fases)

| Fase                                          | Contenido                                                                                                                                                                                                                                                      | Alcance                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Fase 1 — Fundacional**                      | Vaciar `DEFAULT_LAYERS`; `layersRegistryStore` y `createEmptyProject` inician en `[]`; extender `GeoUrbanFeatureKind` con `urbanizacion`, `georreferenciado`, `rotonda`, `vert_geo`; crear catálogo estático de sugerencias (nombre/color/geometría por kind). | Bajo riesgo, alto impacto en Requisito 1                                                |
| **Fase 2 — Resolver unificado**               | Fusionar `LayerPickerModal` + `AddLayerModal` → `LayerResolverModal` con pestañas Elegir/Crear; implementar `requireLayerForKind()`; eliminar `askEnabled`, "no preguntar de nuevo" y "Cancelar = capa activa".                                                | Habilita el Requisito 2                                                                 |
| **Fase 3 — Integración por entidad**          | Cablear Polygon/Line/Rectangle/Street (bajo esfuerzo); Rotonda (esfuerzo medio: `layerId` en modelo + store); GenerateLots/RecomputeManzanoLots/Subdivide (threading de `layerId` en cada comando); nueva `GenerateVerticesCommand` + UI.                      | Cierra el Requisito 2 completo                                                          |
| **Fase 4 — Render por capa de Vías/Rotondas** | `StreetPainter` y `RoundaboutPainter` resuelven estilo/visibilidad por `layerId` individual en vez de por kind compartido; `computeLayerFeatureCounts` suma calles/rotondas.                                                                                   | Necesario para que "Vías" y "Rotonda" sean capas realmente independientes, no cosmético |
| **Fase 5 — Panel de capas**                   | Quitar drag & drop (conservar ↑/↓); quitar número de opacidad (agregar `aria-valuetext`); reemplazar `NON_REMOVABLE` hardcodeado por regla dinámica.                                                                                                           | Requisito 3                                                                             |
| **Fase 6 — QA / regresión**                   | Proyecto nuevo en cero; apertura de proyectos `.geourban` viejos; cancelar creación de entidad sin capa (debe abortar, no crear huérfano); generación masiva de lotes con un solo prompt; import/export round-trip de las 4 capas nuevas.                      | Cierre                                                                                  |

---

## 5. Recomendaciones profesionales adicionales

1. **No auto-sembrar el catálogo sugerido.** El catálogo de 9 capas debe usarse _solo_ para prellenar el formulario de creación (nombre, color, geometría) — nunca crearse automáticamente al abrir un proyecto nuevo, o se vuelve a violar el Requisito 1 por la puerta de atrás.
2. **Plantilla opcional, explícita y separada.** Si a futuro se quiere ofrecer un atajo tipo "crear las 9 capas sugeridas de una vez", que sea un botón explícito dentro de `ProjectSetupModal` (acción deliberada del usuario), nunca un comportamiento por defecto.
3. **Paleta de colores sin colisión.** El panel ya tiene una advertencia visual (`colorDuplicated`) para colores repetidos entre capas — reutilizarla al prellenar colores del catálogo sugerido, evitando que "Manzano" y "Rotonda" nazcan con el mismo color por casualidad.
4. **"Sin capa" (`UNASSIGNED_LAYER_ID`) se mantiene exclusivamente como red de seguridad para datos importados**, nunca como destino válido de una entidad nueva dibujada por el usuario — el resolver obligatorio (`requireLayerForKind`) nunca debe poder resolver a esta capa.
5. **Accesibilidad al recortar UI.** Al quitar el drag & drop, dejar visible en tooltip que ↑/↓ reordenan; al quitar el número de opacidad, compensar con `aria-valuetext` en el slider — ambos cambios son de UI, pero no deberían degradar a usuarios de teclado/lector de pantalla que ya estaban contemplados en el diseño actual (`cad-a11y-btn`, roving focus, etc.).
6. **Telemetría liviana (opcional, a futuro).** Registrar qué capa sugerida elige más el usuario por tipo de entidad, para eventualmente afinar el orden/preselección del catálogo — no bloqueante para este plan.

---

## 6. Checklist técnico resumido (archivo → cambio)

| Archivo                                                                                                                            | Cambio                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/core/objectModel.ts`                                                                                                          | `DEFAULT_LAYERS = []`; extender `GeoUrbanFeatureKind`; nuevo catálogo `LAYER_SUGGESTIONS`                 |
| `src/store/entities/layersRegistryStore.ts`                                                                                        | Estado inicial `layers: []`; revisar `resetToDefaults()`                                                  |
| `src/io/types.ts`                                                                                                                  | `createEmptyProject()` con `layers: []`                                                                   |
| `src/store/ui/layerPickerStore.ts`                                                                                                 | Eliminar `askEnabled`/remembered-silent; nueva API `requireLayerForKind`                                  |
| `src/components/modals/LayerPickerModal.tsx` + `AddLayerModal.tsx`                                                                 | Fusionar en `LayerResolverModal.tsx` (pestañas Elegir/Crear)                                              |
| `src/map/scene/modes/PolygonMode.ts`, `LineMode.ts`, `RectangleMode.ts`, `StreetMode.ts`                                           | Swap `pickLayerForKind` → `requireLayerForKind`                                                           |
| `src/map/scene/modes/RoundaboutMode.ts`                                                                                            | Llamar `requireLayerForKind('rotonda', …)` antes de `AddRoundaboutCommand`                                |
| `src/store/entities/roundaboutStore.ts`                                                                                            | Agregar `layerId?` a `Roundabout`/`RoundaboutParams`; propagar en `addRoundabout`/`addRoundaboutWithId`   |
| `src/map/scene/painters/RoundaboutPainter.ts`                                                                                      | Resolver estilo/visibilidad por `layerId` de cada rotonda                                                 |
| `src/map/scene/painters/StreetPainter.ts`                                                                                          | Resolver estilo/visibilidad por `layerId` de cada calle                                                   |
| `src/commands/lots/GenerateLotsCommand.ts`                                                                                         | `layerId?` en `GenerateLotsOpts`, usar en `resolveLayerId`                                                |
| `src/commands/lots/RecomputeManzanoLotsCommand.ts`                                                                                 | `layerId?` en `RecomputeManzanoLotsOpts`                                                                  |
| `src/commands/lots/SubdivideCommand.ts`                                                                                            | `layerId?` en `SubdivideCommandOpts`                                                                      |
| `src/hooks/useManzanoActions.ts`, `src/components/modals/SubdivisionDialog.tsx`, `src/components/panels/manzano/LotParamsCard.tsx` | Disparar `requireLayerForKind` antes de ejecutar el comando correspondiente                               |
| `src/commands/features/GenerateVerticesCommand.ts` _(nuevo)_                                                                       | Comando de generación de vértices                                                                         |
| UI ribbon (Edit/Insert tab)                                                                                                        | Nuevo botón "Generar vértices"                                                                            |
| `src/geo/selectors/layerStats.ts`                                                                                                  | `computeLayerFeatureCounts` debe sumar `streetStore`/`roundaboutStore`                                    |
| `src/components/panels/LayerPanel.tsx`                                                                                             | Quitar drag & drop (conservar ↑/↓); quitar `%` de `OpacitySlider`; reemplazar `NON_REMOVABLE` hardcodeado |
