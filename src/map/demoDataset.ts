import { Feature } from 'ol';
import { Polygon } from 'ol/geom';
import { fromLonLat } from 'ol/proj';

/**
 * Genera una cuadrícula sintética de N×N polígonos centrada en Viacha.
 * Cada celda es de 4×4 m con separación de 1 m (simula lotes/manzanas).
 * Útil para probar rendimiento de WebGLVectorLayer con miles de features.
 */
export function generateDemoGrid(countPerSide: number = 100): Feature<Polygon>[] {
  const cellSize = 4;   // m por lado del polígono
  const gap = 1;        // m entre celdas
  const step = cellSize + gap;
  const totalSize = countPerSide * step;
  const half = totalSize / 2;

  // Centro en Viacha, La Paz (EPSG:3857)
  const [cx, cy] = fromLonLat([-68.30, -16.65]);
  const startX = cx - half;
  const startY = cy - half;

  const features: Feature<Polygon>[] = [];
  for (let i = 0; i < countPerSide; i++) {
    for (let j = 0; j < countPerSide; j++) {
      const x = startX + i * step;
      const y = startY + j * step;
      const polygon = new Polygon([
        [
          [x, y],
          [x + cellSize, y],
          [x + cellSize, y + cellSize],
          [x, y + cellSize],
          [x, y],
        ],
      ]);
      features.push(new Feature({ geometry: polygon }));
    }
  }
  return features;
}
