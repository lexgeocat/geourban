# Diagnóstico técnico — GeoUrban (CAD/GIS editor)

**Alcance:** análisis estático de los ~95 archivos fuente compartidos (React + TS + OpenLayers + Zustand + Tauri + JSTS worker). No tengo `package.json`, `tsconfig`, lockfiles ni el repo completo, así que algunos hallazgos de "código muerto" están marcados como **candidatos a verificar con un grep global** antes de borrar nada. Todo lo demás (bugs de lógica) lo rastreé línea por línea siguiendo el flujo real de datos entre stores/commands/componentes, no son suposiciones sueltas.

Leyenda: 🔴 Crítico (rompe funcionalidad o pierde datos) · 🟠 Alto (bug real, impacto acotado) · 🟡 Medio (deuda técnica/arquitectura) · 🔵 Bajo (calidad/estilo/pulido)

---

## 0. Resumen ejecutivo

El proyecto tiene una arquitectura de carpetas razonable (`geo/`, `store/`, `map/`, `commands/`, `io/`) y algunas partes muy sólidas (manejo de zonas UTM dinámico, worker JSTS para booleanas, cache de fillets en `PostrenderPainter`). Pero hay **tres sistemas centrales que están rotos o a medio migrar**, no detalles menores:

1. **El undo/redo (Ctrl+Z) no deshace todo lo que aparenta deshacer**, y además corrompe su propio stack de "redo" en cada operación.
2. **El panel de Capas (colores, opacidad, visibilidad fina) es en gran parte decorativo**: no está conectado al renderer WebGL real.
3. **El "bloqueo de capa" (candado) no protege realmente los datos**: se puede seleccionar y borrar una capa "bloqueada" por al menos dos caminos distintos, y el comando de borrado no valida el candado en absoluto.

A esto se suma una exportación PNG rota, una exportación Shapefile incompleta, un archivo de tipos TypeScript mal formado, y bastante código muerto/duplicado. Detalle completo abajo.

---

## 1. 🔴 Bugs críticos (rotos de verdad)

### 1.1 Undo/Redo: el sistema real no es el que parece

Esto es lo más grave del proyecto y vale la pena explicarlo con precisión porque no es intuitivo.

- Cada `Command` (`ClearFeaturesCommand`, `AddFeatureCommand`, `ModifyGeometryCommand`, `SubdivideCommand`, `GenerateLotsCommand`, `AddStreetCommand`, `AddRoundaboutCommand`, etc.) implementa su propio `undo()`/`redo()`. Da la impresión de ser un patrón Command clásico con undo por comando.
- **Pero `useCommandStack.getState().undo()` / `.redo()` (los que disparan `Ctrl+Z`, `Ctrl+Y` y los botones de `StatusBar.tsx`) nunca llaman a `command.undo()`.** No existe ni un array/stack de comandos ejecutados en `CommandStack.ts` — solo `lastCommandLabel`, `lastCommandAt`, `canUndo`, `canRedo`.
- Lo que realmente pasa: `undo()`/`redo()` usan snapshots GeoJSON guardados en `historyStore.ts` (`pushState` serializa **solo** `drawSource.getFeatures()`) y los reaplica con `applyRestoredSnapshot()`.

**Consecuencia 1 — cosas que "no se deshacen":** todo lo que vive fuera de `drawSource` no está cubierto por el snapshot: `streetStore.streets`, `roundaboutStore.roundabouts`, `layersRegistryStore.layers`, `manzanoStore`. Ejemplo concreto: `AddStreetCommand.undo()` llama a `useStreetStore.getState().removeStreet(...)`, pero como el `undo()` global nunca invoca ese método, **trazar una calle y luego presionar Ctrl+Z deja la calle fantasma en `streetStore` para siempre** (se sigue dibujando, se sigue usando para recortar manzanos en el próximo `recomputeManzanos`), aunque el snapshot de features sí pueda revertir los lotes/manzanas generados. No vi ninguna UI para borrar una sola calle suelta (solo "Limpiar" todas), así que este es un callejón sin salida real para el usuario.
- Lo mismo aplica a rotondas (`AddRoundaboutCommand.undo()` nunca se ejecuta globalmente).

