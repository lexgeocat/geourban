# Plan de Optimización, Limpieza y Robustecimiento — GeoUrban

**Alcance del análisis:** este plan está construido leyendo en profundidad el código fuente TS/React (stores, comandos, motor de render OL, workers), el crate Rust `geourban-geo`, el puente Tauri, los tests (Vitest + Cargo), los fixtures de paridad, y la configuración de build/CI/lint provistos.

**Advertencia importante:** solo tengo visibilidad de los archivos compartidos en esta conversación, no de todo el repositorio real (por ejemplo, no vi el código de exportación DXF/SHP que sí aparece como dependencia en `package.json`, ni el historial de `auditoria-para-mejora.md` que se referencia en decenas de comentarios "Fase X.Y"). Por eso cada ítem de este plan trae un **nivel de confianza** (Alta / Media / Baja) y, cuando corresponde, un paso explícito de "verificar con grep en el repo completo antes de borrar". Ningún paso de este plan asume que algo es código muerto sin decir cómo confirmarlo.

**Principio rector:** ningún cambio de una fase debe requerir cambios de una fase posterior para no romper el build. Cada fase es un PR chico, revisable y revertible de forma independiente. El orden está pensado por relación riesgo/impacto, no por "lo más fácil primero".

---

## Resumen ejecutivo

El proyecto está en buen estado arquitectónico general: separación clara `store/` (entities/map/project/ui/debug), `commands/` con patrón Command + undo/redo con diffs estructurales (muy sólido), `geo/` con motor nativo Rust vía Tauri IPC, y una migración ya completada ("Fase 2.7") que retiró el motor de geometría JS en favor de GEOS/Rust. Eso es una base sana.

Los problemas reales que encontré caen en 4 categorías, de mayor a menor severidad:

1. **Instrumentación de debug/telemetría corriendo siempre en producción**, incluida en el hot-path de render (cada `postrender`), y un validador automático (`Fase6AutoValidator`) que intenta hacer `fetch` a `http://127.0.0.1:9876/results` si la URL trae un hash específico — código de arnés de testing viajando en el bundle de producción.
2. **Cero tests unitarios TS para la lógica más crítica y más compleja del proyecto** (`CommandStack`, `recomputeManzanos.ts`, `layersRegistryStore`, `advancedSnap.ts`), mientras que el lado Rust sí tiene buena cobertura.
3. **Lógica duplicada/fragmentada** en la resolución de capas (4 funciones distintas con jerarquías de fallback ligeramente distintas) y en `recomputeManzanos.ts` (700+ líneas, dos rutas — con y sin red vial — que repiten patrones de reconciliación de fragmentos).
4. **Deuda de tipado y de residuos históricos**: `@typescript-eslint/no-explicit-any` apagado globalmente, `any` disperso en componentes clave, y decenas de comentarios "Fase 2.2 / 5.3 / 6.4…" que documentan _cuándo_ se arregló algo en vez de _por qué_ el código es como es — útil como bitácora, pero debería vivir en un CHANGELOG, no en cada archivo.

No hay nada estructuralmente roto. El plan de abajo es de **endurecimiento y reducción de riesgo**, no de reescritura.

---

## Fase 0 — Salvaguardas antes de tocar nada

Objetivo: tener una red de seguridad antes de empezar a borrar o mover código.

- [ ] Crear branch base `chore/cleanup` desde `main`.
- [ ] Correr y guardar como referencia (baseline) la salida de:
  - `npm run lint`
  - `npm test` (Vitest)
  - `cd src-tauri && cargo test -p geourban-geo` (sin GEOS)
  - `cd src-tauri && cargo test -p geourban-geo --features geos-backend` (con GEOS)
- [ ] Guardar tamaño del bundle de producción actual (`npm run build` → tamaño de `dist/`) como referencia para medir el impacto de la Fase 2.
- [ ] Confirmar que `git grep` está disponible para las búsquedas de "¿esto se usa en algún lado?" que se piden en varias fases (yo solo pude grepear contra los archivos que me pasaste, no contra el repo real).
- [ ] Congelar temporalmente cualquier trabajo en curso sobre `recomputeManzanos.ts`, `layerPickerStore.ts` y `layerAutoCreate.ts` — son los tres archivos que se tocan en más de una fase de este plan (Fases 3, 4 y 9).

Riesgo: nulo. Es puro setup.

---

## Fase 1 — Auditoría de código muerto (solo lectura, cero cambios)

Objetivo: producir la lista definitiva de "esto se borra" antes de borrar nada, evitando el error clásico de limpiar por intuición.

### 1.1 — Candidatos a función/tipo muerto en `src/geo/math/polygonEngine.ts`

Este archivo mezcla utilidades geométricas que siguen viva (usadas por hit-testing, snapping, métricas) con lo que parece ser **remanente del motor de subdivisión en JS que el propio código dice haber retirado** ("Fase 2.7 — el motor JS (jsts/polygon-clipping) fue retirado"). Con la visibilidad que tengo, esto es lo que encuentro:

