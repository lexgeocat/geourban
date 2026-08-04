# Fase 4 — Refactor de `recomputeManzanos.ts`

**Estado: COMPLETADA con alcance acotado.** El plan original proponía 4 funciones puras testeables extraídas y tests de caracterización comparando snapshots antes/después. En la práctica solo la primera de las 4 candidatas es realmente pura; las otras dependen de `VectorSource`, `Feature`, `StructuralDiffRecorder` y de varios stores, así que extraerlas como "funciones puras" era ficción. La fase se aplicó sobre lo que sí era seguro y útil.

## Diagnóstico revisado del archivo

El archivo pasó de 1083 líneas (pre-Fase 4) a 1050. Funciones internas antes/después:

| Función | Estado antes | Estado después |
| --- | --- | --- |
| `closeGeoRing`, `ringsApproxEqual`, `ringsShapeEquivalent`, `ringsEffectivelyUnchanged` | privadas | privadas, sin cambios |
| `currentRingOf`, `restoreMemberToParcel` | privadas | privadas, sin cambios (el plan sugería renombrar a `restoreParcelToOrigin`; no aporta, no se hizo) |
| `orientRingCcw`, `ringsExtent`, `currentOrOriginalExtent` | privadas | privadas, sin cambios |
| `fragmentsMatchCurrentMembers` | privada | privada, sin cambios |
| `streetFingerprint`, `streetApproxExtent`, `roundaboutFingerprint`, `roundaboutApproxExtent` | privadas | privadas (ahora solo se usan dentro de `computeRoadFingerprintDelta`) |
| **`computeRoadFingerprintDelta`** | inline (líneas 467-488) | **función pura exportada, 100% testeable** |
| `ensurePerimeterWorkingCopies` | privada | privada, sin cambios |
| `collectOriginGroups`, `resolveRootParcel`, `collectRootGroups` | privadas | privadas, sin cambios |
| `resolveManzanaLayerId`, `syncPerimeterLayersVisibility`, `resolveLoteLayerId` | privadas | privadas, sin cambios |
| **`applyRelotTasks`** | bloque `for (const task of relotTasks)` inline al final | **función helper interna (no exportada)** |
| `recomputeManzanosImmediate` | ~500 líneas, sin secciones | ~480 líneas, con headers de sección + indent corregida en dos bloques |
| `recomputeManzanos`, `waitForPendingRecompute`, `reapplyRoadCornerMode`, `resetIncrementalRoadTracking` | públicas | públicas, sin cambios |

## Cambios aplicados

### `computeRoadFingerprintDelta` — extracción pura testeable

Antes era un bloque inline de ~22 líneas dentro de `recomputeManzanosImmediate` que construía `currentFingerprints` y calculaba `changedExtent` comparando contra el cache `lastRoadFingerprints`. Ahora es una función pura exportada:

```ts
export function computeRoadFingerprintDelta(
  streets: Street[],
  roundabouts: Roundabout[],
  prev: Map<string, RoadElementFingerprint>,
): { current: Map<string, RoadElementFingerprint>; changedExtent: Extent | null }
```

El call-site pasó de 22 líneas inline a 4 líneas:

```ts
const { current: currentFingerprints, changedExtent } = computeRoadFingerprintDelta(
  streets, roundabouts, lastRoadFingerprints,
);
lastRoadFingerprints = currentFingerprints;
```

**Test unitario** (`src/geo/recomputeManzanos.test.ts`, 8 tests): covers con prev vacío, sin cambios, cambio puntual de un elemento, eliminación de un elemento, mezcla streets+roundabouts, no-mutación de `prev`, preservación de entradas no modificadas en `current`, y sensibilidad a `waypoints`/`sideWidthM`.

### `applyRelotTasks` — extracción helper interno

Antes era un bloque `for (const task of relotTasks)` inline de ~62 líneas al final de `recomputeManzanosImmediate`. Ahora es una función helper interna (no exportada) con JSDoc. El call-site pasó a una sola línea:

```ts
await applyRelotTasks(relotTasks, allowAutoRelot, src, recorder, targetAreaM2, frontMinM);
```

**No tiene tests nuevos** (ver "Lo que esta fase no toca" abajo).

### Re-indentación de dos bloques con indent mixto

La rama `if (!hasRoadNetwork)` (líneas ~454-496) tenía el `if` a 2 espacios pero el body mezclaba 4/6/8. Ahora uniforme 2/4/6/8.

El bloque `untouched` (líneas ~803-811) tenía 6 espacios donde tocaba 4. Ahora uniforme.

### Headers de sección en `recomputeManzanosImmediate`

Bloques con comentario `// ──` que delimitan visualmente las 6 secciones del flujo:

1. Setup (drawSource, stores, `syncPerimeterLayersVisibility`)
2. Rama sin red vial
3. Rama con red vial: setup (working copies, groups, road rings)
4. Diff contra snapshot de vías (donde vive `computeRoadFingerprintDelta`)
5. Limpieza de lotes huérfanos
6. Índices + match Fragments batch + relotCandidates
7. Confirm al usuario
8. Reconciliación por parcel + applyRelotTasks + prune + panel

### Cambios accesorios resueltos durante la fase

- `Command.ts` ahora importa `CommandContext` además de re-exportarlo (era necesario para que las firmas `execute(ctx: CommandContext)` resolvieran el tipo en el scope local — TypeError que apareció al aplicar Fase 3, no del refactor de Fase 4 pero impedía tsc limpio).
- `layersRegistryStore.ts` exporta `LayerState` (era necesario para el test de Fase 3 — `layerResolution.test.ts` lo importa como tipo).

## Lo que esta fase **no** toca (y por qué)

### Tests de caracterización del flujo completo

El plan proponía tests comparando snapshots antes/después con `generateSyntheticUrbanLayout` como fixture. Es inviable en vitest por dos razones:

1. **Dependencia de Tauri IPC**: `recomputeManzanosImmediate` llama a `computeManzanosInWorker`, `matchFragmentsBatchInWorker` y `subdivideManzanoInWorker`. Los tres lanzan `throw` desde `requireNativeRuntime()` si `__TAURI_INTERNALS__` no está presente en `window`. El entorno de vitest es `node`, no browser con Tauri.
2. **Dependencia de stores con side effects**: el flujo también lee/muta `useManzanoStore`, `useLayersStore`, `confirmAsync` (dialog modal) y `useRecomputeStatusStore`. Mockear todo eso para un test de caracterización es un proyecto en sí mismo.

Alternativas posibles no aplicadas (fuera del alcance de esta fase):

- `vi.mock` del módulo `../workers/geoWorkerClient` con stubs deterministas — viable pero requiere duplicar toda la lógica de prueba del comportamiento de GEOS/Rust en mocks.
- Crear un "modo test" en el código de producción que evite `requireNativeRuntime` — contamina el código de producto.
- Mover los tests al lado Rust, donde sí hay cobertura real — eso ya está cubierto por los `parity_*` tests.

Decisión: extraer lo que sí es testeable (`computeRoadFingerprintDelta`) y documentar el resto. La garantía de "no cambio de comportamiento" se obtiene por:

- Extracciones puras con diffs pequeños y verificables visualmente (mover bloques sin tocarlos).
- `applyRelotTasks`: el bloque extraído es verbatim el bloque inline — comparación lado a lado en el diff lo confirma.
- Re-indentación: no cambia tokens, solo whitespace.
- Headers: solo comentarios añadidos, no se borra ni se mueve código.

### Extracción de `reconcileFragmentsForGroup`, `restoreParcelToOrigin`, `applyRelotTasks`

El plan lista 4 candidatas a función pura testeable, pero solo `computeRoadFingerprintDelta` califica:

- `restoreMemberToParcel`: muta `Feature` (set geometry/props), llama `src.addFeature`, `updateFeatureMetrics`, `recorder.recordModify*`. No es pura y mockearla para testearla es fake-purity.
- `reconcileFragmentsForGroup`: sería una megafunción de ~120 líneas con muchas branches (reused vs new, geometryUnchanged, barelyChanged, wasSubdivided). El plan sugiere reusarla entre `recomputeManzanosImmediate` y `reapplyRoadCornerMode`. **Pero los contratos son distintos**: la primera crea features nuevos cuando no hay match y empuja a `relotTasks`; la segunda solo hace `setGeometry` sobre features existentes. Forzar reuso aquí cambiaría el comportamiento de `reapplyRoadCornerMode` (le agregaría creación de features nuevos que hoy no tiene). No se hizo.
- `applyRelotTasks`: ahora es helper interno, no pura. Se podría mockear `subdivideManzanoInWorker` y `useManzanoStore` para testearla, pero el esfuerzo es desproporcionado al valor (el bloque extraído es verbatim del original; el diff es la verificación de no-cambio-de-comportamiento).

### Refactor real de `recomputeManzanosImmediate`

No se hizo la división en 4 funciones puras testeables del plan. Lo que sí se hizo: extraer lo único puramente puro (`computeRoadFingerprintDelta`) y el helper interno con muchos side effects (`applyRelotTasks`), añadir headers de sección, y corregir indent. El cuerpo principal sigue siendo grande (~480 líneas) pero ahora es navegable por secciones comentadas.

### Bug del `resolveLoteLayerId`

El plan mencionaba "corregir el bug de resolveLoteLayerId de la Fase 3, que este archivo también usa". El bug se corrigió en la Fase 3, así que este archivo ya usa la versión correcta.

## Verificación

| Check | Resultado |
| ----- | --------- |
| `npx tsc --noEmit` | ✅ sin output (0 errores) |
| `npm run lint` | ✅ 0 errors / 3 warnings (idéntico a baseline post-Fase 3 — los 3 warnings son preexistentes en `LayerPanel`, `StatsPanel`, `Map.tsx`) |
| `npm test` (Vitest) | ✅ 84/84 passed (9 files, 5.25s) — incluye los 8 tests nuevos de `computeRoadFingerprintDelta` |
| `npm run build` | ✅ OK en 17.33s (bundle ~1,153 kB / gzip ~342 kB — sin delta material) |

## Riesgo y reversibilidad

- **Riesgo en runtime:** bajo. El refactor es 95% movimiento de bloques verbatim y cambio de indent. El 5% restante es `computeRoadFingerprintDelta` cuya lógica es 1:1 con el código original.
- **Reversibilidad:** trivial. `git revert` del commit revierte los 3 archivos (`recomputeManzanos.ts`, `recomputeManzanos.test.ts`, `Command.ts`, `layersRegistryStore.ts`). Los tests de Fase 3 + Fase 4 (84 totales) fijan el comportamiento esperado.
- **Qué NO valida esta fase:** el flujo completo `recomputeManzanos()` con un layout sintético. La validación del flujo IPC-completo queda para la suite Rust y para QA manual con Ctrl+Shift+D en DebugPanel (el bench sintético `runSyntheticUrbanBenchmarkSuite` ya existe y se puede correr).

## Lo que la Fase 4 **no** toca (queda para fases futuras o decisión de producto)

- División profunda de `recomputeManzanosImmediate` en funciones puras testeables — requiere mocks del IPC Tauri.
- Reutilización forzada entre `recomputeManzanosImmediate` y `reapplyRoadCornerMode` — los contratos son distintos y forzar el reuso cambia comportamiento.
- Optimización de `collectOriginGroups`/`collectRootGroups` para evitar recorrer todo `drawSource` en cada recompute (mencionada en Fase 8 del plan; depende de tener refactor previo).
- Renombre cosmético de `restoreMemberToParcel` a `restoreParcelToOrigin` (sugerido por el plan; no aporta, no se hizo).