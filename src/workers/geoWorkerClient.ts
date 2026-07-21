import type { FeatureCollection, Polygon as GeoJsonPolygon } from 'geojson';
import type { GeoWorkerRequest, GeoWorkerResponse } from './geoOperations';
import type { SubdivisionOptions, SubdivisionResult, ManzanoLoteMethod } from '../geo/subdivisionAlgorithms';
import type { LotResult } from '../geo/polygonEngine';

let worker: Worker | null = null;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./geoWorker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

function runWorker<T extends GeoWorkerResponse>(request: GeoWorkerRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = getWorker();

    const onMessage = (event: MessageEvent<T>) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data);
    };

    const onError = (err: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      reject(err.error ?? new Error(err.message));
    };

    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage(request);
  });
}

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
  return response.overlaps;
}

export async function findGapsInWorker(features: FeatureCollection) {
  const response = await runWorker<{ type: 'findGaps'; gaps: FeatureCollection }>({
    type: 'findGaps',
    features,
  });
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

/**
 * Subdivide un polígono (todas las variantes) en el worker — ver
 * diagnóstico H8. Si el worker rechaza (excepción real, no un `ok:false`
 * esperado de "no se pudo generar el preview"), la promesa se rechaza;
 * el llamador ya maneja ambos casos (ver SubdivisionDialog/SubdivideCommand).
 */
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

/** Subdivide un solo manzano ya conocido (RecomputeManzanoLotsCommand). */
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

/** Subdivide TODOS los manzanos de una tanda en un solo viaje al worker
 *  (GenerateLotsCommand — "Generar lotes" sobre todo el proyecto). */
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