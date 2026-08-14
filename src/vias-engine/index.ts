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
import { layerEntityAdapters, type LayerEntityAdapter, type LayerEntitySnapshot } from '@layers-engine/extension-points';
import { useEntityLabelStore, type EntityLabelEntry } from '@label-engine/store/entityLabelStore';
import { getOrCreateRoadSnapSource } from './native/roadSnapSource';
import { useStreetStore, type Street } from './store/streetStore';
import { useRoundaboutStore, type Roundabout } from './store/roundaboutStore';
import { roundaboutGeometry } from './geometry/roundaboutEngine';

extraSnapSources.register('vias:roadSnapSource', () => getOrCreateRoadSnapSource().getFeatures());

const eraseStreetInterceptor: EraseInterceptor = (kind, id) => {
  if (kind !== 'calle') return false;
  const street = useStreetStore.getState().streets.find((s) => s.id === id);
  if (!street) return false;
  useStreetStore.getState().removeStreet(id);
  useEntityLabelStore.getState().remove(id);
  return true;
};

const eraseRoundaboutInterceptor: EraseInterceptor = (kind, id) => {
  if (kind !== 'rotonda') return false;
  const rb = useRoundaboutStore.getState().roundabouts.find((r) => r.id === id);
  if (!rb) return false;
  useRoundaboutStore.getState().removeRoundabout(id);
  useEntityLabelStore.getState().remove(id);
  return true;
};

const streetAdapter: LayerEntityAdapter = {
  kind: 'street',
  list: (layerId: string) => {
    const state = useStreetStore.getState();
    return state.streets
      .filter((s) => s.layerId === layerId)
      .map((s) => ({ id: s.id, data: { ...s }, layerId: s.layerId }));
  },
  count: (layerId: string) =>
    useStreetStore.getState().streets.filter((s) => s.layerId === layerId).length,
  reassign: (fromLayerId: string, toLayerId: string) => {
    const state = useStreetStore.getState();
    let n = 0;
    for (const s of state.streets) {
      if (s.layerId === fromLayerId) {
        state.updateStreet(s.id, { layerId: toLayerId });
        n++;
      }
    }
    return n;
  },
  remove: (layerId: string) => {
    const state = useStreetStore.getState();
    const removed: LayerEntitySnapshot[] = [];
    for (const s of [...state.streets]) {
      if (s.layerId !== layerId) continue;
      removed.push({
        id: s.id,
        data: { ...s },
        layerId: s.layerId,
        label: useEntityLabelStore.getState().byId[s.id],
      });
      state.removeStreet(s.id);
      useEntityLabelStore.getState().remove(s.id);
    }
    return removed;
  },
  removeById: (entityId: string) => {
    const state = useStreetStore.getState();
    if (state.streets.some((s) => s.id === entityId)) {
      state.removeStreet(entityId);
      useEntityLabelStore.getState().remove(entityId);
    }
  },
  restore: (snapshots: LayerEntitySnapshot[]) => {
    const state = useStreetStore.getState();
    const labelStore = useEntityLabelStore.getState();
    for (const snap of snapshots) {
      if (state.streets.some((s) => s.id === snap.id)) continue;
      const { id: _id, name: _name, ...rest } = snap.data as Street;
      state.addStreetWithId(snap.id, rest);
      if (snap.label) labelStore.set(snap.id, snap.label as EntityLabelEntry);
    }
  },
};

const roundaboutAdapter: LayerEntityAdapter = {
  kind: 'roundabout',
  list: (layerId: string) => {
    const state = useRoundaboutStore.getState();
    return state.roundabouts
      .filter((r) => r.layerId === layerId)
      .map((r) => ({ id: r.id, data: { ...r }, layerId: r.layerId }));
  },
  count: (layerId: string) =>
    useRoundaboutStore.getState().roundabouts.filter((r) => r.layerId === layerId).length,
  reassign: (fromLayerId: string, toLayerId: string) => {
    const state = useRoundaboutStore.getState();
    let n = 0;
    for (const r of state.roundabouts) {
      if (r.layerId === fromLayerId) {
        state.updateRoundabout(r.id, { layerId: toLayerId });
        n++;
      }
    }
    return n;
  },
  remove: (layerId: string) => {
    const state = useRoundaboutStore.getState();
    const removed: LayerEntitySnapshot[] = [];
    for (const r of [...state.roundabouts]) {
      if (r.layerId !== layerId) continue;
      removed.push({
        id: r.id,
        data: { ...r },
        layerId: r.layerId,
        label: useEntityLabelStore.getState().byId[r.id],
      });
      state.removeRoundabout(r.id);
      useEntityLabelStore.getState().remove(r.id);
    }
    return removed;
  },
  removeById: (entityId: string) => {
    const state = useRoundaboutStore.getState();
    if (state.roundabouts.some((r) => r.id === entityId)) {
      state.removeRoundabout(entityId);
      useEntityLabelStore.getState().remove(entityId);
    }
  },
  restore: (snapshots: LayerEntitySnapshot[]) => {
    const state = useRoundaboutStore.getState();
    const labelStore = useEntityLabelStore.getState();
    for (const snap of snapshots) {
      if (state.roundabouts.some((r) => r.id === snap.id)) continue;
      const { id: _id, name: _name, ...rest } = snap.data as Roundabout;
      state.addRoundaboutWithId(snap.id, rest);
      if (snap.label) labelStore.set(snap.id, snap.label as EntityLabelEntry);
    }
  },
};

layerEntityAdapters.register('vias:street', streetAdapter);
layerEntityAdapters.register('vias:roundabout', roundaboutAdapter);

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