| Símbolo                                               | ¿Dónde se usa (visto)?                                                                     | Veredicto preliminar                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `polyArea`, `centroid`, `ringPerimeter`, `pathLength` | Muy usados (metrics.ts, manzanoRows.ts, comandos de lotes, Map.tsx)                        | **Vivo — no tocar**                         |
| `pointInPoly`                                         | `map/hitTest.ts`, `SelectEditMode.ts` (lazo de selección)                                  | **Vivo — no tocar**                         |
| `segmentIntersectsPoly`                               | `SelectEditMode.ts` (lazo de selección)                                                    | **Vivo — no tocar**                         |
| `LotResult` (tipo)                                    | `geoWorkerClient.ts` lo importa como tipo espejo del `LotResult` que devuelve Rust por IPC | **Vivo — es el contrato de IPC, no tocar**  |
| `convexHull`                                          | Ningún import visto fuera de este archivo                                                  | **Candidato a muerto — verificar con grep** |
| `principalAxis`                                       | Ningún import visto (su equivalente Rust `principal_axis` sí se usa en `subdivision.rs`)   | **Candidato a muerto — verificar con grep** |
| `projectExtents`                                      | Ningún import visto                                                                        | **Candidato a muerto — verificar con grep** |
| `clipToStrip`, `clipHalfPlane`                        | Se usan entre sí, pero no vi un consumidor externo                                         | **Candidato a muerto — verificar con grep** |
| `buildCutPolys`                                       | Ningún import visto                                                                        | **Candidato a muerto — verificar con grep** |
| `SliceResult`, `CutResult` (tipos)                    | Ningún import visto                                                                        | **Candidato a muerto — verificar con grep** |

**Acción:** `git grep -n "principalAxis\|projectExtents\|clipToStrip\|buildCutPolys\|convexHull\|SliceResult\|CutResult" -- '*.ts' '*.tsx'` sobre el repo completo. Si de verdad no hay consumidores fuera del propio archivo, se elimina en la Fase 6 (no en esta fase — acá solo se audita).

### 1.2 — Dependencias de `package.json` sin uso visible

`dxf-parser`, `dxf-writer`, `shpjs`, `shp-write`, `jszip` están declaradas y tienen tipados en `src/types/vendor.d.ts`, pero no vi ningún archivo que las importe en el conjunto de documentos que me pasaste. Dado que `ProjectSetupModal.tsx` y `projectFile.ts` hablan explícitamente de "exportar/importar DXF", **asumo que existe código de import/export DXF/SHP que no me fue compartido**, y por lo tanto **no las marco como código muerto**. Este ítem queda **bloqueado** hasta que se confirme con:

```
git grep -rn "dxf-parser\|dxf-writer\|shpjs\|shp-write\|jszip" -- '*.ts' '*.tsx'
```

Si el grep no devuelve nada fuera de `vendor.d.ts` y `package.json`, recién ahí se elimina la dependencia y su tipado (Fase 13).

### 1.3 — Auditoría de `console.*` fuera de rutas de error genuino

Objetivo: separar "esto es un error real que se debe loguear" de "esto es telemetría de desarrollo que quedó sin gate".

Encontrados sin `import.meta.env.DEV` ni ningún otro gate:

- `store/debug/geometryTelemetry.ts` → `recordGeometrySanitizeEvent()` hace `console.warn` **incondicional** en cada evento de saneo de geometría (`JSON.stringify` incluido). Se llama desde `sanitizeRing.ts` y `spatialIndex.ts`, es decir, puede dispararse durante edición normal del usuario, no solo en desarrollo.
- Comparar con `PostrenderPainter.getVisibleFeatures()`, que sí gatea su `console.warn` con `if (import.meta.env.DEV)`. Esta inconsistencia es la prueba de que el patrón correcto ya existe en el proyecto — solo falta aplicarlo de forma pareja.

**Acción (ejecutar en Fase 8):** unificar todos los logs de diagnóstico bajo un único helper `devWarn()`/`devLog()` gateado por `import.meta.env.DEV`, y para los que sí deban sobrevivir en producción (errores reales de IPC/Tauri, ej. `geoWorkerClient.ts`), dejarlos como están.

### 1.4 — Auditoría de `any`

`eslint.config.js` tiene `'@typescript-eslint/no-explicit-any': 'off'` a nivel global. Puntos concretos encontrados:

- `PropertyPanel.tsx`: `const feat = drawSource.getFeatureById(primaryId) as any;`
- `StatsPanel.tsx`: `function computeStats(drawSource: any, streets: any[])`
- `LayerPanel.tsx`: `const src = (layer as any).getSource?.()`
- Varios manejadores de eventos OL tipados como `(evt: any)` en `Map.tsx` (`onSpatialInsert`, `onSpatialRemove`, `onSpatialChange`).

No es un bug hoy, pero es la razón por la que el proyecto puede acumular bugs de tipos en refactors futuros sin que el compilador avise. Se aborda en Fase 7.

**Salida de la Fase 1:** una checklist confirmada (no especulativa) de qué se borra, qué se mantiene y por qué, que alimenta las Fases 2, 6 y 13.

---

## Fase 2 — Sacar la instrumentación de debug/benchmark del bundle de producción

**Esta es la fase de mayor impacto/riesgo-bajo del plan.** Es una app de escritorio (Tauri), así que el tamaño de bundle importa menos que en web, pero el problema real no es el tamaño: es que hay **telemetría corriendo en cada frame de render, siempre, para todo usuario**, más un arnés de automatización que puede intentar red hacia `localhost:9876` en producción.

