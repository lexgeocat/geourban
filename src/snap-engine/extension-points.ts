import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { createExtensionPoint } from '@kernel/registry/ExtensionPointRegistry';

export const extraSnapSources = createExtensionPoint<Feature<Geometry>[]>();
