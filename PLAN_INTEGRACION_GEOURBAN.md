# Plan Quirúrgico de Integración — GeoUrban

> Comparación de `OBJETIVO.md` (arquitectura objetivo) contra el estado real del
> repo (React 19 + Zustand + OpenLayers + Tauri) y plan de implementación por
> fases. Cada fase indica: qué existe, qué falta, archivos afectados,
> dependencias nuevas y criterios de "hecho".

---

## 0. Resumen ejecutivo

El proyecto tiene **una base sólida y no trivial** en tres motores concretos:

- **Snap Engine** (`src/map/advancedSnap.ts`, `snapInteraction.ts`) — nivel
  AutoCAD, con broad-phase, histéresis e intersecciones aparentes.
- **Dimension/Label automático** (`src/geo/metrics.ts`, `src/map/styleFactory.ts`)
  — geodésicamente correcto, reproyecta al mismo plano que exporta a DXF.
- **Subdivision Engine** (`src/geo/subdivisionAlgorithms.ts`,
  `polygonEngine.ts`) — port robusto de un motor de lotización previo
  (LOTES_SAI) con 3 métodos (auto/exact/manual-slice).

Pero **el principio de arquitectura declarado al final de `OBJETIVO.md`
todavía no se cumple**:

> "Todo debe pasar por el modelo de objetos y el sistema de comandos, nunca
> directamente por el render."

Hoy no existe **Command Engine** ni **Object Engine** formal: `Toolbar.tsx`,
`SubdivisionDialog.tsx` y `Map.tsx` mutan `drawSource` (OL VectorSource)
directamente, llaman a `updateFeatureMetrics`/`refreshSourceMetrics` a mano, y
empujan a `historyStore` manualmente en cada handler. El "Undo/Redo" es un
snapshot completo de GeoJSON por operación (`historyStore.ts`, `MAX_HISTORY=50`),
no un sistema de comandos reproducibles.

Esto se plantea como **Fase 1**, porque es la base que después simplifica
todas las fases de herramientas nuevas (Fases 2–7): si primero se ordena el
Command/Object Engine, cada herramienta nueva (rectángulo, offset, trim,
ochavas reales, etc.) se integra "gratis" al undo/redo y no repite el patrón
ad hoc que ya está duplicado 4 veces (`mergeSelected`, `applySubdivision`,
`handleGenerateLots`, `recomputeManzanos`).

También hay una **discrepancia de stack declarado vs. real** (ver Fase 0)
que conviene resolver explícitamente antes de seguir sumando código.

---

## 1. Matriz de estado por motor (vs. `OBJETIVO.md`)

| Motor | Estado | Nota clave |
|---|---|---|
| Core / Project Engine | 🟡 Parcial | Autosave a Dexie (slot único), sin gestor multi-proyecto |
| Core / Object Engine | 🔴 No existe | Features = bolsa de props sin schema tipado |
| Core / History Engine | 🟡 Parcial | Undo/redo por snapshot completo, no por comando |
| Core / Command Engine | 🔴 No existe | Violación directa del principio de arquitectura del doc |
| Core / Event / Settings Engine | 🟡 Parcial | Zustand + `persist` para snap settings; sin settings engine general |
| CAD / Draw Engine | 🟡 Parcial | Solo polilínea-cerrada (usada como "polígono") y línea de calle. Sin rectángulo, círculo, arco, texto, línea suelta |
| CAD / Edit Engine | 🔴 Incompleto | Mover ✅, Fusionar(≈Join) ✅. Copiar/Rotar/Escalar/Offset/Trim/Extend/Fillet genérico/Chamfer/Mirror/Split ❌ |
| CAD / Selection Engine | 🟡 Parcial | Click + shift-click ✅. Rectángulo, lazo, filtros ❌ |
| CAD / Snap Engine | 🟢 Fuerte | Falta cerrar `grid` como `SnapType` de 1ª clase (hay comentarios que lo dan por hecho pero el tipo no lo incluye) |
| CAD / Dimension Engine | 🟡 Parcial | Automático ✅ (muy bueno). Manual/Angular/Radio/Diámetro ❌ |
| CAD / Label Engine | 🟡 Parcial | Rotación/posición automática ✅. Anti-colisión, expresiones, manual ❌ |
| CAD / Layer Engine | 🔴 Incompleto | Solo 3 toggles fijos (lots/streets/measurements), sin capas reales por feature, sin lock/color/orden |
| GIS / GEOS-equivalente (JSTS) | 🟢 Bien | `geoOperations.ts` completo (union/diff/intersect/validate), pero `subtract`/`intersect` no están conectados a ninguna UI todavía |
| GIS / PROJ-equivalente (proj4) | 🟢 Bien | `utmZones.ts`, `crsTransform.ts`, `projectCrsStore.ts` |
| GIS / Spatial Index | 🟢 Bien | RBush en `demoDataset.ts`, usado por snap |
| Advanced Geometry / Subdivision | 🟢 Fuerte | 3 métodos, con dirección PCA y bisección numérica |
| Advanced Geometry / Ochavas (fillets) | 🟡 Solo visual | `streetEngine.ts` calcula fillets pero **no se recortan realmente los lotes/manzanos** — solo se dibujan en canvas |
| Advanced Geometry / Calles curvas, perfiles | 🔴 No existe | Solo segmentos rectos de 2 puntos |
| Advanced Geometry / Áreas verdes / equipamiento | 🟡 Fantasma | `StatsPanel.tsx` ya lee `type === 'equipamiento'`, pero no hay herramienta que lo cree |
| Advanced Geometry / Validation | 🟡 Parcial | Geometría inválida ✅. Superposiciones y huecos ❌ |
| Import/Export / DXF | 🟡 Parcial | Solo LINE/LWPOLYLINE/POLYLINE/POINT. Sin ARC/CIRCLE/TEXT/MTEXT/BLOCK/INSERT/HATCH/DIMENSION/SPLINE |
| Import/Export / SHP, KML/KMZ, GeoJSON | 🟢 Completo | — |
| Import/Export / GeoPackage | 🟡 Solo import | `exportGpkg` literalmente lanza `throw new Error('...pendiente...Fase 6')` — ya está marcado en el propio código |
| Import/Export / PDF, SVG, PNG | 🔴 No existe | — |
| Render / GPU (WebGL) | 🟢 Bien | `WebGLVector` para relleno/stroke masivo |
| Render / CPU (Canvas2D) | 🟢 Bien pero centralizado en 1 archivo | Cotas, snap, calles, fillets, todo en el postrender de `Map.tsx` |
| Render / Scene-Layer-Cache-Tile-LOD Manager | 🔴 No existe como módulos | Todo vive en un único `useEffect` de +900 líneas en `Map.tsx` |
| Layout Engine (planos, carimbo, leyenda, etc.) | 🔴 No existe | 0% implementado |
| Storage / SQLite | 🔴 No usado como motor propio | Solo Dexie (IndexedDB) para autosave; `sql.js` (SQLite-wasm) solo para **leer** `.gpkg` |
| Storage / Cloud Sync | 🔴 Futuro (marcado como tal en el doc) | — |

