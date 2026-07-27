# Diagnóstico profesional y plan de mejora — Sistema de Capas (LayerPanel)

**Alcance auditado:** `src/components/panels/LayerPanel.tsx`, `src/store/entities/layersRegistryStore.ts`, `src/store/ui/displayLayersStore.ts`, `src/core/objectModel.ts` (tipo `Layer`), `src/map/scene/DrawLayerRenderer.ts`, `src/map/Map.tsx` (wiring de capas al mapa), `src/store/ui/layerPickerStore.ts`, `src/components/modals/LayerPickerModal.tsx`, y los consumidores indirectos (`StreetPainter`, `RoundaboutPainter`, `BoundaryPainter`, `VertexPainter`, `useKeyboardShortcuts`, comandos de features).

**Método:** lectura estática del código fuente actual, trazado de cada flag de estado (`visible`, `locked`, `opacity`, `showLabel`, `showCota`, `kind`, `zIndex`) desde su origen en el store hasta su(s) consumidor(es) real(es) en el pipeline de render, y verificación de si existe UI para cada capacidad ya modelada en el store.

---

## 1. Arquitectura actual (resumen)

Hoy conviven **cuatro fuentes de verdad** distintas que un usuario esperaría que fueran "una sola capa":

| Sistema | Store | Qué controla realmente | Expuesto en LayerPanel |
|---|---|---|---|
| Registro de capas de features | `layersRegistryStore` (`layers[]`) | color/opacity/showLabel/showCota de **polígonos WebGL** (lotes, manzanos, equipamiento, área verde) + color de trazo de calles (solo color, no visibilidad real) | Sí |
| Overlays calculados | `displayLayersStore` (`overlays.urbanizacion/georreferenciado/vertices`) | Envolvente convexa, coordenadas de vértices, etiquetas de vértice | Sí (mezclado en la misma lista) |
| Vías (postrender) | `streetStore.visible` | Visibilidad **real** de calzada/vereda/eje/etiquetas de calle (`StreetPainter`) | **No** |
| Rotondas (postrender) | `roundaboutStore.visible` | Visibilidad **real** de rotondas (`RoundaboutPainter`) | **No** |
| Cotas globales (ribbon Vista) | `uiShellStore.measurementsVisible` | Nada (no lo lee ningún painter) | No aplica (ribbon, no panel) |

Este desacople entre "lo que el panel de capas dice que controla" y "lo que realmente se pinta" es la raíz de la mayoría de los hallazgos críticos.

---

## 2. Diagnóstico detallado

### 2.1 Persistencia — la configuración de capas no sobrevive a guardar/reabrir

- `useTopBarActions.ts::getCurrentProject()` arma el `GeoUrbanProject` a partir de `writeProjectFromOlFeatures()` + `baseMap` + `view` + `crs`, pero **nunca** vuelca `useLayersStore.getState().layers` al campo `project.layers` (que existe en `io/types.ts::GeoUrbanProject`, tipado como `GeoUrbanLayerMeta[]`, y ya ni siquiera coincide con la forma real de `Layer` en `core/objectModel.ts`: le faltan `color`, `fillColor`, `opacity`, `locked`, `showLabel`, `showCota`, `zIndex`).
- Tampoco existe código de **carga**: ni `handleImport` ni `handleProjectOpen` en `useTopBarActions.ts` llaman a `useLayersStore.getState()` para restaurar capas.
- Consecuencia: nombres de capa personalizados, colores, opacidades, bloqueos y capas custom creadas por el usuario **se pierden en cada recarga/reapertura de proyecto**, aunque el proyecto se guarde "exitosamente". El autosave (`io/persistence.ts`) tiene el mismo problema porque usa el mismo `getCurrentProject()`.
- Cada feature sí persiste su propio `layerId` (viaja como propiedad GeoJSON). Al reabrir un proyecto con capas custom, esos `layerId` **no resuelven a ninguna capa real** (el registro vuelve a las 5 capas por defecto) → features huérfanas silenciosas, estilizadas por el fallback genérico sin aviso alguno al usuario.

**Severidad: Crítica.**

### 2.2 Toggles de visibilidad "muertos" (no hacen lo que el usuario espera)

