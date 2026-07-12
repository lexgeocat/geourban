import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import RBush from 'rbush';



interface RBushItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  featureId: string | number;
}

export class SpatialIndex {
  private tree: RBush<RBushItem>;
  private _size = 0;
  private featureMap = new Map<string | number, Feature<Polygon>>();

  constructor() {
    this.tree = new RBush<RBushItem>(16);
  }

  /** Carga masiva (reemplaza todo el índice) */
  load(features: Feature<Polygon>[]): void {
    const items: RBushItem[] = [];
    this.featureMap.clear();
    for (const f of features) {
      const geom = f.getGeometry();
      if (!geom) continue;
      const extent = geom.getExtent();
      const id = f.getId();
      if (id === undefined) continue;
      items.push({ minX: extent[0], minY: extent[1], maxX: extent[2], maxY: extent[3], featureId: id });
      this.featureMap.set(id, f);
    }
    this.tree.clear();
    this.tree.load(items);
    this._size = items.length;
  }

  /** Insert incremental (un feature) */
  insert(feature: Feature<Polygon>): void {
    const geom = feature.getGeometry();
    if (!geom) return;
    const id = feature.getId();
    if (id === undefined) return;
    const extent = geom.getExtent();
    this.tree.insert({ minX: extent[0], minY: extent[1], maxX: extent[2], maxY: extent[3], featureId: id });
    this.featureMap.set(id, feature);
    this._size++;
  }

  /** Remove incremental (un feature) */
  remove(feature: Feature<Polygon>): void {
    const id = feature.getId();
    if (id === undefined) return;
    const geom = feature.getGeometry();
    if (!geom) return;
    const extent = geom.getExtent();
    this.tree.remove({ minX: extent[0], minY: extent[1], maxX: extent[2], maxY: extent[3], featureId: id });
    this.featureMap.delete(id);
    this._size--;
  }

  /** Buscar features por bbox */
  search(minX: number, minY: number, maxX: number, maxY: number): Feature<Polygon>[] {
    const results = this.tree.search({ minX, minY, maxX, maxY });
    const features: Feature<Polygon>[] = [];
    for (const item of results) {
      const f = this.featureMap.get(item.featureId);
      if (f) features.push(f);
    }
    return features;
  }

  /** Buscar features cerca de un punto */
  searchPoint(x: number, y: number, tolerance: number): Feature<Polygon>[] {
    return this.search(x - tolerance, y - tolerance, x + tolerance, y + tolerance);
  }

  get size(): number {
    return this._size;
  }

  clear(): void {
    this.tree.clear();
    this.featureMap.clear();
    this._size = 0;
  }
}

let globalSpatialIndex: SpatialIndex | null = null;

export function getOrCreateSpatialIndex(): SpatialIndex {
  if (!globalSpatialIndex) {
    globalSpatialIndex = new SpatialIndex();
  }
  return globalSpatialIndex;
}


