export * from './store/streetStore';
export * from './store/roundaboutStore';
export * from './store/roadCornerStore';
export * from './store/streetTracingSessionStore';

export * from './geometry/types';
export * from './geometry/ringFillet';
export * from './geometry/roadNetworkEngine';
export * from './geometry/streetEngine';
export * from './geometry/roundaboutEngine';

export * from './commands/AddStreetCommand';
export * from './commands/AddRoundaboutCommand';
export * from './commands/RoadEntityCommand';

export * from './modes/StreetMode';
export * from './modes/RoundaboutMode';

export * from './interactions/RoundaboutDrawInteraction';

export * from './painters/StreetPainter';
export * from './painters/RoundaboutPainter';

export * from './native/roadSnapSource';

export { default as StreetPanel } from './ui/StreetPanel';
export { default as RoundaboutPanel } from './ui/RoundaboutPanel';

import { extraSnapSources } from '@snap-engine/extension-points';
import { eraseInterceptors, type EraseInterceptor } from '@drawing-engine/extension-points';
import { entityGeometryProviders } from '@selection-engine/entityGeometryProviders';
import { getOrCreateRoadSnapSource } from './native/roadSnapSource';
import { useStreetStore } from './store/streetStore';
import { useRoundaboutStore } from './store/roundaboutStore';
import { roundaboutGeometry } from './geometry/roundaboutEngine';

extraSnapSources.register('vias:roadSnapSource', () => getOrCreateRoadSnapSource().getFeatures());

const eraseStreetInterceptor: EraseInterceptor = (kind, id) => {
  if (kind !== 'calle') return false;
  const street = useStreetStore.getState().streets.find((s) => s.id === id);
  if (!street) return false;
  useStreetStore.getState().removeStreet(id);
  return true;
};

const eraseRoundaboutInterceptor: EraseInterceptor = (kind, id) => {
  if (kind !== 'rotonda') return false;
  const rb = useRoundaboutStore.getState().roundabouts.find((r) => r.id === id);
  if (!rb) return false;
  useRoundaboutStore.getState().removeRoundabout(id);
  return true;
};

eraseInterceptors.register('vias:street', () => eraseStreetInterceptor);
eraseInterceptors.register('vias:roundabout', () => eraseRoundaboutInterceptor);
entityGeometryProviders.register('street', (id, _resolution) => {
  const s = useStreetStore.getState().streets.find((x) => x.id === id);
  if (!s) return null;
  const coords: number[][] = [[s.start[0], s.start[1]]];
  if (s.waypoints) coords.push(...s.waypoints.map((w) => [w[0], w[1]]));
  coords.push([s.end[0], s.end[1]]);
  return coords;
});

entityGeometryProviders.register('roundabout', (id, resolution) => {
  const rb = useRoundaboutStore.getState().roundabouts.find((r) => r.id === id);
  if (!rb) return null;
  const geom = roundaboutGeometry(rb, resolution);
  return geom.sideOuter as number[][];
});