**Consecuencia 2 — el redo se autodestruye:** `applyRestoredSnapshot()` (llamado desde dentro de `undo()`/`redo()`) hace:
```js
commandStack.run(new ClearFeaturesCommand());
commandStack.run(new AddFeaturesCommand(features));
```
`run()` **siempre** termina llamando `historyStore.pushState(...)`, y `pushState` **siempre** hace `state.future = []`. O sea: en el mismo instante en que `hist.undo()` acaba de poblar correctamente `future` (para permitir un redo), el propio flujo de restauración dispara dos `run()` adicionales que vuelven a vaciar `future`. **Resultado: después de cualquier Undo, el Redo deja de estar disponible en la práctica**, y el `past` además crece con entradas espurias (clear vacío + add) en vez de una sola.

**Impacto:** en una herramienta tipo CAD, Ctrl+Z es el atajo más usado. Aquí es no confiable para calles/rotondas/capas, y rompe el redo multi-paso incluso para lo que sí cubre (polígonos/lotes).

**Sugerido:** decidir una sola estrategia. O (a) el snapshot cubre *todo* el estado relevante (features + streets + roundabouts + layers) serializado junto, o (b) se vuelve a un stack real de `Command` con `undo()/redo()` invocados de verdad y se elimina `historyStore`. Mezclar ambos, como está hoy, es lo que genera el bug. Además, `applyRestoredSnapshot` no debería pasar por `run()` (que reescribe historial) para aplicar un snapshot — debería mutar `drawSource` directamente.

### 1.2 Exportación a PNG: 100% rota

En `TopBar.tsx`:
```ts
const mapRef = useRef<Map | null>(null);
...
const handleExportPng = async () => {
  const map = mapRef.current;
  if (!map) throw new Error('Mapa no inicializado');
  ...
```
`mapRef.current` **nunca se asigna en ningún lugar del archivo.** La instancia real del mapa vive en `useMapStore.getState().mapInstance` (seteada por `Map.tsx` vía `useMapStore.getState().setMap(map)`), pero `TopBar.tsx` lee su propio ref local, desconectado, que siempre es `null`. Resultado: **toda exportación a PNG lanza "Mapa no inicializado" siempre**, sin excepción. Fix: reemplazar `mapRef.current` por `useMapStore.getState().mapInstance`.

### 1.3 Panel de "Capas" — color/opacidad no hacen nada; visibilidad es aproximada

`layersRegistryStore.ts` guarda `color`, `opacity`, `visible`, `locked` por capa, y `LayerPanel.tsx` ofrece selector de color y slider de opacidad por capa. Pero el renderer real (`DrawLayerRenderer.ts`, `webglLayer` de `ol/layer/WebGLVector`) usa un *style expression* fijo basado en `feature.get('colorIdx')` y `feature.get('type') === 'manzana'`, con una paleta hardcodeada (`MZN_COLORS_22`/`MZN_COLORS_STR`). **En ningún punto se lee `layer.color` ni `layer.opacity` del registro de capas.** Cambiar el color o la opacidad de una capa en el panel actualiza el store y no cambia un solo píxel en el mapa.

La visibilidad tampoco es granular: `Map.tsx` suscribe `layersRegistryStore` y calcula `anyLoteVisible = state.layers.some(l => (l.kind==='lote'||l.kind==='manzana') && l.visible)` — es decir, ocultar **una** capa de tipo "lote" entre varias no oculta esa capa específica, solo se oculta el conjunto completo de lotes/manzanas cuando **todas** están ocultas. El candado (`locked`) es el único atributo del registro que sí tiene efecto real (ver 1.4).

