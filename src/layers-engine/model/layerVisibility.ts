import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { useEditSessionStore } from '@layers-engine/store/editSessionStore';

export function isFeatureLayerVisible(feature: Feature<Geometry>): boolean {
  const layerId = feature.get('layerId') as string | undefined;
  if (!layerId) return true;
  const layer = useLayersStore.getState().getById(layerId);
  return layer ? layer.visible : true;
}

export function isFeatureLayerLocked(feature: Feature<Geometry>): boolean {
  const layerId = feature.get('layerId') as string | undefined;
  if (!layerId) return false;
  const layer = useLayersStore.getState().getById(layerId);
  return !!layer?.locked;
}

export function isLayerEditing(layerId: string | undefined | null): boolean {
  if (!layerId) return false;
  return useEditSessionStore.getState().isEditing(layerId);
}

export function isFeatureLayerEditable(feature: Feature<Geometry>): boolean {
  if (isFeatureLayerLocked(feature)) return false;
  const layerId = feature.get('layerId') as string | undefined;
  if (!layerId) return true;
  return isLayerEditing(layerId);
}
