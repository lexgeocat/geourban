import type { Layer } from '@kernel/domain-model/featureModel';
import type { LayerKind } from '@kernel/domain-model/featureModel';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import type { Roundabout } from '@vias-engine/store/roundaboutStore';
import { createByIdCache } from '@kernel/utils/byIdCache';

export type LayersRegistryState = ReturnType<typeof useLayersStore.getState>;

const getLayerById = createByIdCache<Layer>();

export function getLayerByIdCached(layers: Layer[]): Map<string, Layer> {
  return getLayerById(layers);
}

export function resolveEntityLayer(
  entity: { layerId?: string },
  fallbackKind: LayerKind,
  registry: LayersRegistryState,
  byId: Map<string, Layer>
): Layer | undefined {
  if (entity.layerId) {
    const layer = byId.get(entity.layerId);
    if (layer) return layer;
  }
  return registry.getLayerForKind(fallbackKind);
}

export function resolveRoundaboutLayer(
  rb: Roundabout,
  registry: LayersRegistryState,
  byId: Map<string, Layer>
): Layer | undefined {
  return resolveEntityLayer(rb, 'via', registry, byId);
}