**Impacto:** el panel de capas transmite una promesa de control fino (nombre, color, opacidad, orden, visibilidad por capa) que en la práctica solo sirve para renombrar y (parcialmente) bloquear/ocultar por tipo. Esto hay que decidirlo explícitamente: o se conecta de verdad el color/opacidad al estilo WebGL leyendo `layerId` por feature, o se simplifica el panel para no prometer algo que no hace.

### 1.4 El candado de capa ("locked") no protege datos de forma consistente

Rastreado en 4 puntos de entrada a "seleccionar features":

| Camino | ¿Filtra `locked`? |
|---|---|
| Click simple en modo Select/Edit (`InteractionModeController`, `Select` con `filter: !isLayerLocked`) | ✅ Sí |
| Lasso / selección rectangular | ✅ Sí |
| **Ctrl+A "seleccionar todo"** (`useKeyboardShortcuts.ts`) | ❌ No — itera `drawSource` entero sin chequear `layerId`/`locked` |
| **Herramienta "Borrar" (Erase, tecla E)** (`InteractionModeController`, modo `erase`) | ❌ No — el `Select` de ese modo no tiene `filter` |

Y el paso final, `DeleteFeaturesCommand.execute()`, **borra por id sin comprobar el candado en absoluto**, sea cual sea el origen de la selección. Es decir, la protección vive solo en la UI de dos de cuatro caminos, no en la capa de datos. En la práctica: `Ctrl+A` + `Delete`, o simplemente usar la herramienta de borrar con clic directo, elimina features de una capa "bloqueada" sin ningún aviso.

**Sugerido:** mover la validación de `locked` a `DeleteFeaturesCommand` (y a cualquier comando destructivo/de modificación), no solo a los interactors de selección — es la única forma de que sea una garantía real y no una convención de UI.

### 1.5 `src/types/vendor.d.ts` — declaración de módulos mal anidada

```ts
declare module 'dxf-parser' {
  export interface IEntity { ... }
declare module 'dxf-writer' {          // ← anidado DENTRO de 'dxf-parser', sin cerrar antes
  export default class Drawing { ... }
}
  export interface IDxf { entities?: IEntity[]; }
  export default class DxfParser { parseSync(source: string): IDxf | null; }
}
```
El bloque `declare module 'dxf-writer' { ... }` queda anidado dentro de `declare module 'dxf-parser' { ... }` porque falta el cierre de llave del primer módulo antes de abrir el segundo. TypeScript no permite anidar declaraciones de módulos ambientales dentro de otras ("Ambient modules cannot be nested in other modules or namespaces"), así que este archivo **muy probablemente falla al compilar** en modo estricto, o en el mejor de los casos funciona por casualidad según config. Hay que separarlo en dos bloques `declare module` de nivel superior, correctamente cerrados.

### 1.6 `ProjectBrowserModal`: el badge "Actual" nunca aparece

```tsx
currentProjectName={getCurrentProject().name}
...
{p.id === Number(currentProjectName) && <span className="current-badge">Actual</span>}
```
`getCurrentProject().name` está **hardcodeado** a `'Proyecto GeoUrban'` (ver `TopBar.tsx`), así que `Number('Proyecto GeoUrban')` es `NaN`, y `p.id === NaN` es siempre `false`. El badge que debería marcar el proyecto actualmente abierto en la lista de proyectos **nunca se puede mostrar**, para ningún proyecto. Hay que pasar el `id` numérico real del proyecto cargado, no su nombre.

### 1.7 Exportación Shapefile incompleta (`src/io/shp.ts`)

```ts
export function exportShp(project) {
  const result = shpwrite.zip(collection, options);
  return {
    shp: base64ToBlob(result[`${layerName}.shp`], ...),
    dbf: base64ToBlob(result[`${layerName}.dbf`], ...),
    prj: base64ToBlob(result[`${layerName}.prj`] ?? '', ...),
  };
}
```
Un Shapefile válido requiere como mínimo `.shp` + `.shx` (índice) + `.dbf`. El resultado de `shp-write` normalmente incluye una entrada `.shx`, que acá **se descarta silenciosamente**. Además, se descargan 3 archivos sueltos en vez de un `.zip` (a diferencia de KMZ, que sí se empaqueta), obligando al usuario a juntarlos manualmente en la misma carpeta con el mismo nombre para que algún software los reconozca. Recomendado: verificar si `.shx` viene en el resultado y empaquetar todo en un único `.zip` para exportar, igual que se hace con KMZ.

