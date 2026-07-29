import {
  handleGeoWorkerRequest,
  type GeoWorkerRequest,
  type GeoWorkerResponse,
} from './geoOperations';

type IncomingMessage = GeoWorkerRequest & { requestId: number };

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const { requestId, ...rest } = event.data;
  const request = rest as GeoWorkerRequest;

  let response: GeoWorkerResponse;
  try {
    response = handleGeoWorkerRequest(request);
  } catch (err) {

    response = {
      type: request.type,
      error: err instanceof Error ? err.message : String(err),
    } as GeoWorkerResponse;
  }

  self.postMessage({ ...response, requestId });
};

export {};