### 2.1 — Qué se monta incondicionalmente hoy

En `src/App.tsx`:

```tsx
<StatusBar />
<DebugPanel />
<Fase6AutoValidator />
```

`DebugPanel.tsx` (~450 líneas) y `Fase6AutoValidator.tsx` se importan y montan **siempre**, para todo build, no solo en dev. `Fase6AutoValidator` activa su lógica si `window.location.hash.startsWith('#fase6-validate')` — es decir, cualquier usuario que abra la app con ese hash en la URL (posible si alguna vez se comparte un link, o si queda en el historial del navegador embebido de Tauri) dispara benchmarks pesados (`runSyntheticUrbanBenchmarkSuite`, `runConcurrencyStressSuite`) y un `fetch` reintentado 60 veces contra `http://127.0.0.1:9876/results`.

### 2.2 — Telemetría corriendo en el hot-path de render

`PostrenderPainter.handle()` llama, **en cada evento `postrender`** (o sea, en cada frame que OpenLayers redibuja):

- `recordPostrenderSplit()` × 5 (prologue, updateCaches, getVisibleFeatures, labels, street, resto)
- `recordPostrenderDuration()`

Y `LayeredWebglRenderer` llama `recordSetStyleCall()` / `recordSyncLayerSetCall()` / `recordWebglLayerCount()` en cada sync de capas. Todo esto vive en `store/debug/debugCounters.ts`, que mantiene `Map`s y arrays con lógica de ventana rodante — barato por llamada, pero es trabajo que se paga **siempre**, para usuarios que jamás van a abrir el panel de debug (que además está oculto tras Ctrl+Shift+D, así que la gran mayoría nunca lo abre).

### 2.3 — Módulos grandes que solo alimentan al DebugPanel

Todo `src/geo/debug/*` (`syntheticDataset.ts`, `syntheticUrbanLayout.ts`, `undoRedoBenchmark.ts`, `spatialIndexBenchmark.ts`, `syntheticUrbanBenchmark.ts`, `concurrencyStressBenchmark.ts`, `affineAccuracyBenchmark.ts`) y todo `src/store/debug/*` (`debugCounters.ts`, `geometryTelemetry.ts`, `nativeEngineTelemetry.ts`, `nativeMemoryTelemetry.ts`, `affineTelemetry.ts`) existen solo para alimentar `DebugPanel.tsx`. Esto es código legítimo y bien escrito (los benchmarks son sofisticados), el problema no es que exista sino que **está en el mismo grafo de módulos que la app "real"**, así que Vite lo empaqueta siempre.

### 2.4 — Plan de acción (sin borrar nada de valor)

1. **No borrar los benchmarks.** Son útiles para diagnosticar regresiones de rendimiento — pero deben dejar de vivir en el camino crítico de producción.
2. Envolver el montaje de `DebugPanel` y `Fase6AutoValidator` en `App.tsx` con:
   ```tsx
   {
     import.meta.env.DEV && <DebugPanel />;
   }
   {
     import.meta.env.DEV && <Fase6AutoValidator />;
   }
   ```
   o, mejor aún, con `React.lazy()` + `import.meta.env.DEV` para que ni siquiera entren en el bundle final:
   ```tsx
   const DebugPanel = import.meta.env.DEV
     ? lazy(() => import('./components/debug/DebugPanel'))
     : null;
   ```
3. En `store/debug/debugCounters.ts`, envolver `recordPostrenderSplit`/`recordPostrenderDuration`/`recordSetStyleCall`/etc. en un chequeo de un flag `telemetryEnabled` que arranca en `false` y solo se pone en `true` la primera vez que se abre el panel de debug (`useDebugPanelStore.setOpen(true)`), o directamente detrás de `import.meta.env.DEV`. Esto saca el costo del hot-path para el 100% de los usuarios en producción sin romper la funcionalidad del panel cuando sí se usa.
4. `recordGeometrySanitizeEvent()` (Fase 1.3) se resuelve acá también: gatear el `console.warn`/`JSON.stringify` detrás de `import.meta.env.DEV`, manteniendo el conteo en memoria (que sí es barato) para cuando el panel esté abierto.
5. Mover `Fase6AutoValidator` a que solo se importe dinámicamente si el hash coincide **y** `import.meta.env.DEV` es verdadero — nunca en un build de release, ni siquiera con el hash correcto.

**Riesgo:** bajo. Es puramente aditivo (gates), no se cambia lógica. Se valida con: abrir DebugPanel en dev y confirmar que sigue mostrando datos; hacer un build de producción y confirmar (con `vite-bundle-visualizer` o similar) que `DebugPanel`, `Fase6AutoValidator` y `geo/debug/*` no aparecen en los chunks finales.

**Impacto esperado:** menor tiempo de frame en producción (elimina trabajo por-frame que hoy es puro costo hundido), bundle de producción más chico, y elimina el riesgo de que un build de release intente pegarle a un servidor `localhost:9876` inexistente.

---

## Fase 3 — Consolidar la resolución de capa activa (4 implementaciones → 1)

