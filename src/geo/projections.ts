import type Geometry from 'ol/geom/Geometry.js';

export const GEOGRAPHIC_PROJECTION = 'EPSG:4326';
export const DISPLAY_PROJECTION = 'EPSG:3857';

// MVP: el mapa trabaja en Web Mercator. La seleccion de UTM/local CRS queda
// encapsulada aca para no tocar calculos ni estilos cuando se agregue.
export const METRIC_WORK_PROJECTION = DISPLAY_PROJECTION;

export function cloneGeometryForMetricWork<T extends Geometry>(geometry: T) {
  return geometry.clone() as T;
}
