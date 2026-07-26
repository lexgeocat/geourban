import type Geometry from 'ol/geom/Geometry.js';
import SimpleGeometry from 'ol/geom/SimpleGeometry.js';

export function estimateGeometryBytes(geom: Geometry | null | undefined): number {
  if (!geom) return 0;
  if (geom instanceof SimpleGeometry) {
    return geom.getFlatCoordinates().length * 8;
  }
  return 256;
}
