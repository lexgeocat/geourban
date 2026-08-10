import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import {
  spatialIndexLoadInWorker,
  spatialIndexQueryInWorker,
  spatialIndexUpsertBatchInWorker,
  spatialIndexRemoveBatchInWorker,
  type SpatialIndexItem,
} from '@kernel/native/geoWorkerClient';
import { rafThrottle } from '../utils/rafThrottle';

const DRAW_SOURCE_SPATIAL_SLOT = 'draw';

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function extentOf(feature: Feature<Geometry>): [number, number, number, number] | null {
  const geom = feature.getGeometry();
  if (!geom) return null;
  const ext = geom.getExtent();
  if (ext.length !== 4 || !ext.every((v) => Number.isFinite(v))) return null;
  return ext as [number, number, number, number];
}

function toUpsertItem(feature: Feature<Geometry>): SpatialIndexItem | null {
  const id = feature.getId();
  if (id === undefined || id === null) return null;
  const ext = extentOf(feature);
  if (!ext) return null;
  return { id, minX: ext[0], minY: ext[1], maxX: ext[2], maxY: ext[3] };
}

const pendingUpserts = new Map<string | number, SpatialIndexItem>();
const pendingRemovals = new Set<string | number>();

async function dispatchPending(): Promise<void> {
  const tasks: Array<Promise<void>> = [];

  if (pendingUpserts.size > 0) {
    const items = Array.from(pendingUpserts.values());
    pendingUpserts.clear();
    tasks.push(
      spatialIndexUpsertBatchInWorker(items, DRAW_SOURCE_SPATIAL_SLOT)
        .then(() => undefined)
        .catch((err: unknown) => {
          console.error('rustSpatialIndex: upsert en background falló', toErrorMessage(err));
        }),
    );
  }
  if (pendingRemovals.size > 0) {
    const ids = Array.from(pendingRemovals.values());
    pendingRemovals.clear();
    tasks.push(
      spatialIndexRemoveBatchInWorker(ids, DRAW_SOURCE_SPATIAL_SLOT)
        .then(() => undefined)
        .catch((err: unknown) => {
          console.error('rustSpatialIndex: remove en background falló', toErrorMessage(err));
        }),
    );
  }
  if (tasks.length > 0) await Promise.all(tasks);
}

const scheduleAutoFlush = rafThrottle(() => {
  void dispatchPending();
});

export function queueRustSpatialUpsert(feature: Feature<Geometry>): void {
  const item = toUpsertItem(feature);
  if (!item) return;
  pendingRemovals.delete(item.id);
  pendingUpserts.set(item.id, item);
  scheduleAutoFlush();
}

export function queueRustSpatialRemove(id: string | number | undefined | null): void {
  if (id === undefined || id === null) return;
  pendingUpserts.delete(id);
  pendingRemovals.add(id);
  scheduleAutoFlush();
}

let currentLoadPromise: Promise<void> = Promise.resolve();

export async function reloadRustSpatialIndex(features: Array<Feature<Geometry>>): Promise<void> {
  pendingUpserts.clear();
  pendingRemovals.clear();
  const items = features.map(toUpsertItem).filter((it): it is SpatialIndexItem => it !== null);

  const promise = spatialIndexLoadInWorker(items, DRAW_SOURCE_SPATIAL_SLOT)
    .then(() => undefined)
    .catch((err: unknown) => {
      console.error('rustSpatialIndex: carga completa falló', toErrorMessage(err));
    });
  currentLoadPromise = promise;
  await promise;
}

export async function queryRustSpatialIndex(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Promise<Array<string | number>> {
  await currentLoadPromise;
  await dispatchPending();

  try {
    const result = await spatialIndexQueryInWorker(minX, minY, maxX, maxY, DRAW_SOURCE_SPATIAL_SLOT);
    return result.ids as Array<string | number>;
  } catch (err: unknown) {
    console.error('rustSpatialIndex: query falló', toErrorMessage(err));
    return [];
  }
}