### 1.8 DXF: entidades ARC/CIRCLE se importan pero son "fantasmas"

En `io/dxf.ts`, `entityToFeature` convierte `CIRCLE`/`ARC` en features de tipo `Point` con propiedades extra (`radius`, `startAngle`, `endAngle`) en vez de geometría real. El problema es que **nada en el pipeline de render sabe dibujar eso**: el estilo del `webglLayer` en `DrawLayerRenderer.ts` solo define `fill-color`/`stroke-color`/`stroke-width` (pensado para polígonos), no hay ningún estilo para `Point`. Resultado: un DXF con círculos/arcos se importa sin error, pero esas entidades **no se ven en el mapa**, no son seleccionables, no tienen métricas (área/longitud) y no participan del snapping. Solo "sobreviven" por si se vuelven a exportar a DXF tal cual. Existe además `src/geo/arcMath.ts` (con `circleFrom3Points`, `sampleArc`, `arcFrom3Points`) que parece pensado exactamente para resolver esto, pero no está conectado a ningún lado (ver sección 3). Esto huele a feature a medio terminar, no a decisión de diseño.

### 1.9 `RibbonTool` recibe una prop que no existe en su interfaz

```ts
type RibbonToolProps = { mode?; icon; label; shortcut?; disabled?; active?; badge?; tooltip?; onClick? };
```
Pero en `TopBar.tsx`, dos usos (botones "Área verde" y "Equipamiento" en la pestaña Insertar) pasan `data-tooltip="..."` en vez de `tooltip="..."`:
```tsx
<RibbonTool icon={<IconGreen/>} label="Área verde" ... data-tooltip="Crear área verde (Shift+G)" />
```
`data-tooltip` no está en la interfaz (no hay index signature), así que esto es al menos un error de TypeScript por excess-property-check, y en runtime el tooltip real (`title`/`data-tooltip` del `<button>`) nunca se setea con ese texto — cae al valor por defecto (`label (shortcut)`). Es un typo, cambiar `data-tooltip` por `tooltip` en esos dos usos.

---

## 2. 🟠 Bugs de impacto acotado pero reales

### 2.1 Rotondas no disparan el recorte de manzanos
`AddStreetCommand.execute()` llama `await recomputeManzanos()` después de agregar la calle. `AddRoundaboutCommand.execute()` **no llama a nada** después de agregar la rotonda — pese a que `roadNetworkEngine.buildRoadNetworkRings()` sí incluye rotondas como parte de la red vial que recorta parcelas. Consecuencia: colocar una rotonda no re-recorta los manzanos existentes; el usuario necesita disparar indirectamente un recompute (p. ej. trazando o tocando una calle) para que la geometría se ponga al día. Añadir el mismo `await recomputeManzanos()` en `AddRoundaboutCommand` (y al actualizar/borrar rotondas) resuelve esto.

### 2.2 Borrado múltiple con la herramienta "Erase" genera N comandos en vez de 1
```ts
// InteractionModeController.ts, modo 'erase'
ids.forEach((id) => useMapStore.getState().deleteFeatureById(id));
```
`deleteFeatureById(id)` internamente hace `runCommand(new DeleteFeaturesCommand([id]))` **por cada id**, en vez de un solo `DeleteFeaturesCommand(ids)`. `mapStore.deleteSelected()` sí batchea correctamente (`new DeleteFeaturesCommand(selectedIds)`), así que ya existe el camino correcto — el modo Erase simplemente no lo usa. Efecto práctico: borrar 5 features con la herramienta Erase genera 5 entradas de historial (5 serializaciones completas del proyecto) en vez de 1, y deshacer ese borrado requiere 5 `Ctrl+Z` en vez de 1.

