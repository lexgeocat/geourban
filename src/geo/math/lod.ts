import type Geometry from 'ol/geom/Geometry.js';

const MIN_SEGMENTS = 8;
const MAX_SEGMENTS = 160;

export function resolutionAwareSegments(
  radiusMapUnits: number,
  resolution: number,
  pxError = 1.5,
): number {
  if (!(radiusMapUnits > 0) || !(resolution > 0)) return MIN_SEGMENTS;
  const errorMapUnits = pxError * resolution;
  // sagitta ≈ r * (1 - cos(θ/2))  ⇒  despejamos el ángulo máximo por segmento.
  const ratio = Math.min(1, errorMapUnits / radiusMapUnits);
  const maxAngle = 2 * Math.acos(1 - ratio);
  if (!(maxAngle > 0) || !isFinite(maxAngle)) return MAX_SEGMENTS;
  const needed = Math.ceil((2 * Math.PI) / maxAngle);
  return Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, needed));
}

interface CacheEntry {
  bucket: number;
  geometry: Geometry;
}

const simplifyCache = new Map<string, CacheEntry>();

function resolutionBucket(resolution: number): number {
  return Math.round(Math.log(resolution) / Math.log(1.35));
}

export function getSimplifiedGeometryCached<T extends Geometry>(
  id: string | number,
  geometry: T,
  resolution: number,
  toleranceFactor = 1,
): T {
  const bucket = resolutionBucket(resolution);
  const key = String(id);
  const hit = simplifyCache.get(key);
  if (hit && hit.bucket === bucket) return hit.geometry as T;
  const tolerance = resolution * toleranceFactor;
  const simplified = tolerance > 0 ? (geometry.simplify(tolerance) as T) : geometry;
  simplifyCache.set(key, { bucket, geometry: simplified });
  return simplified;
}

export function clearSimplifyCache(): void {
  simplifyCache.clear();
}