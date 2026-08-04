import type { GeoUrbanFeatureKind } from '../../core/objectModel';
import { pickLayerId } from '../entities/layerResolution';

export function requireLayerForKind(kind: GeoUrbanFeatureKind): Promise<string | null> {
  const id = pickLayerId({ kind, requireKindMatch: true, autoCreate: true });
  return Promise.resolve(id ?? null);
}