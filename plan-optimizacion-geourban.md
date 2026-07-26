# Diagnóstico y Plan de Optimización — GeoUrban

**Alcance revisado:** `src/`, `src-tauri/`, `package.json`, `components.json`.
**Objetivo:** identificar archivos/código innecesario, duplicación, y proponer una reorganización de carpetas que reduzca deuda técnica sin reescribir la lógica de negocio (motores geométricos, comandos, etc.).

---

## 1. Resumen ejecutivo

El proyecto tiene una arquitectura de fondo sólida (Command Pattern con undo/redo, Web Workers para geometría pesada, spatial index propio, sistema de snapping tipo CAD). El problema no es la lógica de dominio — es **higiene de proyecto**:

| Categoría                                                                   | Severidad     | Cantidad aprox.               |
| --------------------------------------------------------------------------- | ------------- | ----------------------------- |
| CSS duplicado literalmente (mismo bloque 4 veces)                           | 🔴 Alta       | 1 archivo, 4 repeticiones     |
| Nombres de store casi idénticos y confundibles                              | 🔴 Alta       | 2 pares                       |
| Doble fuente de verdad para el mismo estado                                 | 🔴 Alta       | 1 caso (visibilidad de capas) |
| Componente/exportación muerta (no importada nunca)                          | 🟠 Media      | ≥2                            |
| Lógica matemática reimplementada en 3-4 lugares distintos                   | 🟠 Media      | ~5 funciones                  |
| Estilos inline repetidos entre componentes (`inputStyle`, headers de panel) | 🟠 Media      | ~10 archivos                  |
| Iconos SVG hechos a mano duplicando `lucide-react` (ya instalado y usado)   | 🟡 Media-baja | ~5 archivos                   |
| Tailwind/shadcn/Radix configurados pero no usados en la práctica            | 🟡 Media-baja | Todo `components/`            |
| Carpetas planas que ya deberían subdividirse por dominio                    | 🟡 Media-baja | `geo/`, `store/`, `commands/` |
| Dependencias con versiones a verificar                                      | ⚪ Verificar  | 4-5 paquetes                  |

Ninguno de estos requiere reescribir el motor de subdivisión ni el sistema de comandos. Es limpieza + reorganización + consolidación de utilidades repetidas.

---

## 2. Hallazgos críticos (con evidencia)

### 2.1 `src/index.css` — el mismo bloque CSS duplicado 4 veces

El bloque de la clase `.cad-spinner` y su `@keyframes cadSpin` está definido **cuatro veces** en el mismo archivo (líneas dispersas entre las secciones "Animations", después de `.animate-fade-in`, etc.). No es solo desprolijo: cada duplicado puede pisar al anterior según el orden de cascada, y aumenta el peso del CSS final sin ningún beneficio.

**Acción:** dejar una sola definición cerca de `:root`/utilidades, borrar las otras 3 copias.

### 2.2 Colisión de nombres: `useLayerStore` vs `useLayersStore`

- `src/store/layerStore.ts` → exporta **`useLayerStore`** (singular). Contiene: `baseMap`, `workVisibility`, `panelVisibility`, `gridOrigin`, `statsPanelVisible`, `activeTab`, `ribbonCollapsed`.
- `src/store/layersRegistryStore.ts` → exporta **`useLayersStore`** (plural). Contiene el registro real de capas (`Layer[]`, `zIndex`, `color`, `locked`, `activeLayerId`).

Son dos conceptos distintos (estado de UI/ribbon vs. modelo de datos de capas) con nombres que difieren en **una sola letra**. Esto es una fuente garantizada de errores al importar el hook equivocado, y ya se nota en el propio código: `Map.tsx` y `LayerPanel.tsx` necesitan lógica de sincronización manual entre ambos (ver 2.3).

**Acción:** renombrar `layerStore.ts` → algo que no contenga "layer", p. ej. `uiShellStore.ts` o `viewportPrefsStore.ts` (su contenido real es "preferencias de UI/ribbon/mapa base", no "capas").

### 2.3 Doble fuente de verdad: visibilidad de capas

`layerStore.workVisibility` (booleans `lots/streets/measurements`) duplica lo que ya expresa, con más granularidad, `layersRegistryStore.layers[].visible` (por capa individual, con `kind`).

Evidencia de que esto ya es un problema real, no hipotético:

- `LayerPanel.tsx` tiene una función `syncLegacyVisibility()` dedicada solo a mantener ambos stores coordinados.
- `Map.tsx` tiene **dos efectos separados** reaccionando a visibilidad: uno sobre `workVisibility.streets`/`workVisibility.lots` (vía `layerStore`) y otro suscrito a `layersRegistryStore` que vuelve a calcular `anyLoteVisible`/`anyCalleVisible` y volver a llamar `setVisible(...)` sobre las mismas capas.

Esto es exactamente el patrón que genera bugs de "cambié el toggle y no se actualizó" o "se actualiza dos veces con parpadeo".

**Acción:** eliminar `workVisibility` de `layerStore` y derivar esos tres booleans como selector sobre `layersRegistryStore` (`hasKindVisible('lote')`, etc., que **ya existe** en `layersRegistryStore`). Borrar toda la lógica de sincronización manual.

### 2.4 Componente huérfano: `TopologyValidator.tsx`

`src/components/TopologyValidator.tsx` llama a `useMapStore().validateProjectTopology`, pero **no está importado en ningún lugar** de `App.tsx` ni de otro componente provisto. Todo el flujo de validación de topología automática ya corre en background vía `checkTopologyInBackground()` / `useTopologyWarningsStore`, que sí se ve en `StatusBar.tsx`. Este componente parece un remanente de una versión anterior (validación manual con botón) que quedó reemplazada.

**Acción:** confirmar si se usa en alguna vista no incluida aquí; si no, eliminarlo. Si se quiere mantener como "validación manual on-demand", integrarlo explícitamente (p. ej. como acción del ribbon en la pestaña "Editar", donde ya existen botones de "Overlaps"/"Huecos").

### 2.5 `src/geo/customProjections.ts` probablemente redundante

Registra a mano, al arrancar la app (`main.tsx`), solo dos zonas UTM fijas (`EPSG:32719`, `EPSG:32720`) y exporta `UTM_19S` — que **no se usa en ningún otro archivo** del proyecto. Todo el resto del código (métricas, DXF, GPKG, `ProjectSetupModal`) ya usa el mecanismo dinámico y perezoso `ensureUtmZoneRegistered()` de `geo/utmZones.ts`, que cubre las 120 zonas posibles, no solo 2.

**Acción:** auditar si algo depende de que esas 2 zonas estén pre-registradas antes de cualquier interacción del usuario. Si no, eliminar el archivo y su import en `main.tsx`.

### 2.6 Lógica matemática reimplementada en 3–4 lugares distintos

La misma operación ("longitud de un camino como suma de `Math.hypot` entre puntos consecutivos") aparece de forma independiente en:

1. `geo/polygonEngine.ts` → `ringPerimeter()` (para anillos **cerrados**, con wraparound).
2. `geo/metrics.ts` → `planarPathLength()` (función privada, casi idéntica, para paths **abiertos**).
3. `components/StreetPanel.tsx` → `streetLengthM()` (reimplementada localmente para calles).
4. `map/Map.tsx` → dentro del callback de `RotateLotsInteraction`, un `for` inline que vuelve a sumar `Math.hypot(...)` para el perímetro.

Y el convex hull aparece duplicado **dentro del mismo archivo**:

- `geo/subdivisionCabeceraCuerpo.ts` tiene `convexHull(pts)` (monotone chain) cerca del inicio, y más abajo, dentro de `hbMergeHeadRemainders()`, la función interna `mergePolys(a, b)` vuelve a implementar el mismo algoritmo de monotone chain (lower/upper hull) para fusionar dos polígonos.

Y el generador de IDs incrementales módulo-a-módulo aparece duplicado:

- `commands/AddFeatureCommand.ts` → `_idCounter` + `nextId(prefix)`.
- `geo/transforms.ts` → `_idCounter` + `nextId(prefix)` (mismo nombre, misma firma, archivo distinto).

**Acción:** centralizar en `geo/polygonEngine.ts`:

- `pathLength(pts: Pt[]): number` (abierto) reutilizado por `metrics.ts`, `StreetPanel.tsx` y `Map.tsx`.
- Extraer `convexHull(pts: Pt[])` como única función y que `mergePolys` la reutilice.

Centralizar en un nuevo `src/lib/id.ts`:

- `createIdFactory(prefix: string)` → reemplaza los dos `nextId()` idénticos.

### 2.7 Formato de área inconsistente entre paneles (bug silencioso)