- **"Viales" en LayerPanel / botón "Calles" del ribbon (`ViewTab.tsx`)** llaman a `toggleVisibility('streets')` / `toggleKindsVisibility(['calle'])` sobre `layersRegistryStore`. En `Map.tsx`, el único efecto de ese flag es `streetLayerRef.current.setVisible(...)`, pero `streetLayerRef` es la capa de **sketch** vacía de `ol/interaction/Draw` (nunca contiene las calles renderizadas). Las calles reales se pintan en el postrender por `StreetPainter`, que consulta **exclusivamente** `useStreetStore.getState().visible` — un flag totalmente distinto que **ninguna UI expone** hoy. Resultado: destildar "Viales" en el panel de capas no oculta ni una sola calle en el mapa.
- **"Cotas" del ribbon Vista** (`uiShellStore.measurementsVisible`) no es leído por `LabelPainter`, `BoundaryPainter` ni `StreetPainter` — todos ellos gatean las cotas por `layer.showCota` / `overlay.showCota` de otros stores. El toggle es 100% decorativo.
- **Rotondas** (`roundaboutStore.visible`) no tiene **ningún** control en la interfaz (ni en LayerPanel, ni en el ribbon, ni en `RoundaboutPanel.tsx`, que solo controla la visibilidad del *panel*, no de la geometría). El flag existe en el store pero es efectivamente inmutable desde la UI.

**Severidad: Crítica** (rompe la confianza básica en el panel: "lo que veo en la lista de capas no gobierna lo que veo en el mapa").

### 2.3 Sin integración con el sistema de Undo/Redo

Todo el resto de la aplicación pasa mutaciones relevantes por `CommandStack` (`commands/core/CommandStack.ts`) para soportar Ctrl+Z/Ctrl+Y. El CRUD de capas (`add`, `remove`, `update`, `reorder`, `toggleLock`, `toggleVisibility`) es un store de Zustand plano invocado directo desde `LayerPanel.tsx`, sin pasar por ningún `Command`. Efectos:
- Eliminar una capa (con o sin features dentro) **no es reversible** con Ctrl+Z, rompiendo la expectativa que el resto del programa entrena en el usuario.
- Cambios de color/opacidad tampoco entran al historial (aceptable para algunos casos, pero inconsistente si el resto de "propiedades de feature" sí lo hace vía `ModifyGeometryCommand`).

**Severidad: Alta.**

### 2.4 Eliminación de capa sin salvaguardas

`LayerPanel.tsx::LayerRow` conecta el ícono de papelera directo a `removeLayer(l.id)` (ver `useRegistryRows()`), sin:
- Confirmación (`window.confirm` u otro modal), a diferencia de `ProjectBrowserModal.handleDelete` que sí confirma.
- Conteo/aviso de cuántos features quedarán huérfanos (`layerId` apuntando a una capa que ya no existe).
- Reasignación automática u ofrecida (mover features a otra capa antes de borrar).

**Severidad: Alta.**

### 2.5 `kind` de capa: tipado débil y flujo de creación roto

- `Layer.kind` es `string` libre (`core/objectModel.ts`), no `GeoUrbanFeatureKind` — sin chequeo de tipos ni de valores válidos.
- `LayerPanel.tsx::handleAddLayer()` crea toda capa nueva con `kind: 'lote'` **hardcodeado**; no hay ningún selector de tipo en el flujo de "Nueva capa". Esto rompe silenciosamente:
  - `resolveLayerId()`/`getLayerForKind()` (usados por `AddFeatureCommand`, `recomputeManzanos.ts`) para asignar automáticamente capa por tipo de feature.
  - Los toggles "Lotes"/"Calles" del ribbon (`ViewTab.tsx::toggleKindsVisibility`), que agrupan por `kind` de capa, no por `kind` real del feature.
- Además, `LayerPickerModal.tsx` permite al usuario asignar **cualquier** feature a **cualquier** capa (ordenadas solo por sugerencia, sin restricción), por lo que `layer.kind` puede terminar sin relación real con lo que la capa contiene. El sistema no tiene forma de detectar ni corregir esta divergencia.

**Severidad: Alta.**

### 2.6 Conflicto de color: paleta por capa vs. paleta por `colorIdx`

