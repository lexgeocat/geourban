# vias-engine

## Responsabilidad

Red vial: calles, rotondas, network geometry (intersección de anillos con tratamiento de esquinas fillet/chamfer/rectas), painter de calles, paneles UI.

**Conexión con el resto:**
- Registra fuentes de snap en el registry (`extraSnapSources`).
- Registra interceptores de borrado en el registry (`eraseInterceptors`).
- Bridge al motor nativo Rust (unión booleana de la red vial vía `geoWorkerClient`).

## API pública (`index.ts`)

- Stores: `useStreetStore`, `useRoundaboutStore`.
- Comandos: `CreateStreetCommand`, `DeleteStreetCommand`, `RoundaboutCreateCommand`, etc.
- Painters: `StreetPainter`, `RoundaboutPainter`.
- UI: `RoundaboutPanel`, `StreetPanel`, `IntersectionListModal`.
- Geometry: `roadNetworkEngine`, `roundaboutEngine`, `ringFillet` (preview cliente; motor autoritativo en Rust).
- Registraciones en `@kernel` extension points (al importar `vias-engine`).

## Dependencias permitidas

- `kernel`, `layers-engine`, `georef-engine`, `manzanos-engine`.

## Excepciones documentadas

- **Dependencia bidireccional con `manzanos-engine`**: `vias-engine` debe reaccionar a cambios de manzanos (recompute), y `manzanos-engine` debe reaccionar a cambios de calles. Se resuelve con `subscribe` a los stores (no con imports directos).