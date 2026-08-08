// Helpers compartidos por los painters (street/roundabout) para resolver
// la "Layer" asociada a una entidad vial. Cachean `Map<id, Layer>` mientras
// la referencia del array `layers` no cambie.
import type { Layer } from '../../../core/objectModel';
import type { useLayersStore } from '../../../store/entities/layersRegistryStore';
import type { Roundabout } from '../../../store/entities/roundaboutStore';

export type LayersRegistryState = ReturnType<typeof useLayersStore.getState>;

let layersByIdCache: { layers: Layer[]; byId: Map<string, Layer> } | null = null;

/**
 * Devuelve un `Map<id, Layer>` cacheado. Invalida cuando cambia la referencia
 * del array `layers` (que es lo que muta Zustand cuando cambia el registry).
 */
export function getLayerByIdCached(layers: Layer[]): Map<string, Layer> {
  if (layersByIdCache && layersByIdCache.layers === layers) return layersByIdCache.byId;
  const byId = new Map(layers.map((l) => [l.id, l] as const));
  layersByIdCache = { layers, byId };
  return byId;
}

/** Invalida el cache manualmente (p.ej. tras un reset de capas). */
export function invalidateLayerByIdCache(): void {
  layersByIdCache = null;
}

/**
 * Resuelve la capa destino de una rotonda: usa `rb.layerId` si existe y está
 * registrada; si no, cae a la capa default del kind 'calle'.
 */
export function resolveRoundaboutLayer(
  rb: Roundabout,
  registry: LayersRegistryState,
  byId: Map<string, Layer>,
): Layer | undefined {
  if (rb.layerId) {
    const layer = byId.get(rb.layerId);
    if (layer) return layer;
  }
  return registry.getLayerForKind('calle');
}
