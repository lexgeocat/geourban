# manzanos-engine

## Responsabilidad

Identidad y naming de manzanos, orquestación de `recomputeManzanos` (la operación cross-engine más compleja: reconciliación de fragmentos + relot condicional), status de recompute, panel UI.

Cierra el acoplamiento bidireccional `vias-engine ↔ manzanos-engine`.

## API pública (`index.ts`)

- `useManzanosStore`, `manzanoStore`, `useManzanoStatusStore`.
- Orquestación: `recomputeManzanos` (función principal), `recomputeSingleManzano`.
- Comandos: `SplitManzanoCommand`, `MergeManzanosCommand`, `RenameManzanoCommand`, `ConfirmRelotDialogCommand`.
- UI: `ManzanoPanel`, `ManzanoCard`, `ConfirmRelotDialog`.
- Bridge nativo: `computeManzanosInWorker`, `matchFragmentsBatchInWorker` (vía `@kernel/native/geoWorkerClient`).

## Dependencias permitidas

- `kernel`, `layers-engine`, `georef-engine`, `vias-engine`, `lotificacion-engine`.

## Excepciones documentadas

- **Bidireccionalidad con `vias-engine`**: cuando `vias-engine` modifica la red vial, dispara `recomputeManzanos`; cuando `manzanos-engine` recalcula manzanos, puede relotizar (lo que dispara `lotificacion-engine`). Implementado con `subscribe` a los stores — sin imports directos circulares.