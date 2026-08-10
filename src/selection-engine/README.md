# selection-engine

## Responsabilidad

Selección (click/rect/lasso), hit-testing y edición de vértices/traslado. **Genérico**: no conoce "calles" ni "lotes" — solo geometría.

## API pública (`index.ts`)

- `useSelectionStore` — IDs seleccionados, capa activa, set de selección.
- `SelectEditMode` — modo principal de selección+edición (point/rect/lasso + Modify).
- `SelectionHighlightPainter`, `LassoOverlayPainter` — painters que se registran en `map-core/scene/PostrenderPainter`.
- `EraseInterceptorHandle` — hook para que drawing-engine registre "no borrar si es de tipo X".

## Dependencias permitidas

- `kernel`, `layers-engine`.

## Excepciones documentadas

- `SelectionHighlightPainter` lee de `@vias-engine/store/streetStore` y `@vias-engine/store/roundaboutStore` (resaltar calles/rotondas seleccionadas). Se resuelve mediante el extension point `entityGeometryProviders` definido en `@selection-engine` — `vias-engine` registra los providers, el painter los consulta sin importar vias-engine directamente.