- `DrawLayerRenderer.ts::buildWebglStyle()` estiliza el relleno/trazo de un feature por **match de `layerId`** contra la lista de capas — es decir, todos los manzanos asignados a la capa "Manzanos" comparten el mismo color plano de capa.
- Pero `LabelPainter.ts`, `VertexPainter` (indirectamente) y `StatsPanel.tsx` calculan y muestran color **por manzano individual** vía `colorIdx % MZN_COLORS_STR.length` (paleta arcoíris).
- Como `recomputeManzanos.ts` asigna `layerId` a **todo** manzano nuevo (`resolveManzanaLayerId()`), el camino de fallback por `colorIdx` en `buildWebglStyle` (pensado para features sin `layerId`) casi nunca se ejecuta en la práctica. Resultado: el relleno del polígono en el mapa es de **un solo color uniforme**, mientras que su etiqueta ("Mzo. 3") y la leyenda del panel de estadísticas (`StatsPanel.tsx`) muestran un color **distinto y variable por manzano**. Son dos sistemas de color que no fueron reconciliados.

**Severidad: Alta** (defecto visual "profesionalmente" visible de inmediato).

### 2.7 `zIndex` sin efecto real / reordenamiento no expuesto

- `Layer.zIndex` existe y se recalcula en `add`/`update`/`reorder` de `layersRegistryStore`, pero el render de lotes/manzanos/equipamiento/área verde es **una sola capa WebGL** (`WebGLVectorLayer` con un único `VectorSource`, ver `DrawLayerRenderer.ts`) — el orden de dibujo real depende del motor WebGL/orden de inserción de features, no de `layer.zIndex`. Cambiar el "orden" de una capa en el store no reordena visualmente nada.
- Peor aún: `reorder(ids, position)` está completamente implementado en el store pero **`LayerPanel.tsx` nunca lo invoca** — no hay drag&drop, ni botones "subir/bajar". Es código muerto que promete una funcionalidad (reordenar capas) que ni siquiera tendría efecto visual si se conectara, dado el punto anterior.

**Severidad: Media-Alta** (expectativa GIS/CAD estándar — "el orden en el panel es el orden de dibujo" — incumplida en ambos extremos: falta UI y falta efecto real).

### 2.8 Bloqueo (`locked`) inconsistente con "capa activa"

- `locked` correctamente impide seleccionar (`SelectEditMode.ts` filter), borrar (`DeleteFeaturesCommand`) y seleccionar-todo (`useKeyboardShortcuts.ts` Ctrl+A) features de esa capa. **Esto está bien implementado.**
- Pero `resolveLayerId()` (`AddFeatureCommand.ts`) **no verifica `locked`**: si una capa bloqueada es la `activeLayerId` o la única capa que matchea un `kind`, los nuevos trazos se siguen agregando ahí — features que quedan inmediatamente inseleccionables/imborrables sin que el usuario entienda por qué "no puede tocar lo que acaba de dibujar".
- No hay ninguna advertencia visual en LayerPanel cuando la capa activa está bloqueada, ni el propio botón "activar capa" impide elegir una locked.

**Severidad: Media.**

### 2.9 Interfaz — hallazgos de UX

- **Sin conteo de features por capa** (estándar en QGIS/ArcGIS/AutoCAD). El usuario no sabe si "Área verde" tiene 0 o 200 elementos sin ir a buscarlos.
- **Sin "aislar" (solo) capa** ni **"zoom a extensión de capa"** — funciones básicas de cualquier panel de capas profesional.
- **Sin duplicar capa** ni **mover features en bloque entre capas**.
- **Overlays computados (Urbanización/Georreferenciado/Vértices) mezclados sin distinción visual** con capas reales de datos en una sola lista plana (`allRows = [...registryRows, ...overlayRows]`), sin encabezados de sección ni iconografía diferenciada — conceptualmente son cosas muy distintas (una es geometría editable con features propios; la otra es un cálculo derivado, no seleccionable, no editable) y se presentan idénticas.
- **Sin iconografía por tipo de geometría** (polígono/línea/punto) en cada fila — todas las filas lucen igual salvo el swatch de color.
- **Slider de opacidad sin valor numérico visible** (0–1 sin `%` ni tooltip con el valor).
- **Sin aviso de color duplicado** entre capas (fácil terminar con dos capas visualmente indistinguibles).
- **El panel no usa `useViewportWidth`** (a diferencia de `RoundaboutPanel`, `StreetPanel`, `ManzanoPanel`) — en viewports angostos, `minWidth: 250` fijo puede desbordar.
- **Estado de apertura/expansión no persistido** (se resetea a "abierto/expandido" en cada recarga, sin `zustand/persist` como sí tienen `snapSettingsStore` o `roadCornerStore`).
- **Botón "Nueva capa" no pregunta tipo ni color inicial coherente** — usa `nextColor()` que evita colisión de color entre capas del registro, pero no contra los colores de los overlays.
- **Clic para "activar capa"** solo funciona sobre filas del registro (`registryRows.some(...)`) pero visualmente las filas de overlay no se distinguen como "no clickeables" (mismo cursor, mismo hover implícito).

