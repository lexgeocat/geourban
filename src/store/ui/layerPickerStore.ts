import type { GeoUrbanFeatureKind } from '../../core/objectModel';
import { resolveOrCreateLayerForKind } from '../entities/layerAutoCreate';

export function requireLayerForKind(kind: GeoUrbanFeatureKind): Promise<string | null> {
  return Promise.resolve(resolveOrCreateLayerForKind(kind) ?? null);
}