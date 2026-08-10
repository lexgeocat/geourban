# georef-engine

## Responsabilidad

Georreferenciación y métricas: "¿cuántos metros reales son estas coordenadas?". Maneja CRS (lat/lon, UTM, custom), cálculo de áreas/longitudes en metros, distancia entre puntos, etiquetas de zona UTM.

**No conoce** features específicos — solo operaciones métricas sobre coordenadas.

## API pública (`index.ts`)

- `DISPLAY_PROJECTION`, `getProjection`, `setCustomCRS` — CRS y conversiones.
- `refreshSourceMetrics`, `polyAreaMetric`, `ringPerimeterMetric`, `polygonCentroid`, `polygonAreaMetric` — métricas en m² / metros lineales.
- `utmZoneLabelFor`, `formatMetricLength` — etiquetas de zona UTM y formateo de longitud.
- `streetLengthMetricM`, `SegmentMetric` — métricas específicas para calles (consumidas por `vias-engine`).
- `invalidateAffineCache` — invalidación cuando cambia el CRS.

## Dependencias permitidas

- `kernel` (siempre — usa `polygonEngine`, `dist`).

## Excepciones documentadas

- Consumido por casi todos los engines para mostrar distancias/áreas en UI.