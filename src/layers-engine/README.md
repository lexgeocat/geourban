# layers-engine

## Responsabilidad

Sistema de capas de trabajo. Cada feature del proyecto pertenece a una capa; las capas tienen visibilidad, bloqueo, color, kind (lote/calle/manzana/etc.) y orden de render. Engine más consumido por el resto (casi todos importan `@layers-engine/store/layersRegistryStore`).

**No conoce** geometría de dominio — solo el catálogo de capas y su jerarquía.

## API pública (`index.ts`)

- `useLayersStore`, `layersRegistryStore` — store global de capas.
- `requireLayerForKind` — resuelve o crea la capa default para un kind (`lote`, `calle`, `manzana`, …).
- `LayerPanel`, `LayerDeleteModal`, `LayerKindBadge` — UI.
- `RemoveLayerCommand`, `RenameLayerCommand`, `ToggleLayerVisibilityCommand` — comandos.
- `computeLayerFeatureCounts`, `pickLayerId`, `layerResolution` — selectores.

## Dependencias permitidas

- `kernel`.

## Excepciones documentadas

- Consumido por prácticamente todos los engines como dependencia universal. La regla `from: 'layers-engine', allow: ['kernel']` aplica en `eslint-plugin-boundaries`. Los demás engines declaran `layers-engine` en su `allow`.