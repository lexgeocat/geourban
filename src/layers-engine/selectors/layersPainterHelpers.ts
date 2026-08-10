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

/**
 * Resuelve la capa a usar para renderizar una entidad vial (calle o
 * rotonda). Si la entidad tiene `layerId` y existe en el registro, se usa
 * esa capa; si no, se cae al `fallbackKind` (típicamente `'calle'`).
 *
 * Usado por `StreetPainter` y `RoundaboutPainter` — antes cada uno tenía
 * su propia copia local (Fase 3.10 del plan de limpieza).
 */
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
  return resolveEntityLayer(rb, 'calle', registry, byId);
}
