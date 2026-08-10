import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import RBush from 'rbush';

// ─────────────────────────────────────────────────────────────────────────
// NOTA ARQUITECTÓNICA — DOBLE ÍNDICE ESPACIAL (Fase 6.1 del plan)
//
// Este índice JS (rbush) coexiste **deliberadamente** con el índice
// nativo en Rust expuesto por `rustSpatialIndex.ts`. NO son la misma
// estructura con dos implementaciones — son dos índices distintos que
// sirven a consumidores distintos con requisitos de latencia distintos:
//
//   1. `SpatialIndex` (este archivo, rbush JS) — **síncrono**, latencia
//      ~0.1ms por query. Es el único que usa `SnapEngine`
//      (`snap-engine/geometry/advancedSnap.ts:258`) porque el handler de
//      `pointermove` necesita respuesta inmediata en cada movimiento del
//      cursor mientras el usuario dibuja. Hacer una query async a Rust
//      por frame introduciría lag perceptible.
//
//   2. `queryRustSpatialIndex` (`rustSpatialIndex.ts`, rstar Rust) —
//      **asíncrono**, mayor latencia pero más preciso/escalable. Se usa
//      para hit-test de click/selección
//      (`PostrenderPainter.getVisibleFeatures` para culling de
//      renderizado) donde el await es aceptable.
//
// Ambos índices se mantienen **en paralelo**: cada `addfeature` /
// `removefeature` / `changefeature` dispara la actualización del JS en
// el store de mapa, y la del Rust vía `geoWorkerClient`. Es trabajo
// duplicado intencionalmente — fusionarlos perdería la propiedad de
// respuesta síncrona de SnapEngine y no hay forma de evitarlo sin
// cambiar la arquitectura del motor de dibujo.
//
// NO fusionar sin antes:
//   - Medir el lag real de una query async al Rust en el hot path.
//   - Verificar que el render de OpenLayers tolere la latencia añadida.
//   - Evaluar mover SnapEngine a Web Worker con su propio índice
//     sincronizado por mensajes.
// ─────────────────────────────────────────────────────────────────────────

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
    for (const f of features) {
      const geom = f.getGeometry();
      if (!geom) continue;
      const id = f.getId();
      if (id === undefined) continue;
      const extent = geom.getExtent();
      if (!isFiniteExtent(extent)) {
        continue;
      }
      const item: RBushItem = { minX: extent[0], minY: extent[1], maxX: extent[2], maxY: extent[3], featureId: id };
      items.push(item);
      this.featureMap.set(id, f);
      this.itemMap.set(id, item);
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
}

let globalSpatialIndex: SpatialIndex | null = null;

export function getOrCreateSpatialIndex(): SpatialIndex {
  if (!globalSpatialIndex) {
    globalSpatialIndex = new SpatialIndex();
  }
  return globalSpatialIndex;
}