---

## Fase 0 — Alinear el stack declarado con el real (decisión, no código)

**Objetivo:** que `OBJETIVO.md` deje de mentir sobre la arquitectura y sirva
como fuente de verdad real para el resto del plan.

`OBJETIVO.md` declara: `Primereact`, `GDAL + GEOS + PROJ`, `CGAL`,
`SQLite + GeoPackage`, `pdf-lib`. El código real usa:

| Declarado | Real hoy | Recomendación |
|---|---|---|
| Primereact | Design system propio (`index.css` `--cad-*`) + Radix primitives + `cva` (`components.json`, `button.tsx`) + `lucide-react` | **Mantener el actual.** Ya hay un sistema de diseño CAD coherente (glass panels, tooltips, toggles) construido a medida; migrar a PrimeReact sería un downgrade visual y trabajo puro de reemplazo sin valor funcional. Actualizar el doc. |
| GDAL | Nada nativo, todo vía libs JS (`ol/format`, `shpjs`, `dxf-parser/writer`, `JSZip`) | Mantener JS/WASM. GDAL nativo en Tauri (sidecar Rust) es viable a futuro solo si aparece un formato que las libs JS no cubran razonablemente (ej. raster). No bloquea nada hoy. |
| GEOS | `jsts` (port JS de JTS/GEOS) vía Web Worker (`geoWorker.ts`) | Mantener. Es funcionalmente GEOS. Renombrar la fila del doc a "JSTS (GEOS-compatible)". |
| PROJ | `proj4` | Es literalmente el port JS de PROJ. Coincide, solo corregir el nombre en el doc. |
| CGAL | Motor propio en TS (`polygonEngine.ts`, `subdivisionAlgorithms.ts`, port de "LOTES_SAI") | Mantener. CGAL no tiene binding JS/WASM maduro y estable; el motor propio ya está probado en producción anterior. Documentarlo como "Geometry Engine propio" en vez de aspirar a CGAL. |
| SQLite + GeoPackage | Dexie/IndexedDB (autosave) + `sql.js` solo lectura de `.gpkg` | **Gap real** — ver Fase 10. Aquí sí conviene cerrar la brecha porque Tauri permite SQLite nativo de verdad (`tauri-plugin-sql`), y hoy el desktop no lo aprovecha. |
| pdf-lib | No existe | Gap real — ver Fase 9. |

**Entregable de esta fase:** actualizar la tabla "Stack Tecnológico" de
`OBJETIVO.md` para reflejar la realidad + marcar SQLite y PDF como los
únicos gaps de stack genuinos a cerrar (el resto son diferencias de nombre,
no de arquitectura).

**Esfuerzo:** S (documentación, 0 código).

---

## Fase 1 — Command Engine + Object Engine (fundacional)

**Por qué va primero:** todas las fases 2–7 agregan herramientas nuevas
(rectángulo, offset, trim, mirror, ochavas reales...). Si se agregan sobre
el patrón actual (mutar `drawSource` a mano + `pushState` manual), cada una
repite el mismo código ad hoc que ya está duplicado en:

- `src/components/Toolbar.tsx` → `handleMergeSelected`, `handleGenerateLots`
- `src/components/SubdivisionDialog.tsx` → `applySubdivision`
- `src/store/mapStore.ts` → `mergeSelected`, `deleteSelected`, `deleteFeatureById`, `recomputeManzanos`
- `src/map/Map.tsx` → handlers de `drawend`, `modifyend`, `translateend`

### 1.1 Object Engine — schema tipado de features

Hoy las propiedades de un feature (`type`, `subdivision`, `lotGroupId`,
`colorIdx`, `isRemnant`, `method`, `label`, `mergedFrom`, `mergedAt`, etc.)
están dispersas y sin tipo en 6+ archivos distintos.

**Crear** `src/core/objectModel.ts`:

```ts
export type GeoUrbanFeatureKind = 'lote' | 'manzana' | 'calle' | 'equipamiento' | 'linea';

interface BaseFeatureProps {
  kind: GeoUrbanFeatureKind;
  createdAt: string;
  label?: string;
}
interface LoteProps extends BaseFeatureProps {
  kind: 'lote';
  areaM2: number; perimeterM: number; frontM?: number; depthM?: number;
  isRemnant: boolean; lotGroupId?: string; subdivisionMethod?: string;
}
interface ManzanaProps extends BaseFeatureProps {
  kind: 'manzana'; areaM2: number; colorIdx: number;
}
// ...CalleProps ya vive parcialmente en streetStore.Street — unificar
export type GeoUrbanFeatureProps = LoteProps | ManzanaProps | /* ... */;
```