### 2.3 `kind` vs `type`: dos sistemas de clasificación de features que se desincronizan
`core/objectModel.ts` define el sistema "canónico" (`kind: GeoUrbanFeatureKind`, con `getFeatureKind()` que prioriza `kind` y cae a `type` como legado). Pero conviven en paralelo:
- `ManzanoPanel.tsx` → `handleToggleEquip()` solo hace `feat.set('type', 'equipamiento'/'manzana')`, **nunca toca `kind`**. Como la feature ya tenía `kind: 'manzana'` desde su creación, `getFeatureKind()` la sigue devolviendo como `'manzana'` para siempre, aunque el panel la muestre como "equipamiento". Consecuencia real: `recomputeManzanos()` (que filtra por `getFeatureKind`) sigue recortando esa parcela contra la red vial como si fuera un manzano común, ignorando la intención del usuario de "fijarla" como equipamiento.
- `StatsPanel.tsx` detecta lotes con `f.get('subdivision') || f.get('label')?.startsWith('Lote')` (un tercer criterio, ni `kind` ni `type`).
- `PostrenderPainter.tsx` usa `feature.get('type') === 'manzana'` directamente en vez de `getFeatureKind()`.

Recomendado: elegir `kind` como única fuente de verdad, migrar todos estos puntos a `getFeatureKind()`/`ensureKind()`, y eliminar los chequeos ad hoc de `type`/`label`/`subdivision` dispersos.

### 2.4 Doble carga de `sql.js` con URL de CDN externa
`io/gpkg.ts` y `io/persistenceDesktop.ts` implementan **cada uno por su lado** un singleton `getSql()` que descarga el WASM de `https://sql.js.org/dist/`. Problemas:
- Si en la misma sesión se usa import GPKG y persistencia desktop, se descarga el wasm dos veces (dos instancias, dos promesas, sin compartir).
- Depender de un CDN externo para una app de escritorio (Tauri) rompe el uso **offline**, que es justamente uno de los argumentos de tener una app de escritorio. Debería empaquetarse el `.wasm` localmente (`locateFile` apuntando a un asset local del build).

### 2.5 `tauri-plugin-sql` configurado pero nunca registrado
`Cargo.toml` declara `tauri-plugin-sql` como dependencia, y `tauri.conf.json` tiene `"plugins": {"sql": {"preload": ["sqlite:geourban.db"]}}`. Pero `src-tauri/src/lib.rs` **nunca llama `.plugin(tauri_plugin_sql::Builder::default()...)`** en el `Builder`. El preload configurado no tiene efecto porque el plugin no está registrado, y `capabilities/default.json` tampoco otorga permisos del plugin sql. En la práctica el proyecto usa `sql.js` (WASM, vía CDN) para todo, así que esta dependencia de Rust es peso muerto de compilación/confusión — o se termina de integrar, o se retira del `Cargo.toml`/`tauri.conf.json`.

---

## 3. 🟡 Código muerto / archivos "en vano" (candidatos — verificar con grep global antes de borrar)

