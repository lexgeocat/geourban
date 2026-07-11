import type { FeatureCollection } from 'geojson';
import type { GeoWorkerRequest, GeoWorkerResponse } from './geoOperations';

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

export async function unionPolygonsInWorker(features: FeatureCollection) {
  const response = await runWorker<{ type: 'union'; result: FeatureCollection }>({
    type: 'union',
    features,
  });
  return response.result;
}

export async function mergePolygonsInWorker(features: FeatureCollection) {
  const response = await runWorker<{ type: 'merge'; result: FeatureCollection }>({
    type: 'merge',
    features,
  });
  return response.result;
}

export async function subtractPolygonsInWorker(
  minuend: FeatureCollection,
  subtrahend: FeatureCollection
) {
  const response = await runWorker<{ type: 'subtract'; result: FeatureCollection }>({
    type: 'subtract',
    minuend,
    subtrahend,
  });
  return response.result;
}

export async function intersectPolygonsInWorker(features: FeatureCollection) {
  const response = await runWorker<{ type: 'intersect'; result: FeatureCollection }>({
    type: 'intersect',
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

export function terminateGeoWorker() {
  worker?.terminate();
  worker = null;
}
