import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { LabelStyleConfig } from '../model/labelModel';

export interface LabelFieldsSnapshot {
  config?: LabelStyleConfig;
  text?: string;
}
export function restoreLabelFields(feature: Feature<Geometry>, prev: LabelFieldsSnapshot): void {
  if (prev.config) feature.set('labelConfig', prev.config, true);
  else feature.unset('labelConfig', true);
  if (prev.text !== undefined) feature.set('labelText', prev.text, true);
  else feature.unset('labelText', true);
}