Hoy existen **cuatro** funciones distintas que resuelven "¿a qué capa va esta feature nueva?", con jerarquías de fallback parecidas pero no idénticas:

| Función                                 | Archivo                                  | Jerarquía de fallback                                                                                                                            |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `resolveLayerId(override?, kind?)`      | `commands/features/AddFeatureCommand.ts` | override → capa activa (si no bloqueada) → `getLayerForKind` (si no bloqueada) → `undefined`                                                     |
| `requireLayerForKind(kind)`             | `store/ui/layerPickerStore.ts`           | capa activa (si coincide **kind** y no bloqueada) → `getLayerForKind` (si no bloqueada) → `autoCreateLayerForKind`                               |
| `resolveOrCreateLayerForKind(kind)`     | `store/entities/layerAutoCreate.ts`      | capa activa (si coincide kind y no bloqueada) → `getLayerForKind` (si no bloqueada) → `autoCreateLayerForKind`                                   |
| `resolveLoteLayerId(preferredLayerId?)` | `geo/recomputeManzanos.ts`               | preferredLayerId (si no bloqueada) → capa activa (si no bloqueada, **sin chequear kind**) → `getLayerForKind('lote')` → `autoCreateLayerForKind` |

`requireLayerForKind` y `resolveOrCreateLayerForKind` son **casi** idénticas (la única diferencia real es que una es async-wrapped con `Promise.resolve()` y crea capa automáticamente sin confirmar con el usuario, la otra no lo es) — probablemente una quedó de una refactorización anterior sin eliminar la otra. `resolveLoteLayerId` es la más peligrosa de las cuatro porque **no valida que la capa activa sea de tipo `lote`** antes de usarla, a diferencia de las otras tres (ver el comentario `// FIX:` en `layerPickerStore.ts` que documenta que ese bug ya se corrigió _ahí_ pero no en `recomputeManzanos.ts`).

### Plan

1. Mapear con tests (Fase 9) el comportamiento actual de las 4 funciones ante los mismos inputs, para no cambiar comportamiento sin querer.
2. Crear `src/store/entities/layerResolution.ts` con una única función parametrizable:
   ```ts
   resolveLayerForKind(kind, opts?: { override?: string; requireKindMatch?: boolean; autoCreate?: boolean })
   ```
3. Migrar los 4 call-sites uno por uno, en commits separados, corriendo la suite completa después de cada uno.
4. Corregir explícitamente el bug de `resolveLoteLayerId` (falta de chequeo de `kind`) como parte de esta consolidación, documentándolo como fix, no como refactor silencioso.

**Riesgo:** medio — es lógica que determina a qué capa van los lotes regenerados automáticamente durante recompute de manzanos, un flujo central. Por eso va después de la Fase 1 (auditoría) y se apoya en tests nuevos antes de tocar código.

---

## Fase 4 — Refactor de `recomputeManzanos.ts` (700+ líneas, cero tests hoy)

Este es, con diferencia, el archivo con mayor complejidad ciclomática y mayor impacto del proyecto (calcula manzanos a partir de calles/rotondas, reconcilia fragmentos con manzanos existentes para preservar lotización previa, gestiona el modo "sin red vial", y dispara re-lotización automática). Y es, a la vez, el único archivo de ese tamaño **sin ningún test unitario TS** — solo se valida indirectamente vía el benchmark sintético (`runSyntheticUrbanBenchmark`) que corre manualmente desde el DebugPanel.

### Problemas concretos observados

- `recomputeManzanosImmediate()` tiene dos ramas casi independientes (con red vial / sin red vial) que comparten muy poco código pero están en la misma función de ~250 líneas.
- `reapplyRoadCornerMode()` duplica gran parte de la lógica de reconciliación de fragmentos de `recomputeManzanosImmediate()` (unión/diferencia, `matchFragmentsBatchInWorker`, iteración de `touchedGroups`), pero con una implementación paralela en vez de reutilizar una función común.
- El manejo de "primera perimetral de trabajo" (`ensurePerimeterWorkingCopies`) usa un sufijo de string mágico (`PERIMETER_WORKING_SUFFIX = '__working'`) para derivar IDs — funciona, pero es frágil si algún día un ID de usuario coincidiera con ese patrón.
- Toda la función corre dentro de un debounce global de 250ms con una única promesa in-flight compartida (`recomputeInFlight`) — es un patrón correcto y ya bien pensado (evita carreras), pero al no estar testeado, cualquier refactor futuro puede romper la propiedad de que dos llamadas concurrentes se combinen correctamente.

### Plan (estrictamente incremental, cero cambios de comportamiento en esta fase)

1. **Antes de refactorizar una sola línea:** escribir tests de caracterización usando los layouts ya definidos en `syntheticUrbanLayout.ts` (`generateSyntheticUrbanLayout`) como fixtures deterministas (ya usan `Mulberry32` con seed fija → son reproducibles). Comparar snapshots de `diff.added/removed/modified` antes/después del refactor.
2. Extraer, sin cambiar lógica, 4 funciones puras testeables:
   - `computeRoadFingerprintDelta(streets, roundabouts, prevFingerprints)` → ya casi existe como bloque inline, solo falta nombrarlo y exportarlo.
   - `reconcileFragmentsForGroup(group, fragments, matchResult)` → compartida entre `recomputeManzanosImmediate` y `reapplyRoadCornerMode`.
   - `restoreParcelToOrigin(...)` → ya existe como `restoreMemberToParcel`, solo mover fuera de la función gigante.
   - `applyRelotTasks(tasks, allowAutoRelot)` → hoy es un bloque `for` inline al final de la función.
