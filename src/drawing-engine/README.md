# drawing-engine

## Responsabilidad

Herramientas genéricas de dibujo (polígono/línea/rectángulo/erase) + comandos genéricos de features. **"Dibujar una geometría cualquiera"** es agnóstico de si es un lote o un perímetro.

## API pública (`index.ts`)

- Modos: `PolygonMode`, `LineMode`, `RectMode`, `EraseMode`, `ModifyMode`.
- Comandos: `DeleteFeaturesCommand`, `CreateFeaturesCommand`, `EditFeatureGeometryCommand`.
- `PropertyPanel` — panel de propiedades del feature seleccionado.
- `styleFactory` — generador de estilos vectoriales por kind.
- `eraseInterceptors` — handle del registry: los engines de dominio lo usan para interceptar borrados.
  ```ts
  extensionPoints.eraseInterceptors.register('vias:street', (id) => removeStreet(id));
  ```

## Dependencias permitidas

- `kernel`, `layers-engine`.

## Excepciones documentadas

- `EraseMode` originalmente importaba `@vias-engine/store/*` y `@manzanos-engine/orchestration/recomputeManzanos`. Esos imports se **eliminaron** moviendo el código a las registraciones en los engines de dominio vía `eraseInterceptors.register(...)`.