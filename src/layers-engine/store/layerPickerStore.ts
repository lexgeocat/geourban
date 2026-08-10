import type { GeoUrbanFeatureKind } from '@kernel/domain-model/featureModel';
import { resolveOrCreateLayerForKind } from './layerResolution';

export function requireLayerForKind(kind: GeoUrbanFeatureKind): Promise<string | null> {
  return Promise.resolve(resolveOrCreateLayerForKind(kind) ?? null);
}