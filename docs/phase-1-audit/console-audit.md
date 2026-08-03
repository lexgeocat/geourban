# Fase 1.3 — Auditoría de console.*

26 ocurrencias en `src/`. Clasificadas en 3 grupos según el criterio del plan (Fase 1.3):

- **A — Error genuino**: falla de operación que importa al usuario (IPC, undo, integridad). **Se queda como está**, no se gatea.
- **B — Telemetría de desarrollo**: diagnóstico no-crítico que hoy se imprime siempre, debería gatearse por `import.meta.env.DEV`.
- **C — Caso intermedio**: el plan lo trata en otra fase (Fase 2 — `geometryTelemetry` específicamente).

| # | Archivo:línea                                            | Mensaje (resumido)                                                                                  | Clasif. | Notas |
| - | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------- | ----- |
| 1  | `commands/core/CommandStack.ts:109`                      | `console.warn` — comando sin `undo()` implementado                                                  | **A**   | Indica un bug del consumidor de CommandStack; el log es la única señal visible. |
| 2  | `commands/core/CommandStack.ts:113`                      | `console.error` — `undo()` lanzó                                                                     | **A**   | Falla de undo, debe verse. |
| 3  | `commands/core/CommandStack.ts:153`                      | `console.error` — `redo()` lanzó                                                                     | **A**   | Idem. |
| 4  | `geo/crs/affineCache.ts:79`                              | `console.warn` — fit inválido recargado                                                              | **B**   | Diagnóstico de caché; tolerable pero debería gatearse. |
| 5  | `geo/recomputeManzanos.ts:551`                           | `console.error` — unión/diferencia de red vial falló                                                 | **A**   | Falla de operación. |
| 6  | `geo/recomputeManzanos.ts:560`                           | `console.warn` — N fragmentos descartados por geometría degenerada                                  | **A→B** | **Ver Fase 2**: si el conteo se mantiene en memoria y el log solo se imprime al abrir el panel de debug, pasa a B. |
| 7  | `geo/recomputeManzanos.ts:626`                           | `console.error` — idem variante                                                                       | **A**   | Falla de operación. |
| 8  | `geo/recomputeManzanos.ts:732`                           | `console.warn` — variante                                                                            | **B**   | Diagnóstico, gatear. |
| 9  | `geo/recomputeManzanos.ts:884`                           | `console.error` — re-lotización automática falló                                                     | **A**   | Falla de operación. |
| 10 | `geo/recomputeManzanos.ts:990`                           | `console.error` — `reapplyRoadCornerMode` falló                                                      | **A**   | Falla de operación. |
| 11 | `geo/recomputeManzanos.ts:1000`                          | `console.warn` — fragmentos descartados (variante)                                                   | **A→B** | Idem #6. |
| 12 | `geo/recomputeManzanos.ts:1056`                          | `console.error` — idem                                                                                | **A**   | Falla de operación. |
| 13 | `hooks/useManzanoActions.ts:75`                          | `console.error` — preview de lotes falló                                                              | **A**   | Falla de operación. |
| 14 | `map/scene/DrawLayerRenderer.ts:43`                      | `console.warn` — diagnóstico                                                                          | **B**   | Gatear. |
| 15 | `map/scene/PostrenderPainter.ts:196`                     | `console.warn` — diagnóstico de features visibles                                                     | **B**   | **YA** está gateado por `import.meta.env.DEV` (confirmado en lectura del archivo). |
| 16 | `map/scene/modes/EditMode.ts:41`                         | `console.warn` — `modifyend` sin `modifystart`                                                        | **A**   | Indica inconsistencia de eventos; el log protege la corrección del undo. |
| 17 | `map/scene/modes/EditMode.ts:68`                         | `console.warn` — `translateend` sin `translatestart`                                                  | **A**   | Idem. |
| 18 | `map/scene/painters/StreetPainter.ts:280`                | `console.error` — no se pudo calcular red vial                                                        | **A**   | Falla de operación. |
| 19 | `store/debug/geometryTelemetry.ts:56`                    | `console.warn` + `JSON.stringify` — evento de saneo de geometría                                     | **C**   | **Caso explícito del plan Fase 1.3 / 2.4**: se resuelve en Fase 2 al gatear `recordGeometrySanitizeEvent`. |
| 20 | `store/map/mapStore.ts:110`                              | `console.warn` — diagnóstico                                                                          | **B**   | Gatear. |
| 21 | `workers/geoWorkerClient.ts:204`                         | `console.error` — `computeManzanos` falló en motor nativo                                            | **A**   | Falla IPC, crítico. |
| 22 | `workers/geoWorkerClient.ts:219`                         | `console.error` — `subdivide` falló en motor nativo                                                   | **A**   | Idem. |
| 23 | `workers/geoWorkerClient.ts:237`                         | `console.error` — `subdivide_manzano` falló en motor nativo                                          | **A**   | Idem. |
| 24 | `workers/geoWorkerClient.ts:258`                         | `console.error` — `subdivide_manzano_batch` falló                                                     | **A**   | Idem. |
| 25 | `workers/geoWorkerClient.ts:275`                         | `console.error` — `computeRoadNetworkNet` falló                                                       | **A**   | Idem. |
| 26 | `workers/geoWorkerClient.ts:301`                         | `console.error` — `matchFragmentsBatch` falló                                                         | **A**   | Idem. |

## Resumen

- **A — se quedan como están:** 17 ocurrencias (todas las de `CommandStack`, las `console.error` de `recomputeManzanos`/`useManzanoActions`/`StreetPainter`/`geoWorkerClient`, y los warnings de inconsistencia de eventos de `EditMode`).
- **B — gatear con `import.meta.env.DEV` en Fase 2/8:** 7 ocurrencias (`affineCache.ts:79`, `recomputeManzanos.ts:732`, `DrawLayerRenderer.ts:43`, `mapStore.ts:110`, más los 2 warnings de "fragmentos descartados" #6 y #11 una vez que se respete la decisión de la Fase 2 sobre `geometryTelemetry`).
- **C — se resuelve en Fase 2 explícitamente:** 1 ocurrencia (`geometryTelemetry.ts:56`). El plan ya lo trata.
- **Ya gated:** 1 ocurrencia (`PostrenderPainter.ts:196`).

Total: 26 = 17 A + 7 B + 1 C + 1 ya gated.

> **Decisión a confirmar:** los warnings de "fragmentos descartados por geometría degenerada" (líneas 560 y 1000 de `recomputeManzanos.ts`) están en el límite A/B. Si el conteo ya se mantiene en memoria para el panel de debug, deberían seguir el mismo patrón que `geometryTelemetry` (conteo siempre, log solo en dev). Eso es un cambio a confirmar con el equipo, no se aplica unilateralmente en esta fase.
