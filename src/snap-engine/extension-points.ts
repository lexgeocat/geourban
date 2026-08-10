import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { createExtensionPoint, type Provider } from '@kernel/registry/ExtensionPointRegistry';

export type ExtraSnapFeaturesProvider = Provider<Feature<Geometry>[]>;
export const extraSnapSources = createExtensionPoint<Feature<Geometry>[]>();
export type { Provider };
