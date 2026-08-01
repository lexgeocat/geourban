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
import { recordNativeEngineOutcome } from '../store/debug/nativeEngineTelemetry';

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

// ─── Motor nativo (Fase 2.5) ───────────────────────────────────────────

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function shouldUseNative(): boolean {
  return useNativeGeoEngineStore.getState().enabled && isTauriRuntime();
}

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

// ─── Fase 2.7 — validación en sombra (shadow mode) ─────────────────────
//
// Cuando el motor nativo resuelve una operación con éxito, y el flag de
// validación en sombra está activo, con probabilidad `shadowSampleRate`
// se corre EN PARALELO (sin bloquear ni afectar la respuesta ya
// resuelta con el resultado nativo) el mismo cómputo en el motor JS de
// referencia, y se comparan resúmenes con tolerancia. Es el mecanismo
// concreto para "validar la paridad en la app real con datos de
// producción" sin retirar el motor JS todavía.

function shouldRunShadowValidation(): boolean {
  const { shadowValidationEnabled, shadowSampleRate } = useNativeGeoEngineStore.getState();
  if (!shadowValidationEnabled) return false;
  return Math.random() < shadowSampleRate;
}

function runShadowValidation<T>(
  opType: string,
  runJs: () => Promise<T>,
  compare: (js: T) => { ok: boolean; detail?: string },
): void {
  if (!shouldRunShadowValidation()) return;
  void runJs()
    .then((js) => {
      const cmp = compare(js);
      recordNativeEngineOutcome(opType, cmp.ok ? 'shadowMatch' : 'shadowMismatch', cmp.detail);
    })
    .catch((err) => {
      // El motor JS también puede fallar en geometría patológica — no es
      // en sí un mismatch (el nativo ya respondió bien), solo se deja
      // registrado para no perder la señal.
      recordNativeEngineOutcome(
        opType,
        'shadowMismatch',
        `motor JS de referencia falló: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
}

function areaWithinTolerance(a: number, b: number, relTol = 0.02, absTol = 1): boolean {
  return Math.abs(a - b) <= Math.max(absTol, Math.max(Math.abs(a), Math.abs(b)) * relTol);
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

async function computeManzanosNative(
  parcels: FeatureCollection,
  roadNetwork: FeatureCollection,
): Promise<FeatureCollection> {
  const t0 = performance.now();
  try {
    const parcelRings = parcels.features.map((f) => {
      const geom = f.geometry as GeoJsonPolygon;
      return geom.coordinates as unknown as Pt[][];
    });
    const roadRings = roadNetwork.features.map((f) => {
      const geom = f.geometry as GeoJsonPolygon;
      return geom.coordinates[0] as unknown as Pt[];
    });
    const fragments = await invoke<Array<{ origParcelIndex: number; rings: Pt[][] }>>(
      'compute_manzanos_cmd',
      { parcels: parcelRings, roadNetwork: roadRings },
    );
    const result: FeatureCollection = {
      type: 'FeatureCollection',
      features: fragments.map((frag) => ({
        type: 'Feature',
        properties: { origParcelIndex: frag.origParcelIndex },
        geometry: { type: 'Polygon', coordinates: frag.rings } as GeoJsonPolygon,
      })) as never[],
    };
    recordWorkerRoundtrip('computeManzanos:native', performance.now() - t0);
    return result;
  } catch (err) {
    recordWorkerRoundtrip('computeManzanos:native', performance.now() - t0);
    throw err;
  }
}

async function computeRoadNetworkNetNative(
  streets: Street[],
  roundabouts: RoundaboutParams[],
  cornerMode: CornerMode,
): Promise<RoadNetworkNet> {
  const t0 = performance.now();
  try {
    const net = await invoke<RoadNetworkNet>('compute_road_network_net_cmd', {
      streets,
      roundabouts,
      cornerMode,
    });
    recordWorkerRoundtrip('computeRoadNetworkNet:native', performance.now() - t0);
    return net;
  } catch (err) {
    recordWorkerRoundtrip('computeRoadNetworkNet:native', performance.now() - t0);
    throw err;
  }
}

async function matchFragmentsBatchNative(
  items: MatchFragmentsBatchItem[],
): Promise<MatchFragmentsBatchResultItem[]> {
  const t0 = performance.now();
  try {
    const results = await invoke<MatchFragmentsBatchResultItem[]>('match_fragments_batch', {
      items: items.map((it) => ({
        groupIdx: it.groupIdx,
        fragments: it.fragments,
        memberRings: it.memberRings,
      })),
    });
    recordWorkerRoundtrip('matchFragmentsBatch:native', performance.now() - t0);
    return results;
  } catch (err) {
    recordWorkerRoundtrip('matchFragmentsBatch:native', performance.now() - t0);
    throw err;
  }
}

// ─── API pública ────────────────────────────────────────────────────────

export async function computeManzanosInWorker(
  parcels: FeatureCollection,
  roadNetwork: FeatureCollection,
) {
  if (shouldUseNative()) {
    try {
      const nativeResult = await computeManzanosNative(parcels, roadNetwork);
      recordNativeEngineOutcome('computeManzanos', 'native');
      runShadowValidation(
        'computeManzanos',
        async () => {
          const response = await runWorker<{ type: 'computeManzanos'; manzanos: FeatureCollection }>({
            type: 'computeManzanos', parcels, roadNetwork,
          });
          return response.manzanos;
        },
        (js) => {
          const areaOf = (fc: FeatureCollection) => fc.features.reduce((s, f) => {
            if (f.geometry?.type !== 'Polygon') return s;
            const ring = f.geometry.coordinates[0] as [number, number][];
            let a = 0;
            for (let i = 0; i < ring.length; i++) {
              const p = ring[i], q = ring[(i + 1) % ring.length];
              a += p[0] * q[1] - q[0] * p[1];
            }
            return s + Math.abs(a) / 2;
          }, 0);
          const nativeArea = areaOf(nativeResult);
          const jsArea = areaOf(js);
          if (nativeResult.features.length !== js.features.length) {
            return { ok: false, detail: `cantidad de fragmentos difiere: nativo=${nativeResult.features.length} js=${js.features.length}` };
          }
          if (!areaWithinTolerance(nativeArea, jsArea, 0.03, 2)) {
            return { ok: false, detail: `área total difiere: nativo=${nativeArea.toFixed(2)} js=${jsArea.toFixed(2)}` };
          }
          return { ok: true };
        },
      );
      return nativeResult;
    } catch (err) {
      recordNativeEngineOutcome('computeManzanos', 'fallback');
      console.error(
        'geoWorkerClient: "computeManzanos" en motor nativo falló — se reintenta en el worker JS. ' +
        'Desactivá "Motor nativo" en el panel de debug si esto se repite.',
        err,
      );
    }
  }
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
      const nativeResult = await subdivideNative(polygon, options);
      recordNativeEngineOutcome('subdivide', 'native');
      runShadowValidation(
        'subdivide',
        async () => {
          const response = await runWorker<{ type: 'subdivide'; result: SubdivisionResult }>({
            type: 'subdivide', polygon, options,
          });
          return response.result;
        },
        (js) => {
          if (nativeResult.ok !== js.ok) {
            return { ok: false, detail: `ok difiere: nativo=${nativeResult.ok} js=${js.ok}` };
          }
          if (!nativeResult.ok) return { ok: true };
          if (nativeResult.features.length !== js.features.length) {
            return { ok: false, detail: `cantidad de features difiere: nativo=${nativeResult.features.length} js=${js.features.length}` };
          }
          const areaOf = (r: SubdivisionResult) =>
            r.features.reduce((s, f) => s + ((f.properties as { areaM2?: number } | null)?.areaM2 ?? 0), 0);
          const nativeArea = areaOf(nativeResult);
          const jsArea = areaOf(js);
          if (!areaWithinTolerance(nativeArea, jsArea)) {
            return { ok: false, detail: `área total difiere: nativo=${nativeArea.toFixed(2)} js=${jsArea.toFixed(2)}` };
          }
          return { ok: true };
        },
      );
      return nativeResult;
    } catch (err) {
      recordNativeEngineOutcome('subdivide', 'fallback');
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
      const nativeLots = await subdivideManzanoNative(ring, method, targetAreaM2, frontMinM, dirPref);
      recordNativeEngineOutcome('subdivideManzano', 'native');
      runShadowValidation(
        'subdivideManzano',
        async () => {
          const response = await runWorker<{ type: 'subdivideManzano'; lots: LotResult[] }>({
            type: 'subdivideManzano', ring, method, targetAreaM2, frontMinM, dirPref,
          });
          return response.lots;
        },
        (jsLots) => {
          if (nativeLots.length !== jsLots.length) {
            return { ok: false, detail: `cantidad de lotes difiere: nativo=${nativeLots.length} js=${jsLots.length}` };
          }
          const nativeArea = nativeLots.reduce((s, l) => s + l.areaM2, 0);
          const jsArea = jsLots.reduce((s, l) => s + l.areaM2, 0);
          if (!areaWithinTolerance(nativeArea, jsArea)) {
            return { ok: false, detail: `área total difiere: nativo=${nativeArea.toFixed(2)} js=${jsArea.toFixed(2)}` };
          }
          return { ok: true };
        },
      );
      return nativeLots;
    } catch (err) {
      recordNativeEngineOutcome('subdivideManzano', 'fallback');
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
      const results = await subdivideManzanoBatchNative(manzanos);
      recordNativeEngineOutcome('subdivideManzanoBatch', 'native');
      return results;
    } catch (err) {
      recordNativeEngineOutcome('subdivideManzanoBatch', 'fallback');
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
  if (shouldUseNative()) {
    try {
      const nativeNet = await computeRoadNetworkNetNative(streets, roundabouts, cornerMode);
      recordNativeEngineOutcome('computeRoadNetworkNet', 'native');
      runShadowValidation(
        'computeRoadNetworkNet',
        async () => {
          const response = await runWorker<{ type: 'computeRoadNetworkNet'; net: RoadNetworkNet }>(
            { type: 'computeRoadNetworkNet', streets, roundabouts, cornerMode },
            timeoutMs,
          );
          return response.net;
        },
        (js) => {
          const ringCount = (n: RoadNetworkNet) => n.road.length + n.outer.length;
          if (ringCount(nativeNet) !== ringCount(js)) {
            return { ok: false, detail: `cantidad de polígonos difiere: nativo=${ringCount(nativeNet)} js=${ringCount(js)}` };
          }
          return { ok: true };
        },
      );
      return nativeNet;
    } catch (err) {
      recordNativeEngineOutcome('computeRoadNetworkNet', 'fallback');
      console.error(
        'geoWorkerClient: "computeRoadNetworkNet" en motor nativo falló — se reintenta en el worker JS. ' +
        'Desactivá "Motor nativo" en el panel de debug si esto se repite.',
        err,
      );
    }
  }
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
  if (shouldUseNative()) {
    try {
      const results = await matchFragmentsBatchNative(items);
      recordNativeEngineOutcome('matchFragmentsBatch', 'native');
      return results;
    } catch (err) {
      recordNativeEngineOutcome('matchFragmentsBatch', 'fallback');
      console.error(
        'geoWorkerClient: "matchFragmentsBatch" en motor nativo falló — se reintenta en el worker JS. ' +
        'Desactivá "Motor nativo" en el panel de debug si esto se repite.',
        err,
      );
    }
  }
  const response = await runWorker<{ type: 'matchFragmentsBatch'; results: MatchFragmentsBatchResultItem[] }>(
    { type: 'matchFragmentsBatch', items },
    timeoutMs,
  );
  return response.results;
}