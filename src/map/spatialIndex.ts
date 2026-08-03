import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import RBush from 'rbush';
import { recordGeometrySanitizeEvent } from '../store/debug/geometryTelemetry';

interface RBushItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  featureId: string | number;
}

function isFiniteExtent(e: number[] | null | undefined): e is [number, number, number, number] {
  return (
    !!e &&
    e.length === 4 &&
    Number.isFinite(e[0]) &&
    Number.isFinite(e[1]) &&
    Number.isFinite(e[2]) &&
    Number.isFinite(e[3])
  );
}

export class SpatialIndex {
  private tree: RBush<RBushItem>;
  private _size = 0;
  private featureMap = new Map<string | number, Feature<Polygon>>();
  private itemMap = new Map<string | number, RBushItem>();

  constructor() {
    this.tree = new RBush<RBushItem>(16);
  }

  load(features: Feature<Polygon>[]): void {
    const items: RBushItem[] = [];
    this.featureMap.clear();
    this.itemMap.clear();
    let dropped = 0;
    for (const f of features) {
      const geom = f.getGeometry();
      if (!geom) continue;
      const id = f.getId();
      if (id === undefined) continue;
      const extent = geom.getExtent();
      if (!isFiniteExtent(extent)) {
        dropped++;
        continue;
      }
      const item: RBushItem = { minX: extent[0], minY: extent[1], maxX: extent[2], maxY: extent[3], featureId: id };
      items.push(item);
      this.featureMap.set(id, f);
      this.itemMap.set(id, item);
    }
    if (dropped > 0) {
      recordGeometrySanitizeEvent('spatialIndex.load.nonFiniteBbox', { dropped, total: features.length });
    }
    this.tree.clear();
    this.tree.load(items);
    this._size = items.length;
  }

  insert(feature: Feature<Polygon>): void {
    const geom = feature.getGeometry();
    if (!geom) return;
    const id = feature.getId();
    if (id === undefined) return;
    if (this.itemMap.has(id)) this.removeById(id);
    const extent = geom.getExtent();
    if (!isFiniteExtent(extent)) {
      recordGeometrySanitizeEvent('spatialIndex.insert.nonFiniteBbox', { featureId: id });
      return;
    }
    const item: RBushItem = { minX: extent[0], minY: extent[1], maxX: extent[2], maxY: extent[3], featureId: id };
    this.tree.insert(item);
    this.itemMap.set(id, item);
    this.featureMap.set(id, feature);
    this._size++;
  }

  update(feature: Feature<Polygon>): void {
    this.insert(feature);
  }

  remove(feature: Feature<Polygon>): void {
    const id = feature.getId();
    if (id === undefined) return;
    this.removeById(id);
  }

  private removeById(id: string | number): void {
    const item = this.itemMap.get(id);
    if (!item) return;
    this.tree.remove(item, (a, b) => a.featureId === b.featureId);
    this.itemMap.delete(id);
    this.featureMap.delete(id);
    this._size--;
  }

  search(minX: number, minY: number, maxX: number, maxY: number): Feature<Polygon>[] {
    const results = this.tree.search({ minX, minY, maxX, maxY });
    const features: Feature<Polygon>[] = [];
    for (const item of results) {
      const f = this.featureMap.get(item.featureId);
      if (f) features.push(f);
    }
    return features;
  }

  searchPoint(x: number, y: number, tolerance: number): Feature<Polygon>[] {
    return this.search(x - tolerance, y - tolerance, x + tolerance, y + tolerance);
  }

  get size(): number {
    return this._size;
  }

  clear(): void {
    this.tree.clear();
    this.featureMap.clear();
    this.itemMap.clear();
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