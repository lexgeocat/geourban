# lotificacion-engine

## Responsabilidad

Subdivisión de un manzano en lotes (métodos auto / exact / PCA), rotación manual y por drag, generación batch con progreso/cancelación, preview de corte.

**No conoce** vías. La dependencia hacia `manzanos-engine` se da a través del flujo de relotización.

## API pública (`index.ts`)

- Comandos: `GenerateLotsCommand`, `RecomputeManzanoLotsCommand`, `RotateLotsCommand`, `ApplySubdivisionConfigCommand`.
- Hooks: `useLotsWorkflow`, `useManzanoActions`.
- Store: `useGenerateLotsProgressStore`, `manzanoLotConfigStore`.
- UI: `SubdivisionPreviewPainter`, `SubdivisionMethodModal`.
- Model: `subdivisionMethodLabels`, `subdivisionConfig`.
- Bridge nativo: `subdivideManzanoInWorker`, `subdivideManzanoBatchInWorker` (vía `@kernel/native/geoWorkerClient`).

## Dependencias permitidas

- `kernel`, `layers-engine`, `georef-engine`.

## Excepciones documentadas

- División del antiguo `geoWorkerClient.ts`: la parte específica de subdivisión se consume vía `@kernel/native/geoWorkerClient`.