`geo/metrics.ts::formatMetricArea()` es la función "oficial" (umbral de 10.000 m² para pasar a hectáreas, 2 decimales). `StatsPanel.tsx` define su **propia** `formatArea()` local con el mismo umbral pero **1 decimal** para m² en vez de 2. Resultado: la misma superficie puede mostrarse con distinta precisión según qué panel la muestre (`PropertyPanel`/`ManzanoPanel` vs. `StatsPanel`).

**Acción:** eliminar `formatArea()` de `StatsPanel.tsx` e importar `formatMetricArea` de `geo/metrics.ts`.

---

## 3. Reorganización de carpetas propuesta

Las carpetas `geo/`, `store/` y `commands/` están **planas** (15, 16 y 13 archivos respectivamente) mezclando dominios distintos. Con Tauri + un dominio tan específico (CRS, subdivisión, vialidad, snapping CAD), subdividir por dominio mejora mucho la navegabilidad sin tocar lógica.

### 3.1 `src/geo/` (15 archivos → 5 subcarpetas)

```
geo/
├── crs/
│   ├── customProjections.ts      (revisar si se elimina, ver 2.5)
│   ├── utmZones.ts
│   ├── crsTransform.ts
│   └── projections.ts
├── math/
│   ├── polygonEngine.ts          (+ pathLength, + convexHull compartido)
│   ├── arcMath.ts
│   └── lod.ts
├── subdivision/
│   ├── subdivisionAlgorithms.ts
│   ├── subdivisionCabeceraCuerpo.ts
│   └── subdivisionMethodLabels.ts
├── roads/
│   ├── streetEngine.ts
│   ├── roadNetworkEngine.ts
│   └── ringFillet.ts
├── roundabout/
│   └── roundaboutEngine.ts
└── metrics.ts                     (transversal, queda en raíz de geo/)
```

### 3.2 `src/store/` (16 archivos → agrupar por dominio, sin cambiar Zustand)

```
store/
├── project/
│   ├── projectCrsStore.ts
│   └── currentProjectStore.ts
├── map/
│   ├── mapStore.ts                (ver 4.2 — separar orquestación)
│   ├── drawStore.ts
│   ├── selectionStore.ts
│   ├── snapLiveStore.ts           (renombrado desde snapStateStore.ts)
│   └── snapSettingsStore.ts
├── entities/
│   ├── streetStore.ts
│   ├── roundaboutStore.ts
│   ├── manzanoStore.ts
│   └── layersRegistryStore.ts
├── ui/
│   ├── uiShellStore.ts            (renombrado desde layerStore.ts, sin workVisibility)
│   ├── subdivisionStore.ts
│   ├── subdivisionPreviewStore.ts
│   ├── generateLotsProgressStore.ts
│   └── recomputeStatusStore.ts
└── topologyWarningsStore.ts
```

### 3.3 `src/commands/` (13 archivos → agrupar por dominio de negocio)

```
commands/
├── core/
│   ├── Command.ts
│   ├── CommandStack.ts
│   ├── drawSourceSnapshot.ts
│   └── memoryEstimate.ts
├── features/
│   ├── AddFeatureCommand.ts
│   ├── AddFeaturesCommand.ts
│   ├── DeleteFeaturesCommand.ts
│   ├── ModifyGeometryCommand.ts
│   └── ClearFeaturesCommand.ts
├── roads/
│   ├── AddStreetCommand.ts
│   └── AddRoundaboutCommand.ts
└── lots/
    ├── SubdivideCommand.ts
    ├── GenerateLotsCommand.ts
    └── RecomputeManzanoLotsCommand.ts
```

### 3.4 `src/components/` (12 archivos → separar por rol)

```
components/
├── layout/
│   ├── TopBar.tsx
│   └── StatusBar.tsx
├── panels/
│   ├── SnapPanel.tsx
│   ├── ManzanoPanel.tsx
│   ├── RoundaboutPanel.tsx
│   ├── StreetPanel.tsx
│   ├── PropertyPanel.tsx
│   ├── StatsPanel.tsx
│   └── LayerPanel.tsx
├── modals/
│   ├── ProjectBrowserModal.tsx
│   ├── ProjectSetupModal.tsx
│   └── SubdivisionDialog.tsx
└── icons/
    └── (ver sección 4.3 — consolidar íconos SVG hechos a mano)
```

> Nota: con ~12-16 archivos por carpeta esto es "opcional pero recomendable"; con `commands/` y `store/` (13-16 archivos, creciendo con cada feature nueva) ya es un punto de dolor real hoy, no solo preventivo.

---

## 4. Deuda técnica de UI

### 4.1 Estilos inline duplicados

