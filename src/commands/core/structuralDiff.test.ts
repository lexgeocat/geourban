import { describe, it, expect } from 'vitest';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import type VectorSource from 'ol/source/Vector.js';
import {
  StructuralDiffRecorder,
  composeStructuralDiffs,
  applyStructuralDiffForward,
  revertStructuralDiff,
  isEmptyStructuralDiff,
  EMPTY_STRUCTURAL_DIFF,
} from './structuralDiff';

function makeFeature(id: string, x: number, y: number) {
  const f = new Feature({ geometry: new Point([x, y]) });
  f.setId(id);
  return f;
}

/** VectorSource mínimo, sin levantar un Map de OL real. */
class FakeSource {
  private byId = new Map<string | number, Feature<any>>();
  getFeatureById(id: string | number) {
    return this.byId.get(id) ?? null;
  }
  addFeature(f: Feature<any>) {
    this.byId.set(f.getId()!, f);
  }
  removeFeature(f: Feature<any>) {
    this.byId.delete(f.getId()!);
  }
  changed() {}
}

function fakeSource() {
  return new FakeSource() as unknown as VectorSource;
}

describe('StructuralDiffRecorder', () => {
  it('recordAdd + toDiff produce un feature agregado', () => {
    const src = fakeSource();
    const rec = new StructuralDiffRecorder();
    const f = makeFeature('a', 0, 0);
    (src as unknown as FakeSource).addFeature(f);
    rec.recordAdd(f);

    const diff = rec.toDiff(src);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].id).toBe('a');
    expect(diff.removed).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
  });

  it('add + remove del mismo id en la misma operación es neto cero', () => {
    const src = fakeSource();
    const rec = new StructuralDiffRecorder();
    const f = makeFeature('a', 0, 0);
    (src as unknown as FakeSource).addFeature(f);
    rec.recordAdd(f);
    rec.recordRemove(f);
    (src as unknown as FakeSource).removeFeature(f);

    expect(isEmptyStructuralDiff(rec.toDiff(src))).toBe(true);
  });

  it('modifyBefore/modifyAfter conservan el "antes" original aunque se mute dos veces', () => {
    const src = fakeSource();
    const rec = new StructuralDiffRecorder();
    const f = makeFeature('a', 0, 0);
    (src as unknown as FakeSource).addFeature(f);

    rec.recordModifyBefore(f);
    f.setGeometry(new Point([1, 1]));
    rec.recordModifyAfter(f);
    f.setGeometry(new Point([2, 2])); // segunda mutación en la misma operación
    rec.recordModifyAfter(f);

    const diff = rec.toDiff(src);
    expect(diff.modified).toHaveLength(1);
    expect((diff.modified[0].before.geometry as Point).getCoordinates()).toEqual([0, 0]);
    expect((diff.modified[0].after.geometry as Point).getCoordinates()).toEqual([2, 2]);
  });

  it('remove de un feature ya modificado degrada a remove puro, con el "antes" original', () => {
    const src = fakeSource();
    const rec = new StructuralDiffRecorder();
    const f = makeFeature('a', 0, 0);
    (src as unknown as FakeSource).addFeature(f);

    rec.recordModifyBefore(f);
    f.setGeometry(new Point([1, 1]));
    rec.recordModifyAfter(f);
    rec.recordRemove(f);
    (src as unknown as FakeSource).removeFeature(f);

    const diff = rec.toDiff(src);
    expect(diff.modified).toHaveLength(0);
    expect(diff.removed).toHaveLength(1);
    expect((diff.removed[0].geometry as Point).getCoordinates()).toEqual([0, 0]);
  });
});

describe('composeStructuralDiffs', () => {
  it('devuelve el otro diff si alguno de los dos está vacío', () => {
    const rec = new StructuralDiffRecorder();
    const src = fakeSource();
    const f = makeFeature('a', 0, 0);
    (src as unknown as FakeSource).addFeature(f);
    rec.recordAdd(f);
    const diff = rec.toDiff(src);

    expect(composeStructuralDiffs(EMPTY_STRUCTURAL_DIFF, diff)).toEqual(diff);
    expect(composeStructuralDiffs(diff, EMPTY_STRUCTURAL_DIFF)).toEqual(diff);
  });

  it('add en base + remove del mismo id en next = neto cero (2 trazos consecutivos que se cancelan)', () => {
    const base = { added: [{ id: 'a', geometry: new Point([0, 0]), props: {} }], removed: [], modified: [] };
    const next = { added: [], removed: [{ id: 'a', geometry: new Point([0, 0]), props: {} }], modified: [] };
    expect(isEmptyStructuralDiff(composeStructuralDiffs(base as any, next as any))).toBe(true);
  });

  it('modify + modify del mismo id: conserva el "antes" de base y el "después" de next', () => {
    const before = { id: 'a', geometry: new Point([0, 0]), props: {} };
    const mid = { id: 'a', geometry: new Point([1, 1]), props: {} };
    const after = { id: 'a', geometry: new Point([2, 2]), props: {} };
    const base = { added: [], removed: [], modified: [{ id: 'a', before, after: mid }] };
    const next = { added: [], removed: [], modified: [{ id: 'a', before: mid, after }] };

    const composed = composeStructuralDiffs(base as any, next as any);
    expect(composed.modified).toHaveLength(1);
    expect((composed.modified[0].before.geometry as Point).getCoordinates()).toEqual([0, 0]);
    expect((composed.modified[0].after.geometry as Point).getCoordinates()).toEqual([2, 2]);
  });
});

describe('applyStructuralDiffForward / revertStructuralDiff', () => {
  it('roundtrip: aplicar → revertir → reaplicar deja el source consistente', () => {
    const src = fakeSource();
    const diff = { added: [{ id: 'b', geometry: new Point([5, 5]), props: {} }], removed: [], modified: [] };

    applyStructuralDiffForward(src, diff as any);
    expect(src.getFeatureById('b')).not.toBeNull();

    revertStructuralDiff(src, diff as any);
    expect(src.getFeatureById('b')).toBeNull();

    applyStructuralDiffForward(src, diff as any);
    expect(src.getFeatureById('b')).not.toBeNull();
  });
});