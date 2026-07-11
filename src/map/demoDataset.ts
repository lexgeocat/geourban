import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import { fromLonLat } from 'ol/proj';
import * as turf from '@turf/turf';
import { Geometry } from 'ol/geom';
import GeoJSON from 'ol/format/GeoJSON';
import RBush from 'rbush';

/* ================================================================
   DATASET SINTETICO CON LOD + INDICE ESPACIAL (R-Tree via RBush)
   ================================================================
   1. LOD: cada feature tiene 3 niveles de geometria y el estilo
      WebGL elige cual usar segun el zoom.
   2. Indice espacial: R-Tree real (rbush 4.x) para consulta O(log n).
   ================================================================ */

/* ---------- Geometria ---------- */

const SIMPLIFY_THRESHOLDS = [0, 0.5, 2.5]; // niveles lod 0,1,2

const simplifyGeometry = (geom: Geometry, tolerance: number): Geometry => {
  const format = new GeoJSON();
  const geojson = format.writeGeometryObject(geom);
  const simplified = turf.simplify(geojson, { tolerance, highQuality: true });
  return format.readGeometry(simplified);
};

/**
 * Genera una cuadricula sintetica de NxN poligonos centrada en Viacha.
 * Cada celda es de 4x4 m con separacion de 1 m (simula lotes/manzanas).
 * Cada feature lleva 3 geometrias LOD para zooms diferentes.
 */
export function generateDemoGrid(countPerSide: number = 100): Feature<Polygon>[] {
  const cellSize = 4;
  const gap = 1;
  const step = cellSize + gap;
  const totalSize = countPerSide * step;
  const half = totalSize / 2;

  const [cx, cy] = fromLonLat([-68.3, -16.65]);
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

      const lod0 = polygon;
      const lod1 =
        countPerSide > 50
          ? (simplifyGeometry(polygon, SIMPLIFY_THRESHOLDS[1]) as Polygon)
          : lod0;
      const lod2 =
        countPerSide > 50
          ? (simplifyGeometry(polygon, SIMPLIFY_THRESHOLDS[2]) as Polygon)
          : lod1;

      const feature = new Feature({ geometry: lod0 });
      feature.setId(`${i}_${j}`);
      feature.set('lod_0', lod0);
      feature.set('lod_1', lod1);
      feature.set('lod_2', lod2);
      feature.set('cell_id', `${i}_${j}`);

      features.push(feature);
    }
  }

  return features;
}

/* ---------- Indice espacial (R-Tree via rbush) ---------- */

interface RBushItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  feature: Feature<Polygon>;
}

/**
 * Wrapper tipado de rbush 4.x para busquedas espaciales O(log n).
 * Sustituye el array lineal con bbox check que tenia antes.
 */
export class SpatialIndex {
  private tree: RBush<RBushItem>;

  constructor(features: Feature<Polygon>[]) {
    this.tree = new RBush<RBushItem>(16);
    this.load(features);
  }

  /** Carga (o recarga) el indice a partir de un array de features */
  load(features: Feature<Polygon>[]): void {
    const items: RBushItem[] = features.map((f) => {
      const extent = f.getGeometry()!.getExtent();
      return {
        minX: extent[0],
        minY: extent[1],
        maxX: extent[2],
        maxY: extent[3],
        feature: f,
      };
    });
    this.tree.clear();
    this.tree.load(items);
  }

  /** Consulta BBox: devuelve features cuyo extent intersecta el rectangulo */
  search(minX: number, minY: number, maxX: number, maxY: number): Feature<Polygon>[] {
    return this.tree.search({ minX, minY, maxX, maxY }).map((i) => i.feature);
  }

  /** Consulta por punto (con tolerancia en metros) */
  searchPoint(x: number, y: number, tolerance = 0.1): Feature<Polygon>[] {
    return this.search(x - tolerance, y - tolerance, x + tolerance, y + tolerance);
  }

  /** Cantidad de items indexados */
  get size(): number {
    return this.tree.all().length;
  }

  /** Libera memoria */
  clear(): void {
    this.tree.clear();
  }
}

let globalSpatialIndex: SpatialIndex | null = null;

/** Crea o reusa el indice espacial global para el dataset demo */
export function buildSpatialIndex(features: Feature<Polygon>[]): SpatialIndex {
  globalSpatialIndex = new SpatialIndex(features);
  return globalSpatialIndex;
}

/** Devuelve el indice global si existe, sino null */
export function getSpatialIndex(): SpatialIndex | null {
  return globalSpatialIndex;
}

/** Invalida el indice espacial (llamar tras modificar features) */
export function invalidateSpatialIndex(): void {
  globalSpatialIndex?.clear();
  globalSpatialIndex = null;
}