| Archivo / símbolo | Motivo |
|---|---|
| `src/components/ui/button.tsx` | Componente shadcn/Radix con paleta Tailwind (`cyan-500`, `slate-950`) que no coincide con el sistema de diseño real de la app (variables CSS `--cad-*` en `index.css`). No aparece importado en ningún otro archivo compartido. |
| `src/components/ProjectCrsPanel.tsx` | No se renderiza desde `App.tsx`. `StatusBar.tsx` implementa su propia UI de CRS (badge + dropdown) casi idéntica y sí está montada. Parece un componente reemplazado y no eliminado. |
| `src/geo/arcMath.ts` | `circleFrom3Points`/`sampleArc`/`arcFrom3Points` no tienen consumidores visibles. Relacionado con el punto 1.8 (¿feature de arcos nunca terminada?). |
| `src/geo/curveClipping.ts` | `getStreetSegments`/`getStreetOuterSegments`/`streetToCoordinates` sin consumidores visibles; el recorte de manzanos hoy pasa por `roadNetworkEngine.ts` + el worker JSTS (`computeManzanos`), no por este archivo. |
| `polygonEngine.ts`: `clipPolygonByAllStreets`, `applyStreetToPolys`, `streetRect`, `polysOverlap`, `approxOverlapArea` | Mismo caso: parecen el algoritmo de recorte **anterior** al enfoque JSTS actual, sin consumidores visibles hoy. |
| `polygonEngine.ts`: función privada `polyAreaM2()` | Envoltorio de `polyArea()` sin diferencia ni uso dentro del propio archivo. |
| `Command.undo()` / `Command.redo()` en **todos** los comandos de mapa | Código funcionalmente muerto para el flujo real de Ctrl+Z (ver 1.1) — están implementados pero nunca invocados por `CommandStack`. |
| `src/map/demoDataset.ts` | El nombre sugiere datos de demo, pero el archivo contiene `SpatialIndex` (wrapper de RBush) y el singleton `getOrCreateSpatialIndex()` usado en producción por el motor de snapping (`Map.tsx`). No es código muerto, pero el nombre confunde y debería renombrarse a algo como `spatialIndex.ts`. |

---

## 4. 🟡 Rendimiento y robustez

- **Subdivisión de manzanos en el hilo principal.** `GenerateLotsCommand`, `RecomputeManzanoLotsCommand` y toda la maquinaria de `subdivisionAlgorithms.ts`/`subdivisionCabeceraCuerpo.ts` corren de forma síncrona en el hilo de UI, a diferencia de las operaciones booleanas (union/difference) que sí van al worker (`workers/geoOperations.ts`). En proyectos con muchos manzanos/lotes esto puede congelar la interfaz justo en la operación geométricamente más pesada de la app.
- **RPC al worker sin timeout.** `geoWorkerClient.ts`'s `runWorker()` no tiene ningún mecanismo de timeout; si el worker no responde por cualquier motivo, la promesa queda colgada para siempre (por ejemplo, `TopologyValidator` quedaría en "Validando..." indefinidamente).
- **`historyStore.pushState` serializa el proyecto completo en cada acción** (hasta 50 snapshots completos en memoria, `MAX_HISTORY = 50`). Para proyectos grandes esto es costoso en CPU y memoria por cada comando ejecutado.
- **`PostrenderPainter.paintFeatureLabels` recalcula colisión de etiquetas en cada frame `postrender`** con un algoritmo O(n²) (`isColliding` compara contra todas las cajas ya colocadas), sin cache — contrasta con el buen patrón de cache que sí existe para fillets/crossings de calles en el mismo archivo (`cache.dirty`). Con muchos lotes esto puede notarse en pan/zoom.
- **`TopBar.tsx` recalcula el proyecto completo (serialización GeoJSON de todas las features) en cada render** solo para leer `.name` y pasarlo como prop a `ProjectBrowserModal` (`currentProjectName={getCurrentProject().name}`), pese a que ese nombre es una constante hardcodeada. Trabajo desperdiciado en cada re-render de la topbar.
- **Tiles de Google Maps sin API oficial** (`https://mt1.google.com/vt/lyrs=s...` en `baseMaps.ts`): consumir estos endpoints XYZ directamente, sin key ni atribución vía la API oficial, es frágil (Google puede bloquear/limitar en cualquier momento) y cuestionable respecto a los Términos de Servicio de Google para uso en producción.
- **`security.csp: null` en `tauri.conf.json`.** Deshabilitar la CSP por completo en una app de escritorio renuncia a una capa de defensa importante contra XSS/inyección, sobre todo teniendo en cuenta que la app carga WASM (`sql.js`) desde un CDN externo.
- **Autosave en `beforeunload` no garantiza persistencia.** Tanto `io/persistence.ts` (web/Dexie) como `persistenceDesktop.ts` disparan un guardado async dentro de `beforeunload`; los navegadores no garantizan que una IndexedDB write async complete antes de cerrar la pestaña, así que hay una ventana real de pérdida de datos al cerrar justo después de editar.
- **Paridad web/desktop de proyectos:** en web (`persistence.ts`) solo existe autosave de un único slot (siempre sobrescribe el último registro de Dexie); multi-proyecto, duplicar, borrar y listar solo existen en desktop (`persistenceDesktop.ts`), y `ProjectBrowserModal` así lo indica explícitamente al usuario. No es un bug (está declarado en la UI), pero es una asimetría de producto a tener en cuenta.

---

## 5. 🔵 Calidad de código y mantenibilidad

- **Duplicación de paletas de color.** El mismo array de 10 colores para manzanos existe copiado en `StatsPanel.tsx`, `ManzanoPanel.tsx` y `DrawLayerRenderer.ts` (`MZN_COLORS` / `MZN_COLORS_STR`), y `LayerPanel.tsx` tiene su propia variante de 12 colores para capas nuevas (`LAYER_COLORS`). Debería extraerse a un único módulo compartido (`geo/palette.ts` o similar).
- **UI de selección de CRS/zona UTM triplicada** casi al carácter entre `ProjectSetupModal.tsx`, `ProjectCrsPanel.tsx` (posiblemente muerto, ver sección 3) y `StatusBar.tsx`. Buen candidato para extraer un componente `<UtmZoneSelector />` compartido.
- **Bisección binaria reimplementada varias veces.** `subdivisionAlgorithms.ts` (con al menos 3 loops de bisección inline distintos: `computeCuts`, `subdivideHalf`, `sliceBisectManzano`/`sliceBisectLote`) y `subdivisionCabeceraCuerpo.ts` (con su propio helper `bisect()`) resuelven el mismo problema genérico ("buscar el corte que da un área objetivo") de forma independiente y con nombres muy poco descriptivos (`hbGetCfg`, `hbAutoHeadPlan`, `hbFitBodyRows`, `hbLotizeWithBaseline`). Es lógica geométrica de alto valor y alto riesgo (viene de un port de un prototipo HTML, según el propio comentario del archivo) sin tests visibles y con nomenclatura difícil de auditar a futuro. Prioridad alta para: (a) extraer un helper de bisección compartido, (b) agregar tests unitarios sobre casos conocidos de manzanos, (c) documentar los "números mágicos" (ej. `MAX_FILLET_R = 8`, umbral de ángulo `4° `).
- **Uso extendido de `any`** en puntos sensibles: `StatsPanel.computeStats(drawSource: any, streets: any[])`, `PropertyPanel.tsx` (`as any` sobre la feature seleccionada), `PostrenderPainter` (`(event: any)`), `persistenceDesktop.ts` (`db: any`), casteos como `(dxf as any).drawLinearDimension(...)` en `io/dxf.ts` pese a que el método **ya está tipado** en `vendor.d.ts` (el `as any` ahí es puro ruido, se puede quitar).
- **UX de errores inconsistente.** Mezcla de `alert()`/`window.confirm()`/`window.prompt()` nativos (en `TopBar.tsx`, `ProjectBrowserModal.tsx`) con paneles de error propios con estilo CAD (en `SubdivisionDialog.tsx`, `TopologyValidator.tsx`) y con simples `console.error` silenciosos (autosave). Vale la pena unificar en un solo sistema de notificaciones/toast coherente con el resto del diseño oscuro tipo CAD.
- **Imports dinámicos inconsistentes para los mismos módulos.** `TopBar.tsx` hace `await import('../workers/geoWorkerClient')` y `await import('ol/format/GeoJSON')` dentro de handlers puntuales (`handleFindOverlaps`, `handleFindGaps`), mientras que `mapStore.ts` (cargado eager con toda la app) ya importa esos mismos módulos de forma estática. El code-splitting dinámico ahí no aporta nada real porque el módulo ya está en el bundle principal por otro camino.
- **Sin tests visibles.** No se compartió ningún archivo de test (`*.test.ts`, `*.spec.ts`) entre los documentos. Si realmente no existen, es la brecha más riesgosa dado el volumen de geometría computacional pura (subdivisión, fillets, snapping) que es exactamente el tipo de código que más se beneficia de tests unitarios basados en casos fijos (polígonos de referencia con resultado esperado).
- **Accesibilidad.** Bastantes elementos interactivos son `<div onClick=...>` sin `role`, `tabIndex` ni manejo de teclado (filas de `LayerPanel`, tarjetas de `ManzanoPanel`), en vez de `<button>` semántico. Aceptable si el público objetivo es 100% mouse/desktop, pero vale mencionarlo.
- **Sin sistema de i18n real.** Todo el texto de UI está hardcodeado en español dentro de JSX/alerts. Funciona hoy, pero cualquier futura necesidad de otro idioma implica un refactor completo de extracción de strings, no una config.

---

## 6. 🟢 Lo que está bien (para que el diagnóstico sea justo)

- Manejo de **zonas UTM dinámicas** (`utmZones.ts` + `ensureUtmZoneRegistered`) con registro lazy en `proj4`/OpenLayers: bien resuelto y reutilizado consistentemente en DXF, GPKG y métricas.
- **Worker dedicado con JSTS** para uniones/diferencias/validación topológica (`workers/geoOperations.ts`): correcto, evita bloquear el hilo principal para las operaciones booleanas (aunque, como se señaló, la subdivisión no sigue el mismo patrón).
- **Cache inteligente de fillets/cruces de calles** en `PostrenderPainter` (`cache.dirty`, hash de calles) — buen patrón, evita recomputar geometría de esquinas en cada frame (contrasta positivamente con el problema de colisión de etiquetas del mismo archivo).
- Separación de responsabilidades por carpeta (`geo/` puro, `store/` estado, `map/scene/` interacciones OL, `commands/` mutaciones) es una base razonable si se resuelve la inconsistencia del punto 1.1.
- El importador GPKG (`io/gpkg.ts`) resuelve razonablemente bien SRS custom vía tabla `gpkg_spatial_ref_sys` + WKT, con manejo de errores por geometría individual (no aborta todo el import por una fila corrupta).

---

## 7. Priorización sugerida

**Ahora (rompe confianza del usuario / pérdida de datos):**
1. Undo/Redo (1.1) — decidir arquitectura única y arreglar la corrupción del stack `future`.
2. Candado de capa no enforced en `DeleteFeaturesCommand` + modo Erase + Ctrl+A (1.4).
3. Exportación PNG rota (1.2).
4. `vendor.d.ts` mal formado (1.5) — verificar que efectivamente compila hoy.

**Próximo (bugs funcionales concretos):**
5. Rotondas no disparan `recomputeManzanos` (2.1).
6. `kind`/`type` desincronizado en toggle de equipamiento (2.3).
7. Shapefile sin `.shx` / sin zip (1.7).
8. Badge "Actual" en ProjectBrowserModal (1.6).
9. Borrado múltiple en Erase = N comandos (2.2).

**Después (deuda técnica / arquitectura):**
10. Conectar de verdad color/opacidad de capas al render WebGL, o simplificar el panel para no prometerlo (1.3).
11. Sacar subdivisión del hilo principal al worker.
12. Consolidar paletas de color y UI de CRS duplicadas.
13. Auditoría de código muerto de la sección 3 con grep sobre el repo completo, y borrado.
14. sql.js local en vez de CDN + unificar el loader.
15. Tests unitarios para el motor de subdivisión (`subdivisionAlgorithms.ts`, `subdivisionCabeceraCuerpo.ts`).

---

*Nota final: este diagnóstico se hizo leyendo el flujo de datos real entre archivos (quién llama a quién, qué campo lee cada componente), no solo cada archivo aislado. Aun así, antes de borrar cualquier cosa marcada como "candidato a código muerto" en la sección 3, correr un grep del símbolo en todo el repositorio (no solo en los archivos que compartiste), porque puede haber consumidores en archivos que no vi.*
