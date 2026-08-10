import type { Layer } from '@kernel/domain-model/featureModel';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import type { Roundabout } from '@vias-engine/store/roundaboutStore';

export type LayersRegistryState = ReturnType<typeof useLayersStore.getState>;

let layersByIdCache: { layers: Layer[]; byId: Map<string, Layer> } | null = null;

export function getLayerByIdCached(layers: Layer[]): Map<string, Layer> {
  if (layersByIdCache && layersByIdCache.layers === layers) return layersByIdCache.byId;
  const byId = new Map(layers.map((l) => [l.id, l] as const));
  layersByIdCache = { layers, byId };
  return byId;
}

export function invalidateLayerByIdCache(): void {
  layersByIdCache = null;
}

export function resolveRoundaboutLayer(
  rb: Roundabout,
  registry: LayersRegistryState,
  byId: Map<string, Layer>
): Layer | undefined {
  if (rb.layerId) {
    const layer = byId.get(rb.layerId);
    if (layer) return layer;
  }
  return registry.getLayerForKind('calle');
}