**Severidad: Media (conjunto que degrada mucho la percepción de "herramienta profesional").**

### 2.10 Accesibilidad

- Los controles de visibilidad (`IconEye`), bloqueo (`IconLock`) y borrado (`IconTrash`) son `<span onClick>`, no `<button>`: sin foco de teclado, sin `role`, sin `aria-pressed`/`aria-label`, sin activación por Enter/Espacio. Un usuario de teclado o lector de pantalla no puede operar el panel de capas en absoluto.
- El input de color oculto (`ColorDot`) depende de un click en un `<span>` para abrir el selector nativo — mismo problema de accesibilidad.

**Severidad: Media.**

### 2.11 Rendimiento

- `LayerPanel` ya usa `useIncrementalRender` para la lista (mitiga montar cientos de filas de una vez) — **punto positivo**.
- Cada cambio de opacidad/color dispara un `set()` de Immer sobre **todo** el array `layers`, y aguas abajo `Map.tsx` reconstruye `buildWebglStyle(state.layers)` completo (una expresión `match` de N casos) en cada mutación — aceptable para decenas de capas, pero no escala bien a cientos (no hay memoización/diffing de la expresión de estilo).

**Severidad: Baja (hoy), Media si se habilitan capas custom masivas (Fase 5).**

---

## 3. Tabla resumen de hallazgos

| # | Hallazgo | Severidad | Archivos clave |
|---|---|---|---|
| 1 | Toggle "Viales" no oculta calles reales | Crítica | `LayerPanel.tsx`, `ViewTab.tsx`, `Map.tsx`, `StreetPainter.ts`, `streetStore.ts` |
| 2 | Toggle "Cotas" del ribbon no controla nada | Crítica | `uiShellStore.ts`, `ViewTab.tsx` |
| 3 | Rotondas sin control de visibilidad en la UI | Crítica | `roundaboutStore.ts` |
| 4 | Config. de capas no se guarda/restaura con el proyecto | Crítica | `useTopBarActions.ts`, `io/types.ts`, `io/persistence.ts` |
| 5 | CRUD de capas fuera del CommandStack (no undoable) | Alta | `LayerPanel.tsx`, `layersRegistryStore.ts` |
| 6 | Eliminar capa sin confirmación ni manejo de huérfanos | Alta | `LayerPanel.tsx` |
| 7 | `kind` de capa hardcodeado a `'lote'` al crear; sin selector | Alta | `LayerPanel.tsx::handleAddLayer` |
| 8 | Color de relleno de manzanos (capa) vs. `colorIdx` (labels/stats) inconsistente | Alta | `DrawLayerRenderer.ts`, `LabelPainter.ts`, `StatsPanel.tsx` |
| 9 | `zIndex`/reordenamiento sin efecto real y sin UI | Media-Alta | `layersRegistryStore.ts`, `DrawLayerRenderer.ts`, `LayerPanel.tsx` |
| 10 | Capa activa puede estar bloqueada sin aviso | Media | `AddFeatureCommand.ts::resolveLayerId` |
| 11 | Falta conteo de features, aislar capa, zoom a capa, duplicar | Media | `LayerPanel.tsx` |
| 12 | Overlays y capas de datos mezclados sin distinción | Media | `LayerPanel.tsx` |
| 13 | Accesibilidad (spans no focuseables) | Media | `LayerPanel.tsx` |
| 14 | Panel no responsivo (`useViewportWidth` ausente) | Baja | `LayerPanel.tsx` |
| 15 | Estado de UI del panel no persistido | Baja | `LayerPanel.tsx` |
| 16 | Slider de opacidad sin lectura numérica | Baja | `LayerPanel.tsx` |

