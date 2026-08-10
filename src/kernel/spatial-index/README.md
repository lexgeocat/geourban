# spatial-index

Dos implementaciones del mismo concepto, con clientes distintos:

## `spatialIndex.ts` — RBush (JS, síncrono)
- **Cliente único**: `snap-engine/geometry/advancedSnap.ts:258` (`searchPoint`).
- Necesita ser **síncrono** porque corre dentro del event handler `handleEvent_` de
  la `SnapEngine` (OpenLayers no soporta `handleEvent` async — ver issue abajo).

## `rustSpatialIndex.ts` — rstar vía Tauri (async)
- **Clientes**:
  - `selection-engine/geometry/hitTest.ts` (hit-test, async).
  - `map-core/scene/PostrenderPainter.ts` (culling de visibilidad, con cache por extent).
- Mantenido en background via `queueRustSpatialUpsert/Remove` en cada
  `addfeature`/`removefeature`/`changefeature` del `Map.tsx`.

## Duplicación residual (no eliminable sin cambios en OL)

Por cada evento `addfeature`/`removefeature`/`changefeature`, los dos índices
reciben la actualización. El RBush queda como backing **exclusivo del snap
broad-phase**; el Rust index es la fuente de verdad para hit-test y culling.

**Issue abierta — F5.fin**: eliminar el RBush completamente requeriría que
`OpenLayers.handleEvent` aceptara `Promise<boolean>`, lo cual no soporta. Las
alternativas son:

1. Parchar las `Draw` / `Modify` interactions para esperar una Promise
   del snap antes de procesar el coordinate (alto riesgo, alto costo de
   mantenimiento).
2. Implementar el snap broad-phase en Rust y exponerlo vía `invoke` con
   caching agresivo del lado JS (esencialmente un RBush local mirror —
   solo cambia la dependencia de runtime, no la duplicación).
3. Reemplazar la `SnapEngine` por una implementación propia que controle
   el flujo de events sin pasar por `handleEvent` (workaround de OL).

Mientras ninguna de las tres se implemente, el RBush se mantiene como
dependencia síncrona y el Rust index corre en paralelo.