3. Una vez extraídas, `reapplyRoadCornerMode()` debería poder reusar `reconcileFragmentsForGroup` en vez de tener su propia copia.
4. Solo después de que los tests de caracterización pasen contra el código refactorizado, considerar cambios de comportamiento reales (por ejemplo, corregir el bug de `resolveLoteLayerId` de la Fase 3, que este archivo también usa).

**Riesgo:** alto si se hace mal, bajo si se respeta el orden "tests de caracterización → extracción pura → sin cambio de comportamiento → recién ahí fixes". Por eso está deliberadamente después de la Fase 3 (para no tener dos frentes de cambio abiertos sobre el mismo archivo a la vez).

---

## Fase 5 — Limpiar comentarios "Fase N" y mover la bitácora a CHANGELOG.md

El código tiene decenas de comentarios del estilo:

> `// Fase 3.4 (auditoria-para-mejora.md) — BUGFIX: antes se leía sin dataProjection...`
> `// Fase 5.2 — al fijar/cambiar el modo de CRS, la matriz afín cacheada... deja de ser válida`
> `// ═══ INSERTAR DESDE ACÁ ═══` / `// ═══ HASTA ACÁ ═══` (en `DebugPanel.tsx`)

Esto es valioso como _historial_ pero es ruido como _comentario de código_: mezcla "qué hace esto" con "cuándo y por qué se cambió", y hace que el archivo crezca sin aportar a la comprensión del comportamiento actual. Además, los marcadores `═══ INSERTAR DESDE ACÁ ═══` en `DebugPanel.tsx` son literalmente instrucciones de edición que quedaron pegadas en el código fuente.

### Plan

1. Crear `CHANGELOG.md` en la raíz con una entrada por "Fase" mencionada en comentarios, extrayendo el texto explicativo tal cual (no perder la información, solo reubicarla).
2. Para cada comentario "Fase N — BUGFIX: ...", dejar solo la parte que explica el invariante que protege (el "por qué" atemporal), quitando la referencia a la fase/fecha. Ejemplo:
   - Antes: `// Fase 3.4 — antes solo chequeaba ext[0] === ±Infinity; un NaN... pasaba igual`
   - Después: `// Un extent con NaN (no solo ±Infinity) rompe silenciosamente View.fit() y el índice espacial — se valida explícitamente.`
3. Eliminar los marcadores `═══ INSERTAR ═══` de `DebugPanel.tsx` sin tocar el código que delimitan.
4. Esto se hace **archivo por archivo, en paralelo con las fases que ya tocan ese archivo** (no amerita una fase propia de principio a fin) — pero se lista acá como criterio: cualquier PR de limpieza que toque un archivo con comentarios "Fase N" debe migrarlos al CHANGELOG como parte del mismo PR.

**Riesgo:** nulo (son comentarios). Es 100% seguro de aplicar tan pronto como se quiera, no depende de ninguna otra fase.

---

## Fase 6 — Eliminar código geométrico TS confirmado como muerto

Ejecutar recién después de que el grep de la Fase 1.1 confirme cero consumidores para: `convexHull`, `principalAxis`, `projectExtents`, `clipToStrip`, `clipHalfPlane`, `buildCutPolys`, `SliceResult`, `CutResult`.

- Si el grep confirma que están muertos: eliminarlos de `polygonEngine.ts` en un commit dedicado, correr `npm run build` (TypeScript fallará fuerte si algo los seguía usando) y la suite de tests completa.
- Si el grep encuentra un consumidor que no vi (probable para código de export/import geométrico que no me compartiste): dejarlos, pero mover ese consumidor a la lista de "archivos que faltan en este análisis" para una segunda pasada.

**Riesgo:** bajo, pero **estrictamente condicionado** al resultado del grep — no ejecutar por intuición.

---

## Fase 7 — Endurecer tipado (`any` → tipos reales)

1. En `eslint.config.js`, cambiar de:
   ```js
   '@typescript-eslint/no-explicit-any': 'off'
   ```
   a:
   ```js
   '@typescript-eslint/no-explicit-any': 'warn'
   ```
   (empezar en `warn`, no en `error`, para no romper CI de golpe con decenas de warnings preexistentes).
2. Resolver los `any` de mayor riesgo primero (los que tocan geometría/features, donde un tipo incorrecto puede esconder un bug de runtime):
   - `StatsPanel.tsx`: tipar `computeStats(drawSource: VectorSource | null, streets: Street[])`.
   - `PropertyPanel.tsx`: reemplazar `as any` por el tipo real `Feature<Geometry> | null` que ya se usa en el resto del archivo.
   - `LayerPanel.tsx` `handleZoomToLayer`: tipar `layer as VectorLayer<VectorSource>` o usar un type guard en vez de `as any`.
   - `Map.tsx`: tipar los manejadores `onSpatialInsert/Remove/Change` con `FeatureEvent` de OpenLayers en vez de `(evt: any)`.
