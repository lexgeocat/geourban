# snap-engine

## Responsabilidad

Snapping avanzado: endpoint, midpoint, perpendicular, extensión, intersección, centro. Painter de guías.

**Genérico** sobre geometría. No conoce dominios: las fuentes de snap adicionales (calles, esquinas, etc.) se registran vía `ExtensionPointRegistry` (no por imports directos).

## API pública (`index.ts`)

- `activateSnap` — punto de entrada desde `map-core/scene/PostrenderPainter`.
- `useSnapStore` — estado del modo snap (on/off, tipo prioritario, tolerancia).
- `SnapGuidePainter` — painter que dibuja el hint visual.
- `extraSnapSources` — handle del registry. Los engines de dominio lo consumen:
  ```ts
  import { extensionPoints } from '@kernel';
  extensionPoints.extraSnapSources.register('vias:roadSnapSource', () => source);
  ```

## Dependencias permitidas

- `kernel`, `layers-engine`.

## Excepciones documentadas

- Hoy `vias-engine/index.ts` registra `vias:roadSnapSource` y `vias:roundaboutSnapSource` en el registry. El engine no necesita imports directos.

## Regla de boundaries

- snap-engine puede importar de kernel y layers-engine.