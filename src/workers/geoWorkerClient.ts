import type { FeatureCollection, Polygon as GeoJsonPolygon } from 'geojson';
import type { GeoWorkerRequest, GeoWorkerResponse } from './geoOperations';
import type { SubdivisionOptions, SubdivisionResult, ManzanoLoteMethod } from '../geo/subdivision/subdivisionAlgorithms';
import type { LotResult } from '../geo/math/polygonEngine';
import type { Street } from '../store/entities/streetStore';
import type { RoundaboutParams } from '../geo/roundabout/roundaboutEngine';
import type { CornerMode } from '../geo/roads/ringFillet';
import type { RoadNetworkNet } from '../geo/roads/roadNetworkNet';
import type { Pt } from '../geo/math/polygonEngine';
import { invoke } from '@tauri-apps/api/core';
import { useNativeGeoEngineStore } from '../store/debug/nativeEngineStore';
import { recordGeometrySanitizeEvent } from '../store/debug/geometryTelemetry';
import { recordWorkerRoundtrip } from '../store/debug/perfTelemetry';

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

type WorkerTelemetryMessage = { __geoTelemetry: true; context: string; detail?: Record<string, unknown> };

function isWorkerTelemetryMessage(data: unknown): data is WorkerTelemetryMessage {
  return !!data && typeof data === 'object' && (data as { __geoTelemetry?: unknown }).__geoTelemetry === true;
}

function createWorker(onFatalError: () => void): Worker {
  const w = new Worker(new URL('./geoWorker.ts', import.meta.url), { type: 'module' });

  w.addEventListener('message', (event: MessageEvent<(GeoWorkerResponse & { requestId?: number }) | WorkerTelemetryMessage>) => {
    const data = event.data;

    if (isWorkerTelemetryMessage(data)) {
      recordGeometrySanitizeEvent(`worker:${data.context}`, data.detail ?? {});
      return;
    }

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
  'computeRoadNetworkNet',
]);

function pickWorker(type: GeoWorkerRequest['type']): Worker {
  return INTERACTIVE_TYPES.has(type) ? getInteractiveWorker() : getBatchWorker();
}

const DEFAULT_WORKER_TIMEOUT_MS = 15000;

function runWorker<T extends GeoWorkerResponse>(request: GeoWorkerRequest, timeoutMs?: number): Promise<T> {
  const w = pickWorker(request.type);
  const requestId = nextRequestId++;
  const startedAt = performance.now();

  return new Promise<T>((resolvePromise, rejectPromise) => {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const finish = (fn: () => void) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      fn();
    };

    pending.set(requestId, {
      type: request.type,
      worker: w,
      resolve: (data) => finish(() => {
        recordWorkerRoundtrip(request.type, performance.now() - startedAt);
        resolvePromise(data as T);
      }),
      reject: (reason) => finish(() => {
        recordWorkerRoundtrip(request.type, performance.now() - startedAt);
        rejectPromise(reason);
      }),
    });

    const effectiveTimeout = timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
    if (effectiveTimeout > 0) {
      timeoutHandle = setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);

        const bucket = INTERACTIVE_TYPES.has(request.type) ? 'interactive' : 'batch';
        console.error(
          `geoWorkerClient: la solicitud "${request.type}" (requestId=${requestId}) superó ${effectiveTimeout}ms — ` +
          `se reinicia el worker "${bucket}" para no bloquear futuras solicitudes. Esto normalmente indica ` +
          `geometría patológica (auto-intersecciones, red vial extremadamente densa, etc.).`,
        );

        rejectAllPendingFor(w, new Error(`geoWorkerClient: worker "${bucket}" reiniciado por timeout en "${request.type}"`));
        try { w.terminate(); } catch { /* noop */ }
        if (bucket === 'interactive' && interactiveWorker === w) interactiveWorker = null;
        if (bucket === 'batch' && batchWorker === w) batchWorker = null;

        recordWorkerRoundtrip(request.type, performance.now() - startedAt);
        rejectPromise(new Error(`geoWorkerClient: timeout (${effectiveTimeout}ms) esperando respuesta de "${request.type}"`));
      }, effectiveTimeout);
    }

    try {
      const correlated: GeoWorkerRequest & { requestId: number } = { ...request, requestId };
      w.postMessage(correlated);
    } catch (err) {
      pending.delete(requestId);
      finish(() => rejectPromise(err));
    }
  });
}

// ─── Motor nativo (Fase 2.5.a) ───────────────────────────────────────────

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function shouldUseNative(): boolean {
  return useNativeGeoEngineStore.getState().enabled && isTauriRuntime();
}

/** Mapea 1:1 los nombres de campo de `SubdivisionOptions` (TS) a los que
 * espera `SubdivisionOptions` (Rust, `#[serde(rename_all="camelCase")]`) —
 * ya coinciden en nombre, esto solo garantiza que cada clave viaje
 * explícita como `null` en vez de omitida (ver types.rs: los campos
 * opcionales no tienen `#[serde(default)]`, así que una clave ausente
 * puede fallar la deserialización; `undefined` en JS se omite al
 * serializar el payload de `invoke`). */
function toNativeSubdivisionOptions(options: SubdivisionOptions) {
  return {
    method: options.method,
    targetAreaM2: options.targetAreaM2 ?? null,
    frontMinM: options.frontMinM ?? null,
    dirAx: options.dirAx ?? null,
    dirAy: options.dirAy ?? null,
    frenteSeg: options.frenteSeg ?? null,
    auxSeg: options.auxSeg ?? null,
    cutLine: options.cutLine ?? null,
  };
}

