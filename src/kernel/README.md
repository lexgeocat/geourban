# kernel

## Responsabilidad

Primitivas compartidas por todos los engines: command/undo-redo, índice espacial (cliente + bridge Rust), id/autoName, geometría base, modos, registry de extension points y bridge nativo a Tauri.

**No conoce** qué es un lote, una calle ni una manzana: solo el vocabulario compartido (Pt, Feature, Command, ID).

## API pública (`index.ts`)

- `Command`, `CommandStack`, `commandContext`, `memoryEstimate`, `structuralDiff` — undo/redo y diagnóstico de cambios.
- `FeatureModel` — tipos base de features (Point/LineString/Polygon/multiparte).
- `polygonEngine`, `dist`, `lod` — operaciones geométricas y métricas de zoom.
- `spatialIndex`, `rustSpatialIndex` — RTree local y bridge al RTree de Rust (`@kernel/native`).
- `id`, `autoName` — generación de IDs y nombres auto (A, B, …, AA, AB, …).
- `ModeContext` — contrato que las funciones `activateXxx(ctx)` de todos los engines implementan.
- `ExtensionPointRegistry` — handle de puntos de extensión (`extraSnapSources`, `eraseInterceptors`, etc.).
- `tauriRuntime`, `geoWorkerClient` — fachadas hacia Rust/Tauri.
- `rafThrottle` — utility.

## Dependencias permitidas

- Solo paquetes npm (`zustand`, `ol`, `react`, …). **No importa de otros engines.**

## Excepciones documentadas

- `kernel/domain-model/featureModel.ts` importa `LabelStyleConfig` con `import type` desde `@label-engine/model/labelModel` (resuelve ciclo kernel↔label-engine).
- `kernel/modes/ModeContext.ts` importa `PostrenderPainter` con `import type` desde `@map-core/scene/PostrenderPainter` (el contrato vive en kernel, el implementador concreto en map-core).