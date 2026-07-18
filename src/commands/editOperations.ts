import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useMapStore } from '../store/mapStore';
import { useSelectionStore } from '../store/selectionStore';
import { runCommand } from './CommandStack';
import { CopyFeaturesCommand } from './CopyFeaturesCommand';
import { ModifyGeometryCommand } from './ModifyGeometryCommand';
import {
  cloneFeature,
  translateFeature,
  rotateFeature,
  scaleFeature,
  mirrorFeature,
} from '../geo/transforms';

function getSelectedFeatures(): Feature<Geometry>[] {
  const src = useMapStore.getState().drawSource;
  if (!src) return [];
  const out: Feature<Geometry>[] = [];
  useSelectionStore.getState().selectedIds.forEach((id) => {
    const f = src.getFeatureById(id) as Feature<Geometry> | null;
    if (f) out.push(f);
  });
  return out;
}

const COPY_OFFSET = 3;

export async function copySelected(): Promise<boolean> {
  const features = getSelectedFeatures();
  if (features.length === 0) return false;
  const clones: Feature<Geometry>[] = [];
  for (const f of features) {
    const c = cloneFeature(f, { prefix: 'copy' });
    translateFeature(c, COPY_OFFSET * (clones.length + 1), COPY_OFFSET * (clones.length + 1));
    clones.push(c);
  }
  const res = await runCommand(new CopyFeaturesCommand(clones, 'Copiar selección'));
  if (!res.ok) return false;
  const newIds = clones.map((c) => c.getId()).filter((id): id is string | number => id != null);
  useSelectionStore.getState().setSelection(newIds, newIds[0] ?? null);
  return true;
}

export async function rotateSelected(angle: number, anchor: number[]): Promise<boolean> {
  const features = getSelectedFeatures();
  if (features.length === 0) return false;
  const cmd = new ModifyGeometryCommand(features, 'Rotar selección');
  cmd.captureBefore();
  for (const f of features) rotateFeature(f, angle, anchor);
  await runCommand(cmd);
  return true;
}

/** Escala la selección actual por `factor` respecto a `anchor`. */
export async function scaleSelected(factor: number, anchor: number[]): Promise<boolean> {
  const features = getSelectedFeatures();
  if (features.length === 0) return false;
  const cmd = new ModifyGeometryCommand(features, 'Escalar selección');
  cmd.captureBefore();
  for (const f of features) scaleFeature(f, factor, anchor);
  await runCommand(cmd);
  return true;
}

/** Refleja la selección actual sobre el eje definido por `a` y `b`. */
export async function mirrorSelected(a: number[], b: number[]): Promise<boolean> {
  const features = getSelectedFeatures();
  if (features.length === 0) return false;
  const cmd = new ModifyGeometryCommand(features, 'Reflejar selección');
  cmd.captureBefore();
  for (const f of features) mirrorFeature(f, a, b);
  await runCommand(cmd);
  return true;
}