- Reemplazar los `feature.get('type') === 'manzana'` / `.startsWith('Lote')`
  string-matching repartidos en `StatsPanel.tsx`, `styleFactory.ts`,
  `Toolbar.tsx` por un helper único `getFeatureKind(feature)`.
- Validar en los bordes de import/export (`io/*.ts`) con un parser ligero
  (zod o guards manuales) para que un `.geourban`/`.geojson` corrupto no
  entre silenciosamente al store.

### 1.2 Command Engine

**Crear** `src/commands/`:

```
src/commands/
  Command.ts              # interfaz { execute(ctx), undo(ctx), label }
  CommandStack.ts          # reemplaza el uso directo de historyStore
  AddFeatureCommand.ts
  DeleteFeaturesCommand.ts
  MergeFeaturesCommand.ts
  SubdivideCommand.ts
  ModifyGeometryCommand.ts   # Modify/Translate del mapa
  AddStreetCommand.ts
  GenerateLotsCommand.ts
```

- `CommandStack` guarda instancias de `Command` (no snapshots completos).
  Transición segura: cada `Command.undo()` puede internamente seguir
  restaurando por snapshot al inicio (reusar `historyStore` como motor
  interno) — lo que cambia es la **API pública**: todo pasa por
  `commandStack.run(new XCommand(...))`, nunca por `drawSource.addFeature`
  directo desde un componente.
- Migrar uno por uno los handlers existentes:
  - `Toolbar.handleMergeSelected` → `commandStack.run(new MergeFeaturesCommand(...))`
  - `Toolbar.handleGenerateLots` → `GenerateLotsCommand`
  - `SubdivisionDialog.applySubdivision` → `SubdivideCommand`
  - `Map.tsx` `draw.on('drawend')`, `modify.on('modifyend')`,
    `translate.on('translateend')` → wrappear en comandos correspondientes
  - `mapStore.deleteSelected/deleteFeatureById` → `DeleteFeaturesCommand`
  - `mapStore.recomputeManzanos` → `AddStreetCommand` (la calle dispara el
    recorte como efecto del propio comando)
- `useKeyboardShortcuts.ts` deja de llamar `useHistoryStore.getState().undo()`
  y pasa a llamar `commandStack.undo()`.

**Beneficio inmediato y medible:** hoy `historyStore` guarda hasta 50
strings GeoJSON completos en memoria (`MAX_HISTORY = 50`) — en un proyecto
grande (miles de lotes) esto es memoria desperdiciada y un `undo()` es
`O(n)` en tamaño de proyecto por cada paso. Con comandos discretos, la
Fase 1.3 (opcional, post-MVP de comandos) puede migrar a diffs
incrementales sin tocar la UI otra vez.

**Criterios de "hecho":**
- [ ] Ningún componente de `src/components/*` ni `src/map/Map.tsx` llama
  `drawSource.addFeature/removeFeature` directamente fuera de un `Command`.
- [ ] `historyStore` pasa a ser detalle de implementación interno de
  `CommandStack`, no se importa desde componentes.
- [ ] Undo/redo cubre exactamente las mismas operaciones que hoy (no
  regresión funcional).

**Esfuerzo:** L. **Bloquea:** Fases 2, 3, 6 (parcialmente), 7.1.

---

## Fase 2 — Draw Engine: herramientas faltantes

Estado actual: `drawStore.ts` solo define `'select' | 'polyline' | 'street'
| 'erase' | 'edit' | 'none'`. "Polyline" en realidad dibuja `Polygon`
cerrado (usado tanto para manzanos/lotes como, reutilizando
`lastDrawnLineId`, para la línea de corte de `manual-slice`) — dos usos
distintos de la misma herramienta, confuso.

### 2.1 Separar "Línea" de "Polígono"
- `DrawMode` → agregar `'line'` explícito, usado solo para líneas de
  referencia/corte (reemplaza el uso indirecto de `polyline` para el
  `lastDrawnLineId` en `SubdivisionDialog.tsx`).
- Mantener `'polyline'` como dibujo de polígono cerrado (renombrar
  internamente a `'polygon'` para que el código no mienta; mantener el
  shortcut `P`).

### 2.2 Rectángulo
- Nueva interacción en `Map.tsx`: `Draw` con `type: 'Circle'` +
  `geometryFunction: createBox()` de `ol/interaction/Draw.js` (soporte
  nativo de OL, cero dependencias nuevas).
- Snap de los 2 clicks (esquinas) vía `SnapEngine` ya existente.

### 2.3 Círculo
- `Draw` con `type: 'Circle'` nativo de OL.
- **Impacto en Dimension Engine:** habilita por fin "Radio/Diámetro"
  (Fase 6), hoy imposible porque no hay geometría circular.
- **Impacto en Snap Engine:** agregar `SnapType: 'center'` y `'tangent'`
  a `advancedSnap.ts` (hoy no existen porque no había círculos que
  centrar/tangentear).

### 2.4 Arco
- OL no tiene tipo `Arc` nativo. Implementar como `LineString` con
  `geometryFunction` custom (3 clicks: inicio, fin, punto en el arco →
  circunferencia por 3 puntos, mismo tipo de matemática que ya existe en
  `streetEngine.ts::computeStreetFillets` para arcos de fillet —
  **reusar ese código**, generalizándolo a `src/geo/arcMath.ts`).

### 2.5 Texto
- Nueva `Feature` con geometría `Point` + propiedad `text`.
- Estilo: reusar `createLiveDrawingLabelStyle` de `styleFactory.ts` como
  base, pero editable (doble click → input inline, similar al patrón ya
  usado en `PropertyPanel.tsx` para paneles flotantes).