3. Una vez que el conteo de warnings baje de forma sostenida (medirlo con `npm run lint 2>&1 | grep -c "no-explicit-any"` antes/después), subir la regla a `'error'` **solo si el equipo puede sostenerla** — si no, dejarla en `warn` de forma permanente es preferible a mentir con una regla en `error` que después se vuelve a apagar.

**Riesgo:** bajo, cambios locales y verificables por el compilador en cada paso.

---

## Fase 8 — Rendimiento en runtime (hot paths, más allá de la Fase 2)

Con la instrumentación ya gateada (Fase 2), estos son los siguientes puntos de optimización real detectados:

1. **`LabelPainter.layersKey()`** reconstruye un string iterando **todas las capas en cada llamada a `computeCacheKey`** (que a su vez se llama en cada `paint()`, o sea, potencialmente cada frame cuando la cache invalida). El propio archivo ya tiene el patrón correcto implementado en otro lado (`DrawLayerRenderer.getByIdMap()` cachea contra la identidad de referencia del array `layers`). Aplicar el mismo patrón: cachear `layersKey` y solo recalcular cuando `useLayersStore.getState().layers` cambie de referencia.
2. **`StreetPainter`/`RoundaboutPainter`** llaman `useLayersStore.getState()` y `useRoundaboutStore.getState()` en cada `paint()`. Son lecturas baratas hoy, pero si el número de capas crece (la app ya contempla >48 capas con el "pool mode" de `LayeredWebglRenderer`), vale la pena adoptar el mismo `byIdCache` que ya existe en `DrawLayerRenderer`.
3. **Unificar los `console.warn` de saneo de geometría** (Fase 1.3 / 2.4): confirmar que después de la Fase 2 no queda ningún `JSON.stringify` corriendo fuera de `import.meta.env.DEV` en rutas que se disparan durante edición normal (dibujo, recompute de vías).
4. **`recomputeManzanos.ts`**: ya tiene debounce de 250ms — está bien —, pero cada ejecución reconstruye varios `Map`/`Set` desde cero (`collectOriginGroups`, `collectRootGroups`) recorriendo **todas** las features del `drawSource`, no solo las tocadas. Esto es aceptable a la escala actual, pero si el proyecto apunta a datasets grandes (el propio `DebugPanel` prueba hasta 1M features), este es el punto donde un índice incremental (mantenido en el propio `drawSource` en vez de reconstruido) pagaría dividendos. Se marca como candidato de optimización **futura**, no se ejecuta en este plan porque requiere el refactor de la Fase 4 primero.

**Riesgo:** bajo, son optimizaciones locales con patrón ya validado en el propio código.

---

## Fase 9 — Cobertura de tests: plan priorizado

Orden por criticidad × complejidad × cero-cobertura-actual:

| Prioridad | Módulo                                                   | Por qué es crítico                                                                                                                                                                                         | Qué testear                                                                                                                                                                                                                                                 |
| --------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1         | `commands/core/CommandStack.ts`                          | Es el corazón de undo/redo de toda la app; cero tests hoy                                                                                                                                                  | Coalescing dentro/fuera de la ventana de 250ms, `pruneStack` por cantidad y por bytes, `undo`/`redo` cuando `command.undo` no está implementado (debe loguear warning y no reventar), comportamiento de `redo` tras un `run()` nuevo (debe truncar la pila) |
| 2         | `store/entities/layersRegistryStore.ts`                  | Toda la app depende de esta store para saber qué capa es activa/bloqueada/visible                                                                                                                          | `reorder` con ids inexistentes, `toggleIsolate` (guardar y restaurar visibilidad previa), `setActiveLayer` sobre capa bloqueada (debe ser no-op)                                                                                                            |
| 3         | `map/advancedSnap.ts` `findSnap()`                       | Lógica de snapping con prioridades e histéresis ("sticky band"); un bug acá se siente como "el dibujo tiembla" para el usuario, muy difícil de debuggear a ojo                                             | Prioridad de tipos de snap cuando compiten dos candidatos a la misma distancia, comportamiento de `applySticky` cuando el snap previo sigue "cerca"                                                                                                         |
| 4         | `geo/recomputeManzanos.ts` (post-Fase 4)                 | Ver Fase 4                                                                                                                                                                                                 | Tests de caracterización antes del refactor, tests de comportamiento después                                                                                                                                                                                |
| 5         | Hooks: `useDraggablePanel.ts`, `useIncrementalRender.ts` | Lógica de clamping y de umbral de renderizado incremental, usada en casi todos los paneles                                                                                                                 | `clamp()` en los 4 bordes de la ventana al hacer resize, `visibleCount` cuando `totalCount < batchSize`                                                                                                                                                     |
| 6         | `core/objectModel.ts`                                    | Funciones puras (`getFeatureKind`, `isGeoUrbanFeatureKind`, `ensureKind`) que ya soportan "legacy" (`props.type`) — el tipo de función que se rompe en silencio si alguien toca el legado sin darse cuenta | Cobertura de cada rama legacy documentada en el propio código                                                                                                                                                                                               |

