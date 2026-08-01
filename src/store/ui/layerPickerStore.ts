import type { GeoUrbanFeatureKind } from '../../core/objectModel';
import { useLayersStore } from '../entities/layersRegistryStore';
import { autoCreateLayerForKind } from '../entities/layerAutoCreate';

export function requireLayerForKind(kind: GeoUrbanFeatureKind): Promise<string | null> {
  const registry = useLayersStore.getState();

  if (registry.activeLayerId) {
    const active = registry.getById(registry.activeLayerId);
    // FIX: antes no comprobaba active.kind === kind, así que asignaba
    // en silencio geometría de un tipo a una capa de otro tipo (p.ej.
    // una calle dibujada con la capa "Lote" activa).
    if (active && !active.locked && active.kind === kind) return Promise.resolve(active.id);
  }

  const existing = registry.getLayerForKind(kind);
  if (existing && !existing.locked) return Promise.resolve(existing.id);

  return Promise.resolve(autoCreateLayerForKind(kind));
}