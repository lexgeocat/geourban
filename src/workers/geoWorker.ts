import { handleGeoWorkerRequest, type GeoWorkerRequest, type GeoWorkerResponse } from './geoOperations';

self.onmessage = (event: MessageEvent<GeoWorkerRequest>) => {
  const response: GeoWorkerResponse = handleGeoWorkerRequest(event.data);
  self.postMessage(response);
};

export {};