---

## 4. Plan de mejora por fases

> Principio rector: cada fase deja el sistema **completo y consistente** (nada a medio romper), priorizando primero credibilidad funcional (que lo que se ve en el panel sea la verdad de lo que se ve en el mapa), luego seguridad de datos (persistencia/undo), luego experiencia profesional, y por último capacidades avanzadas.

### Fase 1 — Verdad única de visibilidad (bugs críticos)
**Objetivo:** que cada toggle del panel de capas controle exactamente lo que dice controlar.

- Unificar la visibilidad de vías: eliminar el flag paralelo `streetStore.visible` (o hacerlo derivado) y que `StreetPainter` lea `layersRegistryStore.getLayerForKind('calle')?.visible`. Igual para el color/opacity (ya conectado) para que sea una sola fuente.
- Agregar una capa registrada de tipo `'rotonda'` (o reutilizar `'calle'`) y conectar `roundaboutStore.visible` (o eliminarlo) al mismo mecanismo, con su fila en `LayerPanel`.
- Eliminar `uiShellStore.measurementsVisible` (dead state) o conectarlo realmente como "master switch" de cotas que multiplique la opacidad de cotas en `LabelPainter`/`BoundaryPainter`/`StreetPainter`, documentando la relación con `layer.showCota` (¿es AND lógico global vs. por capa, al estilo del "F3" de snap?).
- QA manual: matriz de verificación "toggle → efecto visual" para cada fila del panel y cada botón del ribbon Vista.

**DoD:** ningún checkbox/eye-icon del panel de capas ni del ribbon "Vista" puede quedar sin efecto visible comprobado en el mapa.

### Fase 2 — Persistencia e integridad de datos
**Objetivo:** que la configuración de capas sea parte real del proyecto y sobreviva guardado/recarga/import/export.

- Extender `io/types.ts::GeoUrbanLayerMeta` para reflejar 1:1 el `Layer` de `core/objectModel.ts` (o reutilizar el tipo directamente).
- `getCurrentProject()` (`useTopBarActions.ts`) debe volcar `useLayersStore.getState().layers` + `activeLayerId` a `project.layers`.
- `handleImport`/`handleProjectOpen`/autosave-load deben restaurar el registro de capas (con migración: si el proyecto no trae `layers`, sembrar las 5 por defecto — mismo criterio que la migración Dexie v1→v2).
- Reconciliación de huérfanos: al cargar un proyecto, cualquier `layerId` de feature sin capa correspondiente debe reasignarse a una capa de fallback visible (ej. "Sin capa") creada automáticamente, en vez de fallar en silencio con estilos genéricos.
- Al eliminar una capa desde el panel: modal de confirmación mostrando conteo de features afectadas, con opción "mover a otra capa" o "eliminar features también" (delegando a `DeleteFeaturesCommand`).

**DoD:** cerrar y reabrir (o exportar/reimportar `.geourban`) un proyecto con capas personalizadas conserva nombres, colores, opacidades, bloqueos y visibilidad exactamente como se dejaron.

### Fase 3 — Integración con Undo/Redo
**Objetivo:** todo cambio estructural de capas es reversible, consistente con el resto de la app.

- Crear comandos: `AddLayerCommand`, `RemoveLayerCommand` (con snapshot de features reasignadas/huérfanas), `UpdateLayerCommand` (color/opacity/nombre/kind), `ReorderLayersCommand`.
- `LayerPanel.tsx` deja de llamar directo al store; pasa por `runCommand(...)`.
- Definir política de *coalescing* para updates continuos (drag del slider de opacidad, selector de color) igual que `ModifyGeometryCommand.coalesceInto` — evitar 50 entradas de historial por un solo arrastre de slider.

**DoD:** Ctrl+Z deshace creación/eliminación/renombrado/recoloreo/bloqueo de capas igual que cualquier otra acción del programa.

### Fase 4 — Consistencia del modelo `kind` y color
**Objetivo:** eliminar la divergencia entre el tipo declarado de una capa y lo que realmente contiene, y unificar los dos sistemas de color de manzanos.

