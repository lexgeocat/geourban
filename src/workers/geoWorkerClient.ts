import type { FeatureCollection, Polygon as GeoJsonPolygon } from 'geojson';
import type { GeoWorkerRequest, GeoWorkerResponse } from './geoOperations';
import type { SubdivisionOptions, SubdivisionResult, ManzanoLoteMethod } from '../geo/subdivision/subdivisionAlgorithms';
import type { LotResult } from '../geo/math/polygonEngine';

interface PendingEntry {
  type: GeoWorkerRequest['type'];
  worker: Worker;
  resolve: (data: GeoWorkerResponse) => void;
  reject: (reason: unknown) => void;
}

let nextRequestId = 1;
const pending = new Map<number, PendingEntry>();

let interactiveWorker: Worker | null = null;
let batchWorker: Worker | null = null;

function rejectAllPendingFor(w: Worker, reason: unknown): void {
  for (const [id, entry] of pending) {
    if (entry.worker !== w) continue;
    pending.delete(id);
    entry.reject(reason);
  }
}

function createWorker(onFatalError: () => void): Worker {
  const w = new Worker(new URL('./geoWorker.ts', import.meta.url), { type: 'module' });

  w.addEventListener('message', (event: MessageEvent<GeoWorkerResponse & { requestId?: number }>) => {
    const data = event.data;
    const requestId = data?.requestId;

    if (requestId == null) {
      console.warn('geoWorkerClient: mensaje del worker sin requestId — se ignora.', data);
      return;
    }

    const entry = pending.get(requestId);
    if (!entry) return; // respuesta huérfana (ya resuelta/rechazada antes) — se descarta a propósito

    pending.delete(requestId);

    if (data.error) {
      entry.reject(new Error(data.error));
      return;
    }
    if (data.type !== entry.type) {
      entry.reject(
        new Error(
          `geoWorkerClient: se esperaba respuesta de tipo "${entry.type}" pero llegó "${data.type}" (requestId=${requestId}).`,
        ),
      );
      return;
    }
    entry.resolve(data);
  });

  w.addEventListener('messageerror', (event) => {
    console.error('geoWorkerClient: mensaje no deserializable recibido del worker (structured clone falló)', event);
  });

  w.addEventListener('error', (err: ErrorEvent) => {
    console.error('geoWorkerClient: error no controlado en geoWorker — se rechazan todos los requests en vuelo de este worker', err);
    rejectAllPendingFor(w, err.error ?? new Error(err.message || 'Error desconocido en geoWorker'));
    onFatalError();
  });

  return w;
}

function getInteractiveWorker(): Worker {
  if (!interactiveWorker) {
    interactiveWorker = createWorker(() => {
      interactiveWorker?.terminate();
      interactiveWorker = null;
    });
  }
  return interactiveWorker;
}

function getBatchWorker(): Worker {
  if (!batchWorker) {
    batchWorker = createWorker(() => {
      batchWorker?.terminate();
      batchWorker = null;
    });
  }
  return batchWorker;
}

const INTERACTIVE_TYPES = new Set<GeoWorkerRequest['type']>([
  'subdivide',
  'subdivideManzano',
  'computeManzanos',
]);

function pickWorker(type: GeoWorkerRequest['type']): Worker {
  return INTERACTIVE_TYPES.has(type) ? getInteractiveWorker() : getBatchWorker();
}

function runWorker<T extends GeoWorkerResponse>(request: GeoWorkerRequest): Promise<T> {
  const w = pickWorker(request.type);
  const requestId = nextRequestId++;

  return new Promise<T>((resolvePromise, rejectPromise) => {
    pending.set(requestId, {
      type: request.type,
      worker: w,
      resolve: (data) => resolvePromise(data as T),
      reject: rejectPromise,
    });
    try {
      const correlated: GeoWorkerRequest & { requestId: number } = { ...request, requestId };
      w.postMessage(correlated);
    } catch (err) {
      pending.delete(requestId);
      rejectPromise(err);
    }
  });
}

export interface FindOverlapsPayload {
  overlaps: Array<{ indexA: number; indexB: number; area: number }>;
}
export interface FindGapsPayload {
  gaps: FeatureCollection;
}

