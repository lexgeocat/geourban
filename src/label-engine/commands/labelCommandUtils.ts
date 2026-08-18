import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { LabelStyleConfig } from '../model/labelModel';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';

export interface LabelFieldsSnapshot {
  config?: LabelStyleConfig;
  text?: string;
  orderIndex?: number;
}

export function restoreLabelFields(feature: Feature<Geometry>, prev: LabelFieldsSnapshot): void {
  if (prev.config) feature.set('labelConfig', prev.config, true);
  else feature.unset('labelConfig', true);
  if (prev.text !== undefined) feature.set('labelText', prev.text, true);
  else feature.unset('labelText', true);
  if (prev.orderIndex !== undefined) feature.set('labelOrderIndex', prev.orderIndex, true);
  else feature.unset('labelOrderIndex', true);
}

export interface LayerVisibilitySnapshot {
  showLabel?: boolean;
  showCota?: boolean;
}

export function ensureLayerLabelsVisible(layerId: string | undefined): LayerVisibilitySnapshot {
  const snap: LayerVisibilitySnapshot = {};
  if (!layerId) return snap;
  const store = useLayersStore.getState();
  const layer = store.getById(layerId);
  if (!layer) return snap;
  if (layer.showLabel === false) {
    snap.showLabel = false;
    store.update({ id: layerId, showLabel: true });
  }
  if (layer.showCota === false) {
    snap.showCota = false;
    store.update({ id: layerId, showCota: true });
  }
  return snap;
}

export function restoreLayerVisibility(
  layerId: string | undefined,
  snap: LayerVisibilitySnapshot
): void {
  if (!layerId) return;
  const store = useLayersStore.getState();
  if (snap.showLabel !== undefined) store.update({ id: layerId, showLabel: snap.showLabel });
  if (snap.showCota !== undefined) store.update({ id: layerId, showCota: snap.showCota });
}