**Nota sobre el lado Rust:** ya está bien cubierto (`math.rs`, `roads.rs`, `roundabout.rs`, `sanitize.rs`, fuzzing de geometría degenerada en `fuzz_degenerate_geometry.rs`, tests de paridad contra fixtures congelados). No es prioridad de esta fase — sí lo es corregir la referencia rota descrita en 11.1.

**Riesgo:** nulo — agregar tests nunca rompe nada existente (salvo que revele un bug real, lo cual es exactamente el punto).

---

## Fase 10 — Estructura de carpetas

La estructura actual (`store/{debug,entities,map,project,ui}`, `commands/{core,features,layers,lots,roads}`, `geo/{crs,debug,math,roads,roundabout,selectors,subdivision}`, `map/scene/{modes,painters}`) está bien pensada y **no requiere reestructuración**. Las únicas dos observaciones:

1. `geo/debug/` conviene marcarlo explícitamente como "solo test/dev" (por ejemplo con un `README.md` de una línea en esa carpeta, o renombrándola a `geo/__dev-tools__/` para que sea imposible confundirla con lógica de producto) — esto es cosmético pero refuerza la separación que ya se implementa funcionalmente en la Fase 2.
2. `src/types/vendor.d.ts` declara tipos para 3 librerías (`shpjs`, `dxf-parser`, `dxf-writer`) que no tienen `import`s visibles en este análisis (ver Fase 1.2). Si el grep confirma que sí se usan en otro lado del repo, este archivo queda como está. Si no, se elimina junto con las dependencias en Fase 13.

**Riesgo:** nulo en el punto 1 (es un README), condicional en el punto 2.

---

## Fase 11 — CI/CD

### 11.1 — Referencia rota a un script inexistente

Los tests de Rust de paridad (`parity_cabecera_cuerpo.rs`, `parity_exact_modo2.rs`, `parity_fragment_reconciliation.rs`, `parity_compute_manzanos.rs`) fallan con mensajes de `assert!` que dicen textualmente:

> "Corré `npm run parity:sync` desde la raiz del repo y volve a correr `cargo test`."

Pero `package.json` **no tiene** un script `parity:sync`. Esto es coherente con lo que ya documentan los propios comentarios del repo ("el motor JS fue retirado... los fixtures quedaron congelados... ya no se regeneran desde TS"). O sea: el mensaje de error de estos tests está describiendo un flujo de trabajo que ya no existe. Si algún desarrollador nuevo rompe sin querer un fixture y sigue la instrucción del assert, va a perder tiempo buscando un script que no está.

**Acción:** actualizar los 4 mensajes de `assert!` para que digan la realidad actual: que los fixtures en `tests/fixtures/*.json` están congelados y se editan a mano (o regenerar el mecanismo de sync si en verdad se quiere mantener vivo, pero eso es una decisión de producto, no de limpieza).

### 11.2 — `deploy-pages.yml` vive en `main` pero jamás corre desde `main`

El workflow solo dispara en `push` a la branch `web-version` (documentado explícitamente en el propio YAML: "main es desktop-only... la version web... quedó congelada en el branch web-version"). Mantenerlo en `main` no rompe nada (nunca se ejecuta desde ahí), pero es peso cognitivo para cualquiera que explore `.github/workflows/` en `main` y no sepa que ese archivo es, en la práctica, sobre otra rama.

**Acción (opcional, de bajo impacto):** mover este workflow para que solo exista en la branch `web-version`, o agregar un comentario aún más explícito al principio del archivo. No es urgente.

### 11.3 — Falta de gate de CI sobre lint + test en cada PR

No vi ningún workflow de GitHub Actions que corra `npm run lint` + `npm test` en cada push/PR a `main` (solo vi `parity.yml`, que corre exclusivamente los tests de Rust, y `release-tauri.yml`, que solo corre en tags). Si no existe ya en el repo real, es la pieza que más apalanca todo lo demás de este plan: sin ese gate, cualquier limpieza de la Fase 2-9 puede reintroducirse sin que nadie se entere.

**Acción:** agregar `.github/workflows/ci.yml` con `npm run lint`, `npm test` (Vitest) en cada push/PR — bajo costo, alto valor, y es prerequisito informal para confiar en todas las fases anteriores a largo plazo.

**Riesgo:** nulo en los tres puntos (son cambios de configuración de CI/mensajes de error, no de lógica de producto).

---

## Fase 12 — Seguridad / hardening de Tauri

En `src-tauri/tauri.conf.json`:

```json
"script-src": ["'self'", "'unsafe-inline'"],
"style-src": ["'self'", "'unsafe-inline'"]
```

`'unsafe-inline'` en `style-src` es normal y casi inevitable en una app React que usa `style={{...}}` extensivamente (como esta). `'unsafe-inline'` en **`script-src`** es más sensible: habilita ejecución de `<script>` inline, que es justamente el vector que un CSP debería bloquear. Si el build de Vite no necesita scripts inline (la mayoría de builds modernos no los necesitan salvo hidratación específica), vale la pena:

1. Verificar con un build real (`npm run tauri:build`) si sacar `'unsafe-inline'` de `script-src` rompe algo.
2. Si no rompe nada, sacarlo — reduce superficie de XSS si alguna vez se renderiza contenido no confiable (por ejemplo, nombres de proyecto o de capa provistos por el usuario, que hoy se interpolan directo en JSX — React ya escapa esto por defecto, así que el riesgo real es bajo, pero "defensa en profundidad" no cuesta nada acá).