- Tipar `Layer.kind` como `GeoUrbanFeatureKind` (reutilizando el enum de `core/objectModel.ts`), con validación en el store.
- "Nueva capa" pasa a ser un mini-formulario (modal o inline) que pide: nombre, **tipo** (select con los `GeoUrbanFeatureKind` conocidos + "Genérica/mixta"), color inicial.
- `LayerPickerModal.tsx` debe advertir (no necesariamente bloquear) cuando el usuario asigna un feature a una capa de `kind` distinto ("Estás por poner una calle en una capa de tipo Lote — ¿continuar?").
- Resolver el conflicto de color de manzanos: opción A) el color de capa se aplica solo si el usuario fija explícitamente un `fillColorMode: 'porCapa'`; por defecto los manzanos siguen usando `colorIdx` también en el relleno WebGL (agregar expresión `match` por `colorIdx` como comportamiento default real, no solo de fallback). Opción B) eliminar la paleta arcoíris y homologar todo a color de capa, ajustando labels/stats para no prometer variedad que no existe. **Recomendado: Opción A**, exponiendo el modo como toggle en la fila "Manzanos" del panel ("Colorear por manzano" vs "Color único de capa").

**DoD:** el color que un usuario ve en el mapa para un manzano coincide siempre con el que ve en su etiqueta y en `StatsPanel`, de forma configurable y explícita.

### Fase 5 — Orden de dibujo real y reordenamiento
**Objetivo:** que `zIndex`/orden en el panel tenga efecto visual verificable.

- Evaluar separar el `WebGLVectorLayer` único en N capas WebGL apiladas por `layer.zIndex` (una por capa de registro, con su propio `style`/`filter`), o — más económico — introducir un atributo de orden en el estilo WebGL que permita al motor priorizar el dibujo (si la versión de OL/WebGL lo soporta) o forzar orden vía z-index de capas OL reales apiladas.
- Implementar drag&drop de filas en `LayerPanel.tsx` (usar `reorder()` ya existente en el store) con indicador visual de posición de drop, más botones de accesibilidad "subir/bajar" como alternativa sin mouse.
- Las calles (postrender) y las capas WebGL deben coexistir en el mismo orden lógico (definir explícitamente si Vías siempre va sobre/bajo lotes-manzanos, documentado, o si se vuelve configurable).

**DoD:** subir una capa en el panel efectivamente la dibuja por encima de las que quedaron debajo, de forma visualmente comprobable con polígonos superpuestos.

### Fase 6 — Reglas de edición seguras
**Objetivo:** que "capa bloqueada" y "capa activa" nunca entren en conflicto silencioso.

- `resolveLayerId()`/`pickLayerForKind()` deben excluir o advertir sobre capas `locked` como destino de nuevas features.
- Si la `activeLayerId` se bloquea, la UI debe des-activarla automáticamente (o mostrar un badge de advertencia "capa activa bloqueada — los nuevos trazos no podrán editarse").
- Añadir en LayerPanel un indicador inequívoco de "capa activa" (no solo el leve resaltado de fondo actual): badge de texto o ícono dedicado + atajo rápido para cambiarla desde el ribbon.

**DoD:** es imposible terminar con un dibujo nuevo atrapado en una capa bloqueada sin que el usuario lo haya decidido conscientemente.

### Fase 7 — UX profesional GIS/CAD (paridad con QGIS/AutoCAD)
**Objetivo:** llevar el panel a estándar de herramienta profesional.

- Conteo de features por capa (badge numérico, ya hay precedente de badges en `ribbon-tool-badge`).
- "Aislar capa" (solo) / "Mostrar todas".
- "Zoom a extensión de la capa" (reutilizar lógica de `fitToExtent` filtrando por `layerId`).
- "Duplicar capa" y "Mover N features seleccionadas a otra capa" (acción disponible también desde `PropertyPanel`/selección múltiple).
- Separación visual clara en dos secciones del panel: **"Capas de datos"** (registro editable) vs **"Capas de referencia"** (overlays computados, no seleccionables, con icono distintivo tipo "🧮/Σ").
- Iconografía por tipo de geometría (polígono/línea/punto) en cada fila.
- Lectura numérica junto al slider de opacidad (`%`).
- Aviso visual (no bloqueante) de color duplicado entre capas al elegir uno nuevo.
- Persistir `open`/`expanded` del panel vía `zustand/persist` (mismo patrón que `snapSettingsStore`).
- Adoptar `useViewportWidth` para clamping responsivo, igual que el resto de paneles flotantes.

