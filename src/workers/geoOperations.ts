import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js';
import type { FeatureCollection } from 'geojson';

const geometryFactory = new GeometryFactory();
const reader = new GeoJSONReader(geometryFactory);
const writer = new GeoJSONWriter();

export type UnionRequest = {
  type: 'union';
  features: FeatureCollection;
};

export type ValidateRequest = {
  type: 'validate';
  features: FeatureCollection;
};

export type GeoWorkerRequest = UnionRequest | ValidateRequest;

export type GeoWorkerResponse =
  | { type: 'union'; result: FeatureCollection; error?: string }
  | { type: 'validate'; valid: boolean; issues: string[]; error?: string };

export function unionFeatures(collection: FeatureCollection): FeatureCollection {
  const geometries = collection.features
    .map((f) => f.geometry)
    .filter(Boolean)
    .map((g) => reader.read(g));

  if (geometries.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  let merged = geometries[0];
  for (let i = 1; i < geometries.length; i++) {
    merged = OverlayOp.union(merged, geometries[i]);
  }

  const geojson = writer.write(merged);
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { merged: true }, geometry: geojson as never }],
  };
}

export function validateTopology(collection: FeatureCollection): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  collection.features.forEach((feature, index) => {
    if (!feature.geometry) {
      issues.push(`Feature ${index}: sin geometría`);
      return;
    }
    try {
      const geom = reader.read(feature.geometry);
      if (!geom.isValid()) {
        issues.push(`Feature ${index}: geometría inválida (${geom.getValidationError()?.toString() ?? 'desconocido'})`);
      }
    } catch (err) {
      issues.push(`Feature ${index}: error al leer geometría — ${String(err)}`);
    }
  });

  return { valid: issues.length === 0, issues };
}

export function handleGeoWorkerRequest(request: GeoWorkerRequest): GeoWorkerResponse {
  try {
    if (request.type === 'union') {
      return { type: 'union', result: unionFeatures(request.features) };
    }
    const validation = validateTopology(request.features);
    return { type: 'validate', ...validation };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (request.type === 'union') {
      return { type: 'union', result: { type: 'FeatureCollection', features: [] }, error: message };
    }
    return { type: 'validate', valid: false, issues: [], error: message };
  }
}