**Riesgo:** bajo, pero requiere una validación manual real (no solo lectura de código) antes de aplicarlo, por eso queda en una fase tardía y opcional.

---

## Fase 13 — Housekeeping final de dependencias

Ejecutar **solo después** de que los greps de las Fases 1.1, 1.2 y 6 estén confirmados:

1. Si `convexHull`/`principalAxis`/`projectExtents`/`clipToStrip`/`buildCutPolys` quedaron confirmados como muertos y ya se eliminaron (Fase 6): correr `npx depcheck` o equivalente para confirmar que ninguna dependencia de `package.json` quedó exclusivamente para sostenerlos (no debería, son funciones sin dependencias externas, pero se verifica igual).
2. Si `dxf-parser`/`dxf-writer`/`shpjs`/`shp-write`/`jszip` se confirman sin uso: eliminarlas de `package.json`, borrar sus tipos de `src/types/vendor.d.ts`, correr `npm install` para regenerar el lockfile, y correr el build completo.
3. Revisar versiones de dependencias con **major desactualizado** de forma segura (no forma parte de "limpieza de basura" per se, pero es el momento natural para hacerlo si ya se está tocando `package.json`): esto requiere revisar el changelog de cada paquete antes de subir, no se debe hacer a ciegas dentro de este plan de limpieza.

**Riesgo:** medio si se hace sin el grep previo (podés borrar algo que sí se usa en un archivo que no vi), nulo si se respeta el orden.

---

## Orden de ejecución recomendado

```
Fase 0  (setup)                        → 1 día, sin riesgo
Fase 1  (auditoría, solo lectura)      → 1-2 días, sin riesgo
Fase 2  (sacar debug de producción)    → 2-3 días, riesgo bajo, ALTO IMPACTO
Fase 5  (comentarios → CHANGELOG)      → en paralelo con cualquier otra fase, sin riesgo
Fase 11 (CI: mensajes rotos + gate)    → 1 día, sin riesgo, apalanca todo lo demás
Fase 3  (consolidar resolución capas)  → 2-3 días, riesgo medio
Fase 9  (tests prioritarios 1-3)       → 3-5 días, sin riesgo (agregar tests)
Fase 4  (refactor recomputeManzanos)   → 4-6 días, riesgo alto SI no se respeta el orden interno
Fase 6  (borrar geometría TS muerta)   → 1 día, condicionado al grep de Fase 1.1
Fase 7  (endurecer any)                → 2-3 días, riesgo bajo
Fase 8  (perf de hot paths restantes)  → 1-2 días, riesgo bajo
Fase 10 (cosmética de carpetas)        → medio día, sin riesgo
Fase 12 (CSP hardening)                → medio día, riesgo bajo, requiere validación manual
Fase 13 (housekeeping de deps)         → 1 día, condicionado a greps previos
```

Las Fases 2, 5 y 11 se pueden arrancar **ya mismo, en paralelo, esta misma semana**, porque no dependen de nada y no tienen riesgo. El resto sigue el orden de la tabla por las dependencias explicadas en cada fase.

---

## Cómo medir que funcionó

- **Fase 2:** comparar el reporte de `rollup-plugin-visualizer` (o `vite build --mode production` + inspección de `dist/assets`) antes/después — `DebugPanel`, `Fase6AutoValidator` y `geo/debug/*` no deberían aparecer en ningún chunk cargado por defecto. Medir tiempo de frame (`postrenderAvgMs`, que el propio `DebugPanel` ya expone) con un dataset sintético de 100k features antes/después del gate de telemetría.
- **Fase 4/9:** cobertura de líneas de Vitest (`vitest run --coverage`) sobre `commands/core/`, `store/entities/`, `geo/recomputeManzanos.ts` — objetivo razonable: pasar de ~0% a >60% en esos tres focos puntuales, no perseguir 100% global.
- **Fase 7:** conteo de warnings de `no-explicit-any` (`npm run lint 2>&1 | grep -c "no-explicit-any"`) bajando de forma monotónica release a release.
- **Fase 13:** tamaño de `node_modules` y de `package-lock.json` antes/después, y confirmación de que `npm run tauri:build` sigue generando un instalador funcional en las 3 plataformas del workflow (`windows-latest`, `macos-latest`, `ubuntu-latest`).

---

## Lo que este plan **no** toca (a propósito)

- No se propone ningún cambio al motor Rust (`geourban-geo`) más allá del mensaje de error de la Fase 11.1 — está bien testeado y no mostró señales de deuda técnica significativa en este análisis.
- No se propone cambiar el patrón de comandos/undo-redo, que es sólido y ya maneja coalescing, límites de memoria (`MAX_STACK_BYTES`) y diffs estructurales de forma correcta.
- No se propone tocar el sistema de snapping (`advancedSnap.ts`) más allá de agregarle tests (Fase 9) — la lógica en sí no mostró bugs, solo falta de red de seguridad.
- No se proponen cambios de UX/diseño visual — el pedido fue explícitamente de limpieza técnica, no de producto.