**DoD:** revisión de checklist UX punto por punto contra QGIS Layers Panel / AutoCAD Layer Manager como referencia informal.

### Fase 8 — Accesibilidad
**Objetivo:** el panel es operable 100% por teclado y compatible con lectores de pantalla.

- Reemplazar `<span onClick>` por `<button>` reales en visibilidad/bloqueo/borrado, con `aria-pressed`, `aria-label` descriptivo por capa ("Ocultar capa Lotes"), y foco visible.
- Navegación con flechas/Tab entre filas; Enter/Espacio para activar controles.
- Contraste verificado de textos secundarios (`--cad-text-muted` sobre `--cad-bg-surface`) contra WCAG AA.

**DoD:** auditoría con lector de pantalla (o axe-core) sin errores críticos en el panel.

### Fase 9 — Funcionalidad avanzada (opcional / roadmap largo)
**Objetivo:** capacidades de escala para proyectos grandes.

- Carpetas/grupos de capas (colapsables), útil si el número de capas custom crece.
- Mini tabla de atributos por capa (lista de features con sus propiedades clave: área, label, estado).
- Incorporar el **mapa base** como una entrada más (no editable/no removible) dentro del mismo panel unificado, en vez de vivir solo en `StatusBar`.
- Buscador/filtro de capas por nombre cuando la lista crece.
- Plantillas de capa (presets de color/estilo reutilizables al crear capas nuevas).

### Fase 10 — Rendimiento a escala y QA
**Objetivo:** sostener decenas/cientos de capas sin degradar el editor.

- Memoizar `buildWebglStyle`/`buildLayerFilter` por hash de `layers` (evitar reconstrucción de expresiones `match` completas en cada micro-cambio no relevante al estilo, ej. cambios de `showLabel` no deberían recomputar `fill-color`/`stroke-color`).
- Tests unitarios para `layersRegistryStore` (CRUD, reorder, toggling por kind) y para la reconciliación de huérfanos al importar/eliminar capas.
- Test de integración: crear proyecto con N capas custom → guardar → recargar → assert de igualdad profunda del registro.
- Test manual de regresión para la matriz de la Fase 1 (toggle → efecto) como checklist repetible en cada release.

---

## 5. Orden recomendado de ejecución

1. **Fase 1** (crítico, bug-fix puro, bajo riesgo, alto impacto de confianza).
2. **Fase 2** (persistencia — evita pérdida de datos del usuario, requisito previo para que valga la pena invertir en más configuración de capas).
3. **Fase 3** (Undo/Redo — barato una vez que el CRUD ya está estabilizado por la Fase 2).
4. **Fase 4** y **Fase 6** (consistencia de modelo y reglas de edición — pueden ir en paralelo).
5. **Fase 5** (orden de dibujo — es la más costosa técnicamente, por eso va después de estabilizar lo demás).
6. **Fase 7** y **Fase 8** (pulido UX/accesibilidad — mejor sobre una base de datos y comandos ya sólida).
7. **Fase 9** y **Fase 10** (roadmap largo / escala).

---

## 6. Riesgos y consideraciones de migración

- **Compatibilidad hacia atrás:** proyectos `.geourban` guardados antes de la Fase 2 no traerán `layers` válido — el loader debe tratar su ausencia como "usar defaults" sin romper, igual que Dexie ya migra `v1 → v2` en `io/projectStore.ts`.
- **Separar capas WebGL por `zIndex` (Fase 5)** puede tener costo de performance (N draw calls en vez de 1) — validar con proyectos grandes (miles de lotes) antes de generalizar; considerar agrupar solo cuando haya solapamiento real entre capas.
- **Cambiar el color de relleno de manzanos a `colorIdx` por defecto (Fase 4)** es un cambio visual perceptible para usuarios existentes — comunicarlo o dejarlo detrás de un toggle con el comportamiento actual como default inicial, migrando gradualmente.
- **Comandos de capas (Fase 3)** deben excluirse explícitamente del `MAX_STACK_BYTES`/poda agresiva si sus snapshots son livianos (a diferencia de `AddStreetCommand`, no deberían cargar snapshots completos de `drawSource`).
