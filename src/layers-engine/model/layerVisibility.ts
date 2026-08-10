import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';

export function isFeatureLayerVisible(feature: Feature<Geometry>): boolean {
  const layerId = feature.get('layerId') as string | undefined;
  if (!layerId) return true; // feature huérfana: no bloquear
  const layer = useLayersStore.getState().getById(layerId);
  return layer ? layer.visible : true;
}

export function isFeatureLayerLocked(feature: Feature<Geometry>): boolean {
  const layerId = feature.get('layerId') as string | undefined;
  if (!layerId) return false;
  const layer = useLayersStore.getState().getById(layerId);
  return !!layer?.locked;
}