**Archivos tocados:** `drawStore.ts`, `Map.tsx` (rama de interacciones por
modo), `Toolbar.tsx` (nuevos íconos+botones), `advancedSnap.ts`
(center/tangent), nuevo `src/geo/arcMath.ts`.

**Depende de:** Fase 1 (para que cada `drawend` nuevo use
`AddFeatureCommand` en vez de mutar `drawSource` a mano, como ya hace hoy
el `drawend` de polígono).

**Esfuerzo:** L.

---

## Fase 3 — Edit Engine: operaciones faltantes

Hoy: Mover ✅ (`SafeTranslate`), Fusionar/≈Join ✅ (`mergeSelected` vía
JSTS `union`). Todo lo demás falta.

| Operación | Cómo implementarla | Reusa |
|---|---|---|
| **Copiar** | Clonar geometría+props seleccionadas, offset visual leve, nuevo id | `AddFeatureCommand` (Fase 1) |
| **Rotar** | Nueva interacción custom (no hay нativa en OL): anchor + ángulo vía drag, aplicar `geometry.rotate(angle, anchor)` (método nativo de `ol/geom/Geometry`) | Patrón de `SafeTranslate.ts` como plantilla |
| **Escalar** | Igual que rotar pero con `geometry.scale(factor, factor, anchor)` (nativo OL) | ídem |
| **Offset** | JSTS `BufferOp` con `distance` negativo/positivo sobre una sola geometría (no está en `geoOperations.ts` todavía — agregar `case 'buffer'`) | `geoWorker.ts` (agregar tipo de request) |
| **Trim / Extend** | JSTS `difference`/línea-extendida + intersección con segmento de corte. `subtractFeatures` **ya existe en `geoOperations.ts` pero no está conectado a ninguna UI** — es el 80% del trabajo de Trim | `geoWorkerClient.ts` (falta exponer `subtractFeatures` como `trimInWorker`) |
| **Fillet (genérico, no solo calles)** | Generalizar la matemática de `streetEngine.ts::computeStreetFillets` (ya calcula tangentes+arco entre 2 rectas) para 2 segmentos cualquiera de un polígono, no solo ejes de calle | `src/geo/arcMath.ts` (compartido con Fase 2.4) |
| **Chamfer** | Igual que fillet pero con corte recto en vez de arco — matemática más simple, reusa `lineLineIntersect` de `polygonEngine.ts` | `polygonEngine.ts` |
| **Mirror** | Reflexión sobre eje definido por 2 clicks: transformación afín simple sobre coordenadas | Nuevo helper en `polygonEngine.ts` |
| **Split** | Generalizar `sliceBisectManzano`/`sliceBisectLote` (ya en `subdivisionAlgorithms.ts`, usados hoy solo por `manual-slice`) para exponerlos como herramienta de Edit independiente de "Subdividir" | `subdivisionAlgorithms.ts` (ya existe, falta exponerlo fuera del dialog) |

**Nota importante:** varias de estas ya tienen el 60-80% de la matemática
resuelta en el código existente (buffer/difference en el worker, fillets en
`streetEngine.ts`, bisección en `subdivisionAlgorithms.ts`). Esta fase es
principalmente **exponer y generalizar**, no escribir geometría desde cero.

**Depende de:** Fase 1 (comandos) y, para Trim/Offset, de conectar
`subtractFeatures`/agregar `bufferFeatures` al worker existente.

**Esfuerzo:** XL (la fase más grande del plan).

---

## Fase 4 — Selection Engine avanzada

Hoy: click + shift-click (`Map.tsx::wireSelectBehavior`). Falta:

- **Selección por rectángulo:** `ol/interaction/DragBox` (nativo, cero
  dependencias) — activar con drag mientras `mode === 'select'` y sin
  click sobre un feature.
- **Selección por lazo (lasso):** no hay interacción nativa en OL;
  implementar como `PointerInteraction` custom que acumula puntos del
  drag y al soltar arma un `Polygon`, luego usa
  `getOrCreateSpatialIndex().search(...)` (RBush, ya existe en
  `demoDataset.ts`) para candidatos + point-in-polygon
  (`polygonEngine.ts::pointInPoly`, ya existe) para filtrar.
- **Filtros de selección:** panel simple (tipo `SnapPanel.tsx` como
  plantilla de UI) para filtrar por `kind` (lote/manzana/calle/equipamiento)
  antes de aplicar selección por rectángulo/lazo — depende del Object Engine
  de la Fase 1.1 para tener `kind` tipado en vez de string-matching.

**Archivos tocados:** `Map.tsx` (nueva interacción), `selectionStore.ts`
(sin cambios grandes, ya soporta sets), nuevo `src/components/SelectionFilterPanel.tsx`.

**Depende de:** Fase 1.1 (Object Engine) para los filtros por tipo.

**Esfuerzo:** M.

---

## Fase 5 — Layer Engine real

Hoy `layerStore.ts` es 3 booleans fijos (`lots`, `streets`, `measurements`)
+ 1 panel + basemap. No hay capas de verdad: no se puede crear una capa
nueva, asignar features a ella, bloquearla, cambiarle color/grosor, ni
reordenarla.

### 5.1 Modelo de capas
- Nuevo store `src/store/layersRegistryStore.ts`: `Layer { id, name,
  color, visible, locked, order, opacity }`.
- Cada feature gana una prop `layerId` (parte del Object Engine, Fase 1.1).
- Migración: al cargar un proyecto viejo (`.geourban` sin `layerId`),
  auto-asignar a capas por defecto según `kind` (lotes→"Lotes", manzanas→
  "Manzanos", calles→"Viales") para no romper proyectos existentes.

### 5.2 UI
- Extender `LayerPanel.tsx` (hoy hardcodea 3 filas fijas) para que itere
  `layersRegistryStore` dinámicamente: checkbox visible, candado lock,
  color picker, drag-to-reorder (afecta `z-index` de render).
- Lock debe bloquear selección: en `Map.tsx::wireSelectBehavior`, filtrar
  features cuya capa esté `locked`.

### 5.3 Render
- El `WebGLVectorLayer` de `Map.tsx` usa hoy una expresión `match` sobre
  `colorIdx` fija para manzanos — generalizar a `match` sobre `layerId` →
  color de la capa, leído de `layersRegistryStore`.

**Depende de:** Fase 1.1 (Object Engine, para `layerId` tipado).

**Esfuerzo:** L.

---

## Fase 6 — Dimension & Label Engine: lo que falta

Lo automático (`metrics.ts`, `styleFactory.ts::drawSegmentLabels/drawMainMetricLabel`)
ya es sólido y no requiere tocarse. Falta:

- **Cota manual:** herramienta de 2 clicks + offset, crea un "objeto cota"
  independiente de un feature (hoy las cotas son 100% derivadas de
  `segmentLengths`, no hay cotas libres). Nuevo `kind: 'cota'` en Object
  Engine.
- **Cota angular:** 3 puntos (vértice + 2 lados), dibuja arco+valor en
  grados — reusa `arcMath.ts` de la Fase 2.4.
- **Radio/Diámetro:** trivial una vez que existan círculos (Fase 2.3):
  leer el radio de la geometría `Circle` de OL directamente.
- **Anti-colisión de labels:** hoy `drawSegmentLabels` puede solapar
  texto en polígonos muy densos (no hay ningún chequeo de colisión, cada
  label se dibuja en su posición calculada sin verificar overlap con
  otros). Implementar un chequeo simple de bounding-box de texto (ya se
  calcula `ctx.measureText` en `styleFactory.ts`) contra un `Set` de boxes
  ya dibujadas en el mismo frame de postrender; si colisiona, desplazar
  perpendicularmente o suprimir según threshold de zoom.

**Depende de:** Fase 2 (círculos para radio/diámetro), Fase 1.1 (nuevo
`kind: 'cota'`).

**Esfuerzo:** M.

---

## Fase 7 — Advanced Geometry Engine: cerrar lo "fantasma"

Esta fase tiene el mayor ratio impacto/esfuerzo porque varias piezas
**ya existen pero no están conectadas end-to-end**.

### 7.1 Ochavas (fillets) aplicadas de verdad
Hoy `streetEngine.ts::computeStreetFillets` + `filletArcPoints` **solo se
dibujan en el canvas de postrender** (`Map.tsx`, sección "Fillets
cacheados") — es decoración visual sobre el mapa base, no recorta la
geometría real de manzanos/lotes. Para que el DXF/SHP exportado tenga las
ochavas de verdad:
- En `recomputeManzanos()` (`mapStore.ts`), después de
  `clipPolygonByAllStreets`, aplicar un segundo recorte con los polígonos
  de fillet calculados por `computeStreetFillets` (convertir cada
  `StreetFillet` a un polígono cerrado vía `filletArcPoints` + el
  `corner`, y usar `subtractFeatures`/`OverlayOp.difference` del worker
  JSTS para restar la cuña de esquina del manzano).
- Esto convierte "Ochavas" de 🟡 visual a 🟢 real, y usa exactamente el
  worker JSTS que ya existe (`geoOperations.ts`).

### 7.2 Calles curvas y radios manuales
- Hoy `Street { start, end, widthM }` es siempre recta. Extender a
  `Street { start, end, widthM, curvature?: number }` (curvatura como
  offset del punto medio, igual que un `Circle`-arc de 3 puntos) o, más
  simple, permitir insertar vértices intermedios (`waypoints: [number,
  number][]`) y trazar con `Draw type: 'LineString'` sin `maxPoints: 2`
  (hoy `Map.tsx` fija `maxPoints: 2` explícitamente en modo `'street'`).
- Radio manual de fillet: `getFilletRadiusForAngle` en `streetEngine.ts`
  hoy es una tabla fija por ángulo — exponer como override editable en
  `StreetWidthPanel.tsx` (`Toolbar.tsx`).

### 7.3 Áreas verdes / equipamiento como herramienta real
`StatsPanel.tsx` ya lee y grafica `feature.get('type') === 'equipamiento'`
pero **no existe ningún flujo para crear ese tipo de feature** — es código
muerto/preparado a la espera de la herramienta. Implementar:
- Nuevo modo de dibujo (o reutilizar `'polygon'` con un selector previo de
  "clase de área": lote / manzana / equipamiento / área verde), seteando
  `kind` en el Object Engine.
- Regla de negocio opcional: al `subdivideManzanoAuto`, permitir reservar
  un % de área como equipamiento (parámetro nuevo en
  `SubdivisionOptions`), acorde a normativa urbanística típica.

### 7.4 Validación: superposiciones y huecos
`validateTopology` (`geoOperations.ts`) hoy solo llama `geom.isValid()`
por feature — no detecta que dos lotes válidos se solapen entre sí, ni
huecos entre manzanos contiguos. Agregar:
- **Superposiciones:** pairwise `OverlayOp.intersection` entre features
  del mismo `kind` (usar el `SpatialIndex`/RBush ya existente en
  `demoDataset.ts` para no comparar todos contra todos) — si el área de
  intersección > epsilon, reportar.
- **Huecos:** unión de todos los manzanos de una zona vs. su envolvente
  convexa/`buffer(0)`, diferencia > epsilon → hueco. Requiere el `buffer`
  del punto 3.3 (Fase 3, Offset) en el worker.

**Depende de:** Fase 1 (Command Engine, para que el recorte de ochavas
pase por un comando y sea deshacible), Fase 3.3 (buffer en worker, para
detección de huecos).

**Esfuerzo:** L. **Alta prioridad** por el ratio impacto/esfuerzo (7.1 y
7.3 son casi solo "conectar cables").

---

## Fase 8 — Import/Export: cerrar formatos

### 8.1 DXF — cobertura de entidades
`src/io/dxf.ts::entityToFeature` solo mapea `LWPOLYLINE/POLYLINE/LINE/POINT`.
`OBJETIVO.md` promete explícitamente: `ARC, CIRCLE, TEXT, MTEXT, BLOCK,
INSERT, HATCH, DIMENSION, SPLINE`. Priorizar en este orden (por qué tan
factible es con `dxf-parser`/`dxf-writer` y qué tan usado es en un flujo
urbanístico real):
1. `CIRCLE`, `ARC` — directo una vez exista geometría circular/arco propia
   (Fase 2.3/2.4), mapeo 1:1.
2. `TEXT`/`MTEXT` — directo una vez exista `kind: 'texto'` (Fase 2.5).
3. `INSERT`/`BLOCK` — mapear a un grupo de features con un `groupId`
   común (no hay "bloques" reales en el modelo, se aproxima).
4. `HATCH` — mapear a `Polygon` con patrón de relleno como metadata
   (renderizado real de hachurado queda fuera de alcance de esta fase,
   solo se preserva geometría+intención).
5. `DIMENSION` — mapear a `kind: 'cota'` (Fase 6).
6. `SPLINE` — aproximar a `LineString` por muestreo (menor prioridad, uso
   poco frecuente en planos de lotización).

### 8.2 GeoPackage — exportación
El propio código ya marca el hueco:
```ts
export async function exportGpkg(_project: GeoUrbanProject): Promise<never> {
  throw new Error('Exportación GPKG pendiente de implementación completa (Fase 6)');
}
```
Implementar con `sql.js` (ya es dependencia, hoy solo se usa para
**leer**): crear la base `gpkg_contents`/`gpkg_geometry_columns`/
`gpkg_spatial_ref_sys` mínimas + tabla de features con blobs WKB (el
parser inverso de `parseWkbGeometry` en `gpkg.ts` ya existe — falta el
serializador `geometryToWkb`, su contraparte simétrica).

### 8.3 PDF / SVG / PNG
- **PNG:** el más barato — `map.getRenderer()` de OpenLayers permite
  `map.once('rendercomplete', () => canvas.toBlob(...))` sobre el canvas
  compuesto. Casi sin código nuevo.
- **SVG:** exportar directamente las geometrías (no el mapa rasterizado)
  iterando `drawSource.getFeatures()` y generando `<path>` a mano
  (coordenadas ya están en `EPSG:3857`, transformar igual que
  `metrics.ts::projectRingToMetricPlane` para consistencia de escala).
- **PDF:** agregar `pdf-lib` (declarado en el stack, ausente en
  `package.json`) — combina el PNG del mapa + metadata (nombre de
  proyecto, fecha, CRS) en una página. Esta pieza es prerequisito directo
  de la **Fase 9 (Layout Engine)**, así que puede diferirse y resolverse
  junto a esa fase en vez de aislada.

**Esfuerzo:** L (8.1), M (8.2), S (8.3-PNG/SVG) + ver Fase 9 para PDF.

---

## Fase 9 — Layout Engine (0% implementado)

Es el motor completo ausente del doc: "Plano General, Plano Individual,
Carimbo, Leyenda, Escala, Norte, Cuadro de coordenadas, Cuadro de
superficies". No hay ni un componente relacionado hoy.

### 9.1 Modelo de layout
- Nuevo store `src/store/layoutStore.ts`: `LayoutSheet { id, size: 'A4'|'A3'|..,
  scale: number, elements: LayoutElement[] }`, donde `LayoutElement` es
  `{ type: 'mapViewport' | 'titleBlock' | 'legend' | 'northArrow' |
  'scaleBar' | 'coordTable' | 'areaTable', x, y, w, h, config }`.

### 9.2 Componentes de layout (todos nuevos)
- `MapViewport`: renderiza un recorte del mapa actual a una escala fija
  (reusa la lógica de exportación PNG de la Fase 8.3, pero con extensión
  y escala explícitas en vez de "toda la vista").
- `TitleBlock` (carimbo): formulario simple (nombre de proyecto, escala,
  fecha, CRS activo — leído de `projectCrsStore`).
- `Legend`: itera `layersRegistryStore` (Fase 5) y dibuja swatches
  color+label — reusa la lista de colores que hoy está hardcodeada en
  `StatsPanel.tsx` (`MZN_COLORS`).
- `NorthArrow`: SVG estático, rotable según orientación del CRS (trivial
  si el proyecto está en UTM norte-arriba, que es el caso por defecto).
- `ScaleBar`: cálculo de longitud de barra según `resolution` del mapa
  (mismo patrón que `cadGridLayer.ts::snapSpacing`, que ya resuelve un
  problema análogo — "distancia bonita" en metros según zoom).
- `CoordTable`: tabla de vértices del feature seleccionado (los datos ya
  existen: `PropertyPanel.tsx` ya itera `segmentLengths`, solo falta
  también extraer coordenadas de vértice, no solo longitudes de lado).
- `AreaTable`: agregación por `kind` (lote/manzana/equipamiento) — mismo
  cálculo que ya hace `StatsPanel.tsx::computeStats`, reempaquetado como
  tabla imprimible.

### 9.3 Exportación final
- `Layout → PDF` usando `pdf-lib` (agregar a `package.json`): compone
  cada `LayoutElement` como bloque dentro de la página con el tamaño de
  papel elegido.

**Depende de:** Fase 5 (Layer Engine, para leyenda real), Fase 8.3 (PNG
del mapa como base del viewport de layout).

**Esfuerzo:** XL. Es, junto con Fase 3, el trabajo más grande del plan,
pero es completamente aislable del resto (no bloquea ni es bloqueado por
Fases 2–7): puede desarrollarse en paralelo por otra persona/rama.

---

## Fase 10 — Storage Engine: SQLite real + multi-proyecto

Hoy: `src/io/persistence.ts` usa Dexie sobre IndexedDB con un único slot
de autosave (`db.projects.orderBy('id').reverse().first()` — siempre
sobreescribe el más reciente, no hay lista de proyectos).

### 10.1 SQLite nativo en Tauri (desktop)
- Agregar `tauri-plugin-sql` (Rust, `src-tauri/Cargo.toml`) +
  `@tauri-apps/plugin-sql` (JS).
- Nuevo `src/io/persistenceDesktop.ts`: mismo contrato que
  `persistence.ts` (`autosaveProject`, `startAutosave`) pero sobre SQLite
  real vía el plugin, seleccionado en runtime según
  `window.__TAURI__` (o el equivalente check ya usado implícitamente por
  `TAURI_PLATFORM` en `vite.config.ts`).
- Mantener Dexie como fallback para el build web (`deploy-pages.yml` ya
  compila un target puramente web sin Tauri).

### 10.2 Gestor multi-proyecto
- Tabla `projects(id, name, updated_at, thumbnail?)` + tabla
  `project_data(project_id, geourban_json)`.
- Nuevo componente `ProjectBrowserModal.tsx` (patrón similar a
  `ProjectSetupModal.tsx` ya existente): lista de proyectos, abrir/nuevo/
  duplicar/eliminar.
- `TopBar.tsx::handleImport/handleExport` pasan a convivir con "Guardar
  como proyecto" (nombre) en vez de solo archivo suelto `.geourban`.

### 10.3 GeoPackage como backend real (opcional, post-10.1)
- Una vez exista `exportGpkg` (Fase 8.2) con serialización WKB completa,
  evaluar usar `.gpkg` como formato de guardado nativo del proyecto en
  vez de JSON — da compatibilidad directa con QGIS para abrir el archivo
  de trabajo sin exportar. **No bloqueante**, evaluar solo si hay pull
  real de usuarios QGIS.

**Depende de:** Fase 8.2 solo para el punto 10.3 (opcional).

**Esfuerzo:** M (10.1+10.2), el 10.3 es opcional/futuro.

---

## Fase 11 — Refactor del Render Engine (deuda técnica, no feature nueva)

`src/map/Map.tsx` mezcla en un solo componente de +900 líneas:
inicialización del mapa, capas base, capa WebGL, capa de mediciones,
capa de calles, postrender canvas (labels+cotas+fillets+snap guides),
tracking de cursor/zoom, spatial index, y wiring de interacciones por modo
(`select/edit/polygon/street/erase`) en un único `useEffect([drawMode])`.

Esto no es urgente funcionalmente, pero **cada fase de arriba que toque
`Map.tsx`** (2, 3, 4, 7.1) va a volverlo más grande si no se parte antes.
Recomendado ejecutar **en paralelo con la Fase 1**, ya que ambas son
refactors fundacionales sin UI nueva visible:

- `src/map/scene/BaseLayerManager.ts` — hoy disperso entre
  `baseLayerRef`, `baseLayerCleanupRef`, el `useEffect([baseMapId])`.
- `src/map/scene/DrawLayerRenderer.ts` — la construcción de las
  expresiones `match` de color WebGL (`mznFillExpr`, `mznStrokeExpr`).
- `src/map/scene/PostrenderPainter.ts` — todo el `postRenderHandler`
  (labels, calles, fillets, snap guides) como clase con métodos separados
  por responsabilidad, en vez de una función de 300+ líneas.
- `src/map/scene/InteractionModeController.ts` — el `useEffect([drawMode])`
  completo, con una función `activate(mode)` por modo en vez de un switch
  gigante inline.
- `Map.tsx` queda como orquestador delgado que instancia estas clases.

**Esfuerzo:** M, pero **alto ROI en velocidad de las fases siguientes.**

---

## Fase 12 — Testing y CI

`package.json` ya tiene `vitest` configurado (`test`, `test:watch`) pero
no se detectan archivos de test en el árbol provisto. Riesgo concreto:
`subdivisionAlgorithms.ts` y `polygonEngine.ts` son matemática numérica
densa (bisección, PCA, clipping de semiplanos) portada de un proyecto
anterior — exactamente el tipo de código que se rompe silenciosamente con
refactors y no se nota hasta producción.

### 12.1 Prioridad de cobertura (por riesgo, no por facilidad)
1. `polygonEngine.ts` — `polyArea`, `clipHalfPlane`, `clipToStrip`,
   `principalAxis`, `buildCutPolys` (funciones puras, fáciles de testear
   con polígonos conocidos: cuadrado, L-shape, etc.)
2. `subdivisionAlgorithms.ts` — `subdivideManzanoAuto/Exact` sobre
   polígonos sintéticos con área/frente esperados verificables.
3. `geo/metrics.ts` — `planarArea`/`planarPathLength` contra casos con
   resultado conocido a mano.
4. `geo/utmZones.ts` — `utmZoneFromLonLat` contra tabla de zonas
   conocidas.
5. `map/advancedSnap.ts` — `findSnap` con fixtures de segmentos y cursor,
   verificando prioridad de tipos (`SNAP_TYPE_PRIORITY`).

### 12.2 CI
Los workflows existentes (`release-tauri.yml`, `deploy-pages.yml`) solo
corren en `push` de tags/`main` — **no hay validación en Pull Request**.
Agregar `.github/workflows/ci.yml`:
```yaml
on: [pull_request]
jobs:
  check:
    steps:
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit
      - run: npm run test
```

**Esfuerzo:** M, continuo (no es una fase que "termina").

---

## Fase 13 — Performance y escalabilidad (post-fases funcionales)

Solo abordar una vez que Fases 1–9 estén razonablemente cerradas, porque
optimizar prematuramente sobre una arquitectura que todavía va a cambiar
(Command Engine, Layer Engine) es desperdiciar trabajo.

- **Worker pool:** hoy `geoWorkerClient.ts` usa un único `Worker` global
  (`getWorker()`), operaciones JSTS pesadas (union de N polígonos grandes)
  bloquean secuencialmente entre sí. Evaluar pool de 2-4 workers para
  proyectos grandes.
- **LOD real:** el "LOD Manager" del doc no existe; hoy la única
  adaptación por zoom es mostrar/ocultar labels (`zoom > 15.5` hardcodeado
  en `Map.tsx`). Para proyectos con miles de lotes, evaluar simplificación
  de geometría (Douglas-Peucker) a bajo zoom antes de pasar a WebGL.
- **Undo incremental:** retomar la nota de la Fase 1 — una vez que
  `CommandStack` esté estable, migrar el almacenamiento interno de
  snapshots completos a diffs por comando.

**Esfuerzo:** evaluar caso a caso, no es una fase de alcance fijo.

---

## 14. Orden de ejecución recomendado

```
Fase 0 (doc)  ──┐
                ├──► Fase 1 (Command+Object Engine) ──┬──► Fase 2 (Draw)
Fase 11 (refactor Map.tsx, en paralelo a Fase 1) ──────┤    Fase 3 (Edit)
                                                        ├──► Fase 4 (Selection)
                                                        ├──► Fase 5 (Layers)
                                                        ├──► Fase 6 (Dimension manual)
                                                        └──► Fase 7 (Ochavas reales, equip.)
                                                                  │
Fase 8 (Import/Export formatos) ── en paralelo, sin dependencia ─┤
                                                                  │
Fase 9 (Layout Engine) ── en paralelo, solo depende de 5 y 8.3 ──┤
Fase 10 (SQLite/multi-proyecto) ── en paralelo, independiente ───┤
                                                                  ▼
                                                    Fase 12 (Testing, continuo desde Fase 1)
                                                    Fase 13 (Performance, al final)
```

**Recomendación concreta de arranque:** Fase 0 (1 día, solo doc) → Fase 1
+ Fase 11 en paralelo (son las dos únicas fases 100% de arquitectura, sin
UI nueva, y desbloquean todo lo demás) → luego Fase 7 antes que 2/3
(porque 7.1 y 7.3 son "conectar cables" de código que ya existe, dan
resultado visible rápido con poco riesgo) → recién ahí Draw/Edit/Selection/
Layers en el orden que el negocio priorice.

---

## Anexo A — Mapeo archivo → gap detectado

| Archivo | Gap relacionado |
|---|---|
| `src/store/historyStore.ts` | Fase 1 — snapshot completo, no comandos |
| `src/components/Toolbar.tsx` | Fase 1 — mutación directa de `drawSource` en 3 handlers |
| `src/components/SubdivisionDialog.tsx` | Fase 1 — ídem en `applySubdivision` |
| `src/store/mapStore.ts` | Fase 1 (comandos) y Fase 7.1 (`recomputeManzanos` sin ochavas reales) |
| `src/store/drawStore.ts` | Fase 2.1 — `'polyline'` sobrecargado como línea Y polígono |
| `src/map/Map.tsx` | Fase 11 (tamaño/responsabilidades) + puntos de extensión de Fases 2/3/4 |
| `src/map/advancedSnap.ts` | Fase 2.3 (`center`/`tangent` faltantes), inconsistencia `'grid'` en comentarios vs. `SnapType` |
| `src/store/layerStore.ts` | Fase 5 — reemplazar por `layersRegistryStore` |
| `src/workers/geoOperations.ts` | Fase 3 (`subtract`/`intersect` sin UI), Fase 7.4 (falta `buffer`) |
| `src/io/dxf.ts` | Fase 8.1 — cobertura de entidades DXF |
| `src/io/gpkg.ts` | Fase 8.2 — `exportGpkg` marcado como pendiente en el propio código |
| `src/geo/streetEngine.ts` | Fase 7.1/7.2 — fillets solo visuales, calles solo rectas |
| `src/components/StatsPanel.tsx` | Fase 7.3 — ya consume `kind: 'equipamiento'` que nadie produce |
| `src-tauri/Cargo.toml` | Fase 10.1 — falta `tauri-plugin-sql` |
| `package.json` | Fase 9 — falta `pdf-lib` (declarado en `OBJETIVO.md`, ausente en deps) |
| *(sin archivos de test en el árbol)* | Fase 12 |

## Anexo B — Dependencias npm nuevas por fase

| Fase | Paquete | Motivo |
|---|---|---|
| 3 (Offset) | — | Ya cubierto por `jsts` (`BufferOp`), solo falta exponerlo |
| 9 (PDF) | `pdf-lib` | Declarado en `OBJETIVO.md`, cero uso actual |
| 10 (SQLite Tauri) | `@tauri-apps/plugin-sql` (JS) + `tauri-plugin-sql` (Rust, `Cargo.toml`) | SQLite nativo desktop |
| 12 (Testing) | Ninguna nueva | `vitest` ya está en `devDependencies` |

---

*Documento generado a partir de la comparación entre `OBJETIVO.md` y el
árbol de código provisto (React 19, Zustand, OpenLayers 10, Tauri 2,
JSTS, proj4, Dexie, sql.js).*