function toNativeDirPref(dirPref?: { ax: number; ay: number }) {
  return dirPref ? { ax: dirPref.ax, ay: dirPref.ay } : null;
}

async function subdivideNative(
  polygon: GeoJsonPolygon,
  options: SubdivisionOptions,
): Promise<SubdivisionResult> {
  const t0 = performance.now();
  try {
    const result = await invoke<SubdivisionResult>('subdivide', {
      coordinates: polygon.coordinates as unknown as Array<Array<[number, number]>>,
      options: toNativeSubdivisionOptions(options),
    });
    recordWorkerRoundtrip('subdivide:native', performance.now() - t0);
    return result;
  } catch (err) {
    recordWorkerRoundtrip('subdivide:native', performance.now() - t0);
    throw err;
  }
}

async function subdivideManzanoNative(
  ring: [number, number][],
  method: ManzanoLoteMethod,
  targetAreaM2: number,
  frontMinM: number,
  dirPref?: { ax: number; ay: number },
): Promise<LotResult[]> {
  const t0 = performance.now();
  try {
    const lots = await invoke<LotResult[]>('subdivide_manzano', {
      ring,
      method,
      targetAreaM2,
      frontMinM,
      dirPref: toNativeDirPref(dirPref),
    });
    recordWorkerRoundtrip('subdivideManzano:native', performance.now() - t0);
    return lots;
  } catch (err) {
    recordWorkerRoundtrip('subdivideManzano:native', performance.now() - t0);
    throw err;
  }
}

async function subdivideManzanoBatchNative(
  manzanos: Array<{
    id: string | number;
    ring: [number, number][];
    method: ManzanoLoteMethod;
    targetAreaM2: number;
    frontMinM: number;
    dirPref?: { ax: number; ay: number };
  }>,
): Promise<Array<{ id: string | number; lots: LotResult[] }>> {
  const t0 = performance.now();
  try {
    const results = await invoke<Array<{ id: string | number; lots: LotResult[] }>>(
      'subdivide_manzano_batch',
      {
        manzanos: manzanos.map((m) => ({
          id: m.id,
          ring: m.ring,
          method: m.method,
          targetAreaM2: m.targetAreaM2,
          frontMinM: m.frontMinM,
          dirPref: toNativeDirPref(m.dirPref),
        })),
      },
    );
    recordWorkerRoundtrip('subdivideManzanoBatch:native', performance.now() - t0);
    return results;
  } catch (err) {
    recordWorkerRoundtrip('subdivideManzanoBatch:native', performance.now() - t0);
    throw err;
  }
}

// ─── API pública ────────────────────────────────────────────────────────

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
  if (shouldUseNative()) {
    try {
      return await subdivideNative(polygon, options);
    } catch (err) {
      console.error(
        'geoWorkerClient: "subdivide" en motor nativo falló — se reintenta en el worker JS. ' +
        'Desactivá "Motor nativo" en el panel de debug si esto se repite.',
        err,
      );
    }
  }
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
  if (shouldUseNative()) {
    try {
      return await subdivideManzanoNative(ring, method, targetAreaM2, frontMinM, dirPref);
    } catch (err) {
      console.error(
        'geoWorkerClient: "subdivide_manzano" en motor nativo falló — se reintenta en el worker JS. ' +
        'Desactivá "Motor nativo" en el panel de debug si esto se repite.',
        err,
      );
    }
  }
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
  if (shouldUseNative()) {
    try {
      return await subdivideManzanoBatchNative(manzanos);
    } catch (err) {
      console.error(
        'geoWorkerClient: "subdivide_manzano_batch" en motor nativo falló — se reintenta en el worker JS. ' +
        'Desactivá "Motor nativo" en el panel de debug si esto se repite.',
        err,
      );
    }
  }
  const response = await runWorker<{ type: 'subdivideManzanoBatch'; results: Array<{ id: string | number; lots: LotResult[] }> }>({
    type: 'subdivideManzanoBatch',
    manzanos,
  });
  return response.results;
}

export async function computeRoadNetworkNetInWorker(
  streets: Street[],
  roundabouts: RoundaboutParams[],
  cornerMode: CornerMode,
  timeoutMs = 6000,
): Promise<RoadNetworkNet> {
  const response = await runWorker<{ type: 'computeRoadNetworkNet'; net: RoadNetworkNet }>(
    { type: 'computeRoadNetworkNet', streets, roundabouts, cornerMode },
    timeoutMs,
  );
  return response.net;
}

export interface MatchFragmentsBatchItem {
  groupIdx: number;
  fragments: Pt[][];
  memberRings: Pt[][];
}
export interface MatchFragmentsBatchResultItem {
  groupIdx: number;
  assignments: Array<{ fragmentIdx: number; memberIdx: number | null; overlapArea: number }>;
}

export async function matchFragmentsBatchInWorker(
  items: MatchFragmentsBatchItem[],
  timeoutMs = 8000,
): Promise<MatchFragmentsBatchResultItem[]> {
  if (items.length === 0) return [];
  const response = await runWorker<{ type: 'matchFragmentsBatch'; results: MatchFragmentsBatchResultItem[] }>(
    { type: 'matchFragmentsBatch', items },
    timeoutMs,
  );
  return response.results;
}