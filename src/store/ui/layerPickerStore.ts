import type { GeoUrbanFeatureKind } from '../../core/objectModel';
import { useLayersStore } from '../entities/layersRegistryStore';
import { autoCreateLayerForKind } from '../entities/layerAutoCreate';

export function requireLayerForKind(kind: GeoUrbanFeatureKind): Promise<string | null> {
  const registry = useLayersStore.getState();

  if (registry.activeLayerId) {
    const active = registry.getById(registry.activeLayerId);
    if (active && !active.locked) return Promise.resolve(active.id);
  }

  const existing = registry.getLayerForKind(kind);
  if (existing && !existing.locked) return Promise.resolve(existing.id);

  return Promise.resolve(autoCreateLayerForKind(kind));
}