import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type SimpleGeometry from 'ol/geom/SimpleGeometry.js';
import type VectorSource from 'ol/source/Vector.js';

export type FeatureId = string | number;

export interface FeatureSnapshot {
  id: FeatureId;
  geometry: Geometry;
  props: Record<string, unknown>;
}

export interface StructuralDiff {
  added: FeatureSnapshot[];
  removed: FeatureSnapshot[];
  modified: Array<{ id: FeatureId; before: FeatureSnapshot; after: FeatureSnapshot }>;
}

export const EMPTY_STRUCTURAL_DIFF: Readonly<StructuralDiff> = Object.freeze({
  added: [],
  removed: [],
  modified: [],
});

function isEmptyStructuralDiff(diff: StructuralDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0;
}

function snapshotFeature(feature: Feature<Geometry>): FeatureSnapshot | null {
  const id = feature.getId();
  const geom = feature.getGeometry();
  if (id == null || !geom) return null;
  const props = { ...feature.getProperties() };
  delete props.geometry;
  return { id, geometry: geom.clone(), props };
}

function snapshotToFeature(snap: FeatureSnapshot): Feature<Geometry> {
  const feature = new Feature({ geometry: snap.geometry.clone() });
  feature.setId(snap.id);
  feature.setProperties(snap.props, true);
  return feature;
}

function snapshotsEquivalent(a: FeatureSnapshot, b: FeatureSnapshot): boolean {
  const fa = (a.geometry as unknown as Partial<SimpleGeometry>).getFlatCoordinates?.();
  const fb = (b.geometry as unknown as Partial<SimpleGeometry>).getFlatCoordinates?.();
  if (!fa || !fb) return false;
  if (fa.length !== fb.length) return false;
  for (let i = 0; i < fa.length; i++) {
    if (fa[i] !== fb[i]) return false;
  }
  return JSON.stringify(a.props) === JSON.stringify(b.props);
}

export class StructuralDiffRecorder {
  private addedIds = new Set<FeatureId>();
  private removedById = new Map<FeatureId, FeatureSnapshot>();
  private modifiedBeforeById = new Map<FeatureId, FeatureSnapshot>();
  private modifiedAfterById = new Map<FeatureId, FeatureSnapshot>();

  recordAdd(feature: Feature<Geometry>): void {
    const id = feature.getId();
    if (id == null) return;
    const removedSnap = this.removedById.get(id);
    if (removedSnap) {
      this.removedById.delete(id);
      const newSnap = snapshotFeature(feature);
      if (newSnap && !snapshotsEquivalent(removedSnap, newSnap)) {
        this.modifiedBeforeById.set(id, removedSnap);
        this.modifiedAfterById.set(id, newSnap);
      }
      return;
    }
    this.addedIds.add(id);
  }

  recordRemove(feature: Feature<Geometry>): void {
    const id = feature.getId();
    if (id == null) return;
    if (this.addedIds.has(id)) {
      this.addedIds.delete(id); // agregado y quitado en la misma operación: neto cero.
      return;
    }
    if (this.modifiedBeforeById.has(id)) {
      const before = this.modifiedBeforeById.get(id)!;
      this.modifiedBeforeById.delete(id);
      this.modifiedAfterById.delete(id);
      this.removedById.set(id, before);
      return;
    }
    if (this.removedById.has(id)) return;
    const snap = snapshotFeature(feature);
    if (snap) this.removedById.set(id, snap);
  }

  recordModifyBefore(feature: Feature<Geometry>): void {
    const id = feature.getId();
    if (id == null) return;
    if (this.addedIds.has(id) || this.modifiedBeforeById.has(id)) return;
    const snap = snapshotFeature(feature);
    if (snap) this.modifiedBeforeById.set(id, snap);
  }

  recordModifyAfter(feature: Feature<Geometry>): void {
    const id = feature.getId();
    if (id == null || this.addedIds.has(id)) return;
    if (!this.modifiedBeforeById.has(id)) return;
    const snap = snapshotFeature(feature);
    if (snap) this.modifiedAfterById.set(id, snap);
  }

  /** Vuelca lo grabado a un `StructuralDiff` — lee de `source` el estado final de los "added"/"modified". */
  toDiff(source: VectorSource): StructuralDiff {
    const added: FeatureSnapshot[] = [];
    for (const id of this.addedIds) {
      const f = source.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) continue;
      const snap = snapshotFeature(f);
      if (snap) added.push(snap);
    }

    const modified: StructuralDiff['modified'] = [];
    for (const [id, before] of this.modifiedBeforeById) {
      const after = this.modifiedAfterById.get(id);
      if (!after) continue;
      modified.push({ id, before, after });
    }

    return { added, removed: Array.from(this.removedById.values()), modified };
  }
}

function approxFeatureSnapshotBytes(snap: FeatureSnapshot): number {
  const g = snap.geometry as unknown as { getFlatCoordinates?: () => number[] };
  const coordBytes =
    typeof g.getFlatCoordinates === 'function' ? g.getFlatCoordinates().length * 8 : 256;
  return coordBytes + 96;
}

export function approxStructuralDiffBytes(diff: StructuralDiff): number {
  let total = 0;
  for (const s of diff.added) total += approxFeatureSnapshotBytes(s);
  for (const s of diff.removed) total += approxFeatureSnapshotBytes(s);
  for (const m of diff.modified)
    total += approxFeatureSnapshotBytes(m.before) + approxFeatureSnapshotBytes(m.after);
  return total;
}

export function composeStructuralDiffs(base: StructuralDiff, next: StructuralDiff): StructuralDiff {
  if (isEmptyStructuralDiff(base)) return next;
  if (isEmptyStructuralDiff(next)) return base;

  const addedById = new Map<FeatureId, FeatureSnapshot>(base.added.map((s) => [s.id, s]));
  const removedById = new Map<FeatureId, FeatureSnapshot>(base.removed.map((s) => [s.id, s]));
  const modifiedById = new Map<FeatureId, { before: FeatureSnapshot; after: FeatureSnapshot }>(
    base.modified.map((m) => [m.id, { before: m.before, after: m.after }])
  );

  for (const snap of next.added) {
    const id = snap.id;
    if (removedById.has(id)) {
      const before = removedById.get(id)!;
      removedById.delete(id);
      modifiedById.set(id, { before, after: snap });
    } else if (addedById.has(id)) {
      addedById.set(id, snap);
    } else if (modifiedById.has(id)) {
      modifiedById.set(id, { before: modifiedById.get(id)!.before, after: snap });
    } else {
      addedById.set(id, snap);
    }
  }

  for (const snap of next.removed) {
    const id = snap.id;
    if (addedById.has(id)) {
      addedById.delete(id);
    } else if (modifiedById.has(id)) {
      const entry = modifiedById.get(id)!;
      modifiedById.delete(id);
      removedById.set(id, entry.before);
    } else if (!removedById.has(id)) {
      removedById.set(id, snap);
    }
  }

  for (const { id, before, after } of next.modified) {
    if (addedById.has(id)) {
      addedById.set(id, after);
    } else if (modifiedById.has(id)) {
      modifiedById.set(id, { before: modifiedById.get(id)!.before, after });
    } else if (!removedById.has(id)) {
      modifiedById.set(id, { before, after });
    }
  }

  return {
    added: Array.from(addedById.values()),
    removed: Array.from(removedById.values()),
    modified: Array.from(modifiedById.entries()).map(([id, { before, after }]) => ({
      id,
      before,
      after,
    })),
  };
}

/** Aplica el estado "after" del diff sobre `source` — usado en redo(). */
export function applyStructuralDiffForward(source: VectorSource, diff: StructuralDiff): void {
  for (const snap of diff.removed) {
    const f = source.getFeatureById(snap.id);
    if (f) source.removeFeature(f);
  }
  for (const snap of diff.added) {
    if (source.getFeatureById(snap.id) != null) continue;
    source.addFeature(snapshotToFeature(snap));
  }
  for (const { id, after } of diff.modified) {
    const f = source.getFeatureById(id) as Feature<Geometry> | null;
    if (!f) continue;
    f.setGeometry(after.geometry.clone());
    f.setProperties(after.props, true);
  }
  source.changed();
}

/** Revierte el diff sobre `source` (vuelve al estado "before") — usado en undo(). */
export function revertStructuralDiff(source: VectorSource, diff: StructuralDiff): void {
  for (const snap of diff.added) {
    const f = source.getFeatureById(snap.id);
    if (f) source.removeFeature(f);
  }
  for (const snap of diff.removed) {
    if (source.getFeatureById(snap.id) != null) continue;
    source.addFeature(snapshotToFeature(snap));
  }
  for (const { id, before } of diff.modified) {
    const f = source.getFeatureById(id) as Feature<Geometry> | null;
    if (!f) continue;
    f.setGeometry(before.geometry.clone());
    f.setProperties(before.props, true);
  }
  source.changed();
}
