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
  /** bbox REALMENTE insertado en el árbol para cada feature. Necesario para
   *  poder removerlo/reindexarlo con seguridad: rbush usa el bbox del item
   *  pasado a `remove()` para podar la búsqueda, así que si reconstruimos
   *  ese bbox desde la geometría ACTUAL (post-edición), puede no coincidir
   *  con el subárbol donde el nodo fue insertado originalmente. */
  private itemMap = new Map<string | number, RBushItem>();

  constructor() {
    this.tree = new RBush<RBushItem>(16);
  }

  /** Carga masiva (reemplaza todo el índice) */
  load(features: Feature<Polygon>[]): void {
    const items: RBushItem[] = [];
    this.featureMap.clear();
    this.itemMap.clear();
    for (const f of features) {
      const geom = f.getGeometry();
      if (!geom) continue;
      const extent = geom.getExtent();
      const id = f.getId();
      if (id === undefined) continue;
      const item: RBushItem = { minX: extent[0], minY: extent[1], maxX: extent[2], maxY: extent[3], featureId: id };
      items.push(item);
      this.featureMap.set(id, f);
      this.itemMap.set(id, item);
    }
    this.tree.clear();
    this.tree.load(items);
    this._size = items.length;
  }

  /** Insert incremental (un feature). Es "insert-safe": si ya existía un
   *  nodo para este id, lo remueve primero — así también sirve para
   *  reindexar tras un cambio de geometría (ver `update`). */
  insert(feature: Feature<Polygon>): void {
    const geom = feature.getGeometry();
    if (!geom) return;
    const id = feature.getId();
    if (id === undefined) return;
    if (this.itemMap.has(id)) this.removeById(id);
    const extent = geom.getExtent();
    const item: RBushItem = { minX: extent[0], minY: extent[1], maxX: extent[2], maxY: extent[3], featureId: id };
    this.tree.insert(item);
    this.itemMap.set(id, item);
    this.featureMap.set(id, feature);
    this._size++;
  }

  /** Reindexa una feature cuya geometría cambió (drag/edit en vivo, evento
   *  `changefeature`). Alias explícito de `insert`, que ya es insert-safe. */
  update(feature: Feature<Polygon>): void {
    this.insert(feature);
  }

  /** Remove incremental (un feature) */
  remove(feature: Feature<Polygon>): void {
    const id = feature.getId();
    if (id === undefined) return;
    this.removeById(id);
  }

  private removeById(id: string | number): void {
    const item = this.itemMap.get(id);
    if (!item) return;
    // Comparamos por featureId (no por referencia de objeto ni por bbox
    // recalculado desde la geometría actual) — así encontramos el nodo
    // real sin importar si la geometría cambió desde el insert original.
    this.tree.remove(item, (a, b) => a.featureId === b.featureId);
    this.itemMap.delete(id);
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