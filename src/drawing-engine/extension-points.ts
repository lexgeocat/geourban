import type { GeoUrbanFeatureKind } from '@kernel/domain-model/featureModel';
import { createExtensionPoint, type Provider } from '@kernel/registry/ExtensionPointRegistry';

export type EraseInterceptor = (kind: GeoUrbanFeatureKind, id: string) => boolean;
export const eraseInterceptors = createExtensionPoint<EraseInterceptor>();
export function isEraseIntercepted(kind: GeoUrbanFeatureKind, id: string): boolean {
  return eraseInterceptors.collect().some((fn) => fn(kind, id));
}
export type { Provider };
