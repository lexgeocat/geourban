import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import { fromLonLat } from 'ol/proj';
import * as turf from '@turf/turf';
import { Geometry } from 'ol/geom';
import GeoJSON from 'ol/format/GeoJSON';

/**
 * Simplifica una geometría usando Turf.js.
 * @param geom - Geometría OpenLayers.
 * @param tolerance - Tolerancia de simplificación (en metros).
 */
const simplifyGeometry = (geom: Geometry, tolerance: number = 0.5): Geometry => {
  const format = new GeoJSON();
  const geojson = format.writeGeometryObject(geom);
  const simplified = turf.simplify(geojson, { tolerance, highQuality: true });
  return format.readGeometry(simplified);
};

/**
 * Genera una cuadrícula sintética de N×N polígonos centrada en Viacha.
 * Cada celda es de 4×4 m con separación de 1 m (simula lotes/manzanas).
 * Útil para probar rendimiento de WebGLVectorLayer con miles de features.
 */
export function generateDemoGrid(countPerSide: number = 100): Feature<Polygon>[] {
  const cellSize = 4; // m por lado del polígono
  const gap = 1; // m entre celdas
  const step = cellSize + gap;
  const totalSize = countPerSide * step;
  const half = totalSize / 2;

  // Centro en Viacha, La Paz (EPSG:3857)
  const [cx, cy] = fromLonLat([-68.3, -16.65]);
  const startX = cx - half;
  const startY = cy - half;

  const features: Feature<Polygon>[] = [];
  for (let i = 0; i < countPerSide; i++) {
    for (let j = 0; j < countPerSide; j++) {
      const x = startX + i * step;
      const y = startY + j * step;
       let polygon = new Polygon([
         [
           [x, y],
           [x + cellSize, y],
           [x + cellSize, y + cellSize],
           [x, y + cellSize],
           [x, y],
         ],
       ]);
       // Simplificar geometrías para zooms alejados
       if (countPerSide > 50) {
         polygon = simplifyGeometry(polygon, 0.5) as Polygon;
       }
       features.push(new Feature({ geometry: polygon }));
    }
  }
  return features;
}
