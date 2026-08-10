# label-engine

## Responsabilidad

Etiquetado de entidades (manzanos, lotes, calles, rotondas): modelo de estilos, numeración (numérico / alfabético / romano / circled / parent-dash / parent-compact), comandos de aplicación, painter de etiquetas, modal de configuración.

## API pública (`index.ts`)

- Model: `labelModel`, `labelNumbering` (`toRomanNumeral`, `toCircledNumber`, `formatOrderLabel`, `LABEL_NUMBERING_MODES`).
- Comandos: `ApplyEntityLabelConfigCommand`, `ApplyManzanoLabelsCommand`, `ApplyLotsLabelsCommand`, `RotateLabelCommand`.
- Store: `useEntityLabelStore`.
- Painter: `LabelPainter` (consumido por `map-core`).
- Modos: `LabelOrderMode`, `LabelNumberingMode`.
- UI: `LabelConfigModal`, `LabelManzanoCard`, `LabelLotCard`.

## Dependencias permitidas

- `kernel`, `layers-engine`, `vias-engine`, `manzanos-engine`, `lotificacion-engine`, `georef-engine`.

## Excepciones documentadas

- `label-engine/model/labelModel.ts` es importado con `import type` por `@kernel/domain-model/featureModel` (resuelve el ciclo: el contrato vive en kernel, la implementación en label-engine).