export function isFindOverlapsPayload(value: unknown): value is FindOverlapsPayload {
  return !!value && typeof value === 'object' && Array.isArray((value as { overlaps?: unknown }).overlaps);
}

export function isFindGapsPayload(value: unknown): value is FindGapsPayload {
  const gaps = (value as { gaps?: { type?: unknown; features?: unknown } } | undefined)?.gaps;
  return !!gaps && gaps.type === 'FeatureCollection' && Array.isArray(gaps.features);
}

// ─── API pública ────────────────────────────────────────────────────────

export async function mergePolygonsInWorker(features: FeatureCollection) {
  const response = await runWorker<{ type: 'merge'; result: FeatureCollection }>({
    type: 'merge',
    features,
  });
  return response.result;
}

export async function validateTopologyInWorker(features: FeatureCollection) {
  const response = await runWorker<{ type: 'validate'; valid: boolean; issues: string[] }>({
    type: 'validate',
    features,
  });
  return { valid: response.valid, issues: response.issues };
}

export async function findOverlapsInWorker(features: FeatureCollection) {
  const response = await runWorker<{ type: 'findOverlaps'; overlaps: Array<{ indexA: number; indexB: number; area: number }> }>({
    type: 'findOverlaps',
    features,
  });
  if (!isFindOverlapsPayload(response)) {
    throw new Error('geoWorkerClient: respuesta de findOverlaps con forma inesperada (falta "overlaps").');
  }
  return response.overlaps;
}

export async function findGapsInWorker(features: FeatureCollection) {
  const response = await runWorker<{ type: 'findGaps'; gaps: FeatureCollection }>({
    type: 'findGaps',
    features,
  });
  if (!isFindGapsPayload(response)) {
    throw new Error('geoWorkerClient: respuesta de findGaps con forma inesperada (falta "gaps.features").');
  }
  return response.gaps;
}

export async function computeManzanosInWorker(
  parcels: FeatureCollection,
  roadNetwork: FeatureCollection,
) {
  const response = await runWorker<{ type: 'computeManzanos'; manzanos: FeatureCollection }>({
    type: 'computeManzanos',
    parcels,
    roadNetwork,
  });
  return response.manzanos;
}

export async function subdivideInWorker(
  polygon: GeoJsonPolygon,
  options: SubdivisionOptions,
): Promise<SubdivisionResult> {
  const response = await runWorker<{ type: 'subdivide'; result: SubdivisionResult }>({
    type: 'subdivide',
    polygon,
    options,
  });
  return response.result;
}

export async function subdivideManzanoInWorker(
  ring: [number, number][],
  method: ManzanoLoteMethod,
  targetAreaM2: number,
  frontMinM: number,
  dirPref?: { ax: number; ay: number },
): Promise<LotResult[]> {
  const response = await runWorker<{ type: 'subdivideManzano'; lots: LotResult[] }>({
    type: 'subdivideManzano',
    ring,
    method,
    targetAreaM2,
    frontMinM,
    dirPref,
  });
  return response.lots;
}

export async function subdivideManzanoBatchInWorker(
  manzanos: Array<{
    id: string | number;
    ring: [number, number][];
    method: ManzanoLoteMethod;
    targetAreaM2: number;
    frontMinM: number;
    dirPref?: { ax: number; ay: number };
  }>,
): Promise<Array<{ id: string | number; lots: LotResult[] }>> {
  const response = await runWorker<{ type: 'subdivideManzanoBatch'; results: Array<{ id: string | number; lots: LotResult[] }> }>({
    type: 'subdivideManzanoBatch',
    manzanos,
  });
  return response.results;
}

/** Solo para tests/depuración. */
export function _resetGeoWorkersForTests(): void {
  interactiveWorker?.terminate();
  batchWorker?.terminate();
  interactiveWorker = null;
  batchWorker = null;
  for (const [, entry] of pending) entry.reject(new Error('geoWorkerClient: reseteado para tests'));
  pending.clear();
}

export function _debugPendingRequestCount(): number {
  return pending.size;
}