Los mismos objetos de estilo (`inputStyle`, `inputStyleSmall`, patrones de header de panel con botón "✕", `sectionTitleStyle`, `rowStyle`/`valueStyle`) están **copiados casi textualmente** en:

`ManzanoPanel.tsx`, `StreetPanel.tsx`, `RoundaboutPanel.tsx`, `PropertyPanel.tsx`, `SubdivisionDialog.tsx`, `ProjectSetupModal.tsx`, `StatusBar.tsx`.

Ya existen clases CSS reales para gran parte de esto en `index.css` (`.cad-panel-glass`, `.cad-icon-btn`, `.cad-toggle`) pero los inputs numéricos y los headers de panel se siguen reescribiendo a mano en cada componente.

**Acción:** crear `src/index.css` clases `.cad-input`, `.cad-input-sm`, `.cad-panel-header`, `.cad-section-title`, `.cad-row`, `.cad-row-value`; o alternativamente un componente `<PanelHeader title onClose />` y `<CadInput />` reutilizable en `components/ui/`. Esto elimina fácilmente 300-500 líneas duplicadas.

### 4.2 Patrón "tick" para re-render en cambios de `drawSource`

`ManzanoPanel.tsx` y `StatsPanel.tsx` implementan **el mismo** `useEffect` (suscribirse a `addfeature`/`removefeature`/`change` del `VectorSource` y hacer `setTick(n => n+1)`) de forma independiente, con el mismo comentario explicando por qué hace falta.

**Acción:** extraer a `hooks/useDrawSourceTick.ts`:

```ts
export function useDrawSourceTick(drawSource: VectorSource | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!drawSource) return;
    const bump = () => setTick((n) => n + 1);
    drawSource.on('addfeature', bump);
    drawSource.on('removefeature', bump);
    drawSource.on('change', bump);
    return () => {
      drawSource.un('addfeature', bump);
      drawSource.un('removefeature', bump);
      drawSource.un('change', bump);
    };
  }, [drawSource]);
  return tick;
}
```

### 4.3 Íconos SVG hechos a mano duplicando `lucide-react`

`lucide-react` está en `package.json` y **se usa** (p. ej. `ChevronUp`, `Trash2`, `ZoomIn` en `TopBar.tsx`/`StatusBar.tsx`). Pero en los mismos archivos (y en `SnapPanel.tsx`, `LayerPanel.tsx`) hay decenas de componentes `IconXxx` con SVG inline hechos a mano que ya tienen equivalente directo en lucide: cursor/puntero, ojo (`Eye`), candado (`Lock`), más (`Plus`), tacho (`Trash2`, ya importado en el mismo archivo), chevron (`ChevronRight`/`ChevronDown`).

**Acción:** reemplazar los íconos redundantes por sus equivalentes de `lucide-react`. Dejar SVG a mano únicamente para los íconos de dominio específico que no existen en ninguna librería (snap types: endpoint/midpoint/tangent/perpendicular, tipos de mapa base CAD/satélite, etc.), y mover esos a `components/icons/SnapIcons.tsx` / `components/icons/BaseMapIcons.tsx` en vez de estar definidos dentro de cada panel.

### 4.4 Tailwind + shadcn + Radix configurados pero no usados

`components.json` define alias completos de shadcn (`@/components/ui`, baseColor `slate`, cssVariables), y `package.json` incluye `@radix-ui/react-dialog`, `react-dropdown-menu`, `react-separator`, `react-slot`, `react-tooltip`, `class-variance-authority`, `tailwind-merge`, `tailwindcss-animate`. **Ningún componente provisto usa Tailwind classes ni Radix** — todos los modales (`ProjectBrowserModal`, `ProjectSetupModal`, `SubdivisionDialog`) están hechos a mano con `<div>` + `style={{}}` + overlay manual, duplicando lo que `@radix-ui/react-dialog` ya resolvería (foco, escape, aria).

**Acción — elegir una de dos:**

- **(A) Comprometerse con el stack ya instalado:** migrar los 3 modales a `Dialog` de Radix/shadcn, migrar `.cad-tooltip` a `Tooltip` de Radix, y usar clases Tailwind en vez de objetos `style`. Reduce bundle duplicado y unifica accesibilidad. Esfuerzo medio-alto.
- **(B) Desinstalar lo no usado:** si el equipo prefiere seguir con el sistema CSS manual (`cad-*` classes) que ya está bien resuelto visualmente, remover `@radix-ui/*`, `class-variance-authority`, `tailwind-merge`, `tailwindcss-animate` y simplificar `components.json`/`tailwind.config.cjs`. Esfuerzo bajo, reduce `node_modules` y superficie de configuración.

Cualquiera de las dos es mejor que el estado actual (pagar el costo de ambos sistemas sin usar ninguno a fondo).

---

## 5. Archivos/carpetas puntuales a revisar

| Archivo                        | Observación                                                                                | Acción sugerida                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `src/store/snapStateStore.ts`  | Exporta `useSnapLiveStore`, nombre de archivo no coincide                                  | Renombrar a `snapLiveStore.ts`                                                                                 |
| `src/io/persistenceDesktop.ts` | Funciones marcadas `@deprecated` en su propio comentario, delegan 100% a `projectStore.ts` | Confirmar que nada externo las usa y eliminar el archivo completo (`io/index.ts` deja de reexportarlas)        |
| `src/geo/projections.ts`       | 2 constantes en un archivo propio                                                          | Está bien tal cual, o fusionar dentro de `geo/crs/` (ver 3.1)                                                  |
| `src/types/vendor.d.ts`        | Declara tipos para 4 paquetes distintos en un solo archivo                                 | Opcional: dividir en `types/shpjs.d.ts`, `types/sql-js.d.ts`, `types/dxf.d.ts` si crece más                    |
| `src/map/baseMaps.ts`          | URLs de tiles de Google (`mt1.google.com/vt/lyrs=...`) sin API key, endpoint no oficial    | Riesgo de ToS/estabilidad; considerar Google Maps Platform oficial o un proveedor documentado (MapTiler, etc.) |
| `src-tauri/tauri.conf.json`    | `"csp": null` (CSP desactivada)                                                            | Definir una CSP explícita, sobre todo porque se cargan tiles remotos en el webview                             |

---

## 6. Archivos "God object" — candidatos a partir (sin tocar el algoritmo)

No es urgente, pero para cuando el proyecto siga creciendo:

- **`map/scene/PostrenderPainter.ts` (~750 líneas):** pinta calles, rotondas, guías de snap, preview de lasso, preview de subdivisión y labels de features, todo en una sola clase. Dividir en `StreetPainter`, `RoundaboutPainter`, `LabelPainter`, `SnapGuidePainter`, `SelectionOverlayPainter`, orquestados por un `PostrenderPainter` delgado.
- **`map/scene/InteractionModeController.ts` (~550 líneas):** un único método `activate()` con un `if` gigante por cada modo de dibujo. Extraer a un módulo por modo (`modes/PolygonMode.ts`, `modes/StreetMode.ts`, etc.), mismo patrón que ya usan bien en `commands/`.
- **`store/mapStore.ts` (~470 líneas):** mezcla la definición del store Zustand con toda la orquestación de `recomputeManzanosImmediate()` (decenas de líneas de lógica de negocio). Separar en `store/mapStore.ts` (solo estado) + `geo/recomputeManzanos.ts` (lógica).
- **`components/TopBar.tsx` (~700 líneas):** ~15 íconos SVG a mano + 4 pestañas de ribbon completas + handlers de import/export/proyecto, todo en un archivo. Separar en `ribbon/MapTab.tsx`, `ribbon/EditTab.tsx`, `ribbon/InsertTab.tsx`, `ribbon/ViewTab.tsx` + hook `useProjectActions()` para los handlers.
- **`components/ManzanoPanel.tsx` (~650 líneas):** extraer `readManzanoRows()` a un selector/hook, y la tarjeta de cada manzano a `ManzanoCard.tsx`.

---

## 7. Dependencias a verificar

Algunas versiones en `package.json` conviene confirmarlas contra el registry de npm antes de instalar en un entorno nuevo (podrían ser typos, o simplemente haber subido de major después de mi conocimiento):

- `lucide-react: ^1.23.0`
- `eslint: ^10.6.0`
- `@eslint/js: ^10.0.1`
- `globals: ^17.7.0`
- `eslint-plugin-react-hooks: ^7.1.1`

No implica que estén mal — solo que son números de versión inusualmente altos para esos paquetes según lo que conozco, y vale la pena un `npm view <paquete> versions --json` antes de un `npm ci` en CI/CD para evitar sorpresas.

---

## 9. Plan de acción priorizado

### Fase 0 — Quick wins (bajo riesgo, se puede hacer en una tarde)

1. Borrar las 3 copias duplicadas de `.cad-spinner`/`@keyframes cadSpin` en `index.css`.
2. Eliminar `formatArea()` local de `StatsPanel.tsx`, usar `formatMetricArea` de `geo/metrics.ts`.
3. Eliminar imports de tipos no usados en `io/index.ts` (`GeoJSONFeature`, `GeoJSONGeometry`, `LineString`, `Point`, `Polygon`).
4. Confirmar y eliminar `components/TopologyValidator.tsx` si efectivamente no se usa.
5. Renombrar `store/snapStateStore.ts` → `snapLiveStore.ts`.
6. Correr `eslint --fix` + revisar `tsc --noUnusedLocals` en todo el repo.

### Fase 1 — Des-confusión de stores (riesgo medio, alto impacto)

1. Renombrar `store/layerStore.ts` → `store/uiShellStore.ts` (hook `useUiShellStore`).
2. Eliminar `workVisibility` de ese store; reemplazar sus usos por selectores sobre `layersRegistryStore` (`hasKindVisible`).
3. Eliminar `syncLegacyVisibility()` de `LayerPanel.tsx` y el efecto duplicado en `Map.tsx`.
4. Verificar `io/persistenceDesktop.ts`: si nada externo lo usa, eliminarlo y limpiar `io/index.ts`.

### Fase 2 — Consolidar utilidades duplicadas (riesgo bajo, alto impacto acumulado)

1. Agregar `pathLength(pts)` y `convexHull(pts)` únicos en `geo/polygonEngine.ts`; hacer que `metrics.ts`, `StreetPanel.tsx`, `Map.tsx` y `subdivisionCabeceraCuerpo.ts` los reutilicen.
2. Crear `src/lib/id.ts` con `createIdFactory(prefix)`; reemplazar los `nextId()` duplicados en `AddFeatureCommand.ts` y `geo/transforms.ts`.
3. Extraer `hooks/useDrawSourceTick.ts` y usarlo en `ManzanoPanel.tsx` y `StatsPanel.tsx`.
4. Crear clases CSS `.cad-input`, `.cad-panel-header`, `.cad-section-title` y reemplazar los objetos `style` repetidos en los 7 archivos listados en 4.1.

### Fase 3 — Reorganización de carpetas (riesgo medio, requiere actualizar imports)

1. Mover archivos de `geo/` a las 5 subcarpetas propuestas (3.1). Usar un IDE con "update imports on move" o un script de `sed`/`ts-morph` para no romper referencias.
2. Repetir para `store/` (3.2) y `commands/` (3.3).
3. Reorganizar `components/` (3.4).

### Fase 4 — Decisión de stack de UI (esfuerzo alto, opcional)

1. Decidir entre comprometerse con Tailwind/shadcn/Radix (migrar modales e inputs) o desinstalarlos.
2. Si se migra: empezar por los 3 modales (`ProjectSetupModal`, `ProjectBrowserModal`, `SubdivisionDialog`) con `Dialog` de Radix, que es donde más se nota la falta de manejo de foco/escape.

### Fase 5 — Refactors de "God objects" (esfuerzo alto, solo si el equipo sigue creciendo el proyecto)

1. `PostrenderPainter.ts` → separar por tipo de pintado.
2. `InteractionModeController.ts` → un módulo por modo de dibujo.
3. `mapStore.ts` → separar estado de orquestación de recompute.
4. `TopBar.tsx` / `ManzanoPanel.tsx` → separar en subcomponentes + hooks de lógica.

---

## 10. Checklist resumen

- [ ] Limpiar CSS duplicado en `index.css`
- [ ] Renombrar `layerStore.ts` y eliminar `workVisibility` duplicado
- [ ] Eliminar `TopologyValidator.tsx` (si confirma huérfano) y `customProjections.ts` (si confirma redundante)
- [ ] Eliminar `io/persistenceDesktop.ts` (si confirma no usado)
- [ ] Unificar `pathLength`/`convexHull`/`nextId` en helpers compartidos
- [ ] Unificar formato de área/longitud (`formatMetricArea`/`formatMetricLength` como única fuente)
- [ ] Extraer `useDrawSourceTick`
- [ ] Crear clases CSS compartidas para inputs/paneles y borrar los `style` duplicados
- [ ] Reemplazar íconos SVG manuales por `lucide-react` donde exista equivalente
- [ ] Decidir sobre Tailwind/shadcn/Radix: usarlos de verdad o desinstalarlos
- [ ] Subdividir `geo/`, `store/`, `commands/`, `components/` por dominio
- [ ] Revisar versiones sospechosas en `package.json`
