import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type VectorSource from 'ol/source/Vector.js';

/**
 * Fase 3.1 (auditoria-para-mejora.md, §6, Fase 3) — formato de diff
 * estructural para undo/redo.
 *
 * Reemplaza el snapshot GeoJSON del proyecto COMPLETO
 * (`commands/core/drawSourceSnapshot.ts`, usado hasta ahora por
 * AddStreetCommand/AddRoundaboutCommand — el bug crítico de §2.1) por un
 * registro de SOLO los features realmente tocados por una operación:
 * proporcional al tamaño del cambio, no al tamaño total del proyecto.
 *
 * Mismo principio que ya usan ModifyGeometryCommand/DeleteFeaturesCommand/
 * RemoveLayerCommand (captura manual de "antes" justo antes de mutar),
 * generalizado acá a cualquier comando que dispare `recomputeManzanos()`
 * — ver Fase 3.0: reutiliza el mismo cómputo de grupos/extent afectados
 * que `recomputeManzanosImmediate` ya hacía, en vez de diseñar el diff en
 * el vacío.
 */

export type FeatureId = string | number;

export interface FeatureSnapshot {
  id: FeatureId;
  geometry: Geometry;
  props: Record<string, unknown>;
}

export interface StructuralDiff {
  /** Features que no existían antes de la operación y sí existen después. */
  added: FeatureSnapshot[];
  /** Features que existían antes y no existen después. */
  removed: FeatureSnapshot[];
  /** Features que existían en ambos momentos pero cambiaron (geometría y/o props). */
  modified: Array<{ id: FeatureId; before: FeatureSnapshot; after: FeatureSnapshot }>;
}

export const EMPTY_STRUCTURAL_DIFF: Readonly<StructuralDiff> = Object.freeze({
  added: [],
  removed: [],
  modified: [],
});

export function isEmptyStructuralDiff(diff: StructuralDiff): boolean {
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

/**
 * Graba, de forma manual y explícita, qué features fueron
 * agregados/eliminados/modificados durante una operación — sin recorrer
 * ni snapshotear el resto del drawSource.
 *
 * Contrato para el caller (igual que ModifyGeometryCommand.captureBefore):
 *   - `recordAdd(feature)`          — DESPUÉS de `source.addFeature(feature)`.
 *   - `recordRemove(feature)`       — ANTES de `source.removeFeature(feature)`.
 *   - `recordModifyBefore(feature)` — ANTES de mutar geometría/props de un
 *     feature ya existente en el source.
 *   - `recordModifyAfter(feature)`  — DESPUÉS de esa mutación. Se puede
 *     llamar más de una vez por feature (p. ej. si una misma manzana se
 *     toca en dos pasadas de la misma operación) — cada llamada
 *     actualiza el estado "después" al más reciente, sin perder el
 *     "antes" original capturado la primera vez.
 */
export class StructuralDiffRecorder {
  private addedIds = new Set<FeatureId>();
  private removedById = new Map<FeatureId, FeatureSnapshot>();
  private modifiedBeforeById = new Map<FeatureId, FeatureSnapshot>();
  private modifiedAfterById = new Map<FeatureId, FeatureSnapshot>();

  recordAdd(feature: Feature<Geometry>): void {
    const id = feature.getId();
    if (id == null) return;
    if (this.removedById.has(id)) {
      // Se había registrado como removido y reaparece con el mismo id
      // dentro de la misma operación: neto cero, no es un "add" real.
      this.removedById.delete(id);
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

  isEmpty(): boolean {
    return this.addedIds.size === 0 && this.removedById.size === 0 && this.modifiedAfterById.size === 0;
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
  const coordBytes = typeof g.getFlatCoordinates === 'function' ? g.getFlatCoordinates().length * 8 : 256;
  return coordBytes + 96;
}

export function approxStructuralDiffBytes(diff: StructuralDiff): number {
  let total = 0;
  for (const s of diff.added) total += approxFeatureSnapshotBytes(s);
  for (const s of diff.removed) total += approxFeatureSnapshotBytes(s);
  for (const m of diff.modified) total += approxFeatureSnapshotBytes(m.before) + approxFeatureSnapshotBytes(m.after);
  return total;
}

/**
 * Compone dos diffs SECUENCIALES (`base` ocurrió, después `next`) en un
 * único diff equivalente al efecto neto de aplicar ambos en orden.
 *
 * Es lo que permite que comandos coalescidos (varios trazos dentro de la
 * misma sesión de dibujo — ver `coalesceInto`) sigan teniendo undo/redo
 * correcto: un mismo feature puede haber sido tocado por más de un
 * `recomputeManzanos()` dentro de la misma sesión, y concatenar los
 * diffs a lo bruto solo revertiría el último paso, no el efecto
 * acumulado completo.
 */
export function composeStructuralDiffs(base: StructuralDiff, next: StructuralDiff): StructuralDiff {
  if (isEmptyStructuralDiff(base)) return next;
  if (isEmptyStructuralDiff(next)) return base;

  const addedById = new Map<FeatureId, FeatureSnapshot>(base.added.map((s) => [s.id, s]));
  const removedById = new Map<FeatureId, FeatureSnapshot>(base.removed.map((s) => [s.id, s]));
  const modifiedById = new Map<FeatureId, { before: FeatureSnapshot; after: FeatureSnapshot }>(
    base.modified.map((m) => [m.id, { before: m.before, after: m.after }]),
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
    modified: Array.from(modifiedById.entries()).map(([id, { before, after }]) => ({ id, before, after })),
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