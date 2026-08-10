# map-core

## Responsabilidad

**Composition root del mapa**: ensambla modos/painters de TODOS los demás engines, configura la `Map` de OpenLayers, los painters de postrender, los controllers de modos de interacción.

Único engine con permiso para importar modos/painters de **todos** los demás. Cualquier engine de dominio que importe algo de map-core es un bug arquitectónico.

## API pública (`index.ts`)

- `MapView` (componente default export de `Map.tsx`) — el canvas OpenLayers.
- `baseMaps`, `cadGridLayer` — capas base y grilla CAD.
- `BaseLayerManager`, `DrawLayerRenderer`, `PostrenderPainter`, `InteractionModeController` — piezas internas consumidas por `Map.tsx`.
- Stores globales del runtime del mapa: `useMapStore`, `useDrawStore` (en `map-core/store/`).

## Dependencias permitidas

- `*` (todos los engines). Es el ÚNICO composition root del mapa.

## Excepciones documentadas

- `useMapStore` y `useDrawStore` viven en `map-core/store/`. Son consumidos por prácticamente todos los engines vía `@map-core/store/mapStore` y `@map-core/store/drawStore`.