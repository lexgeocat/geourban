import {
  createDirectExtensionPoint,
  type EntityGeometryProvider,
} from '@kernel/registry/ExtensionPointRegistry';

export const entityGeometryProviders = createDirectExtensionPoint<EntityGeometryProvider>();
export type { EntityGeometryProvider };
