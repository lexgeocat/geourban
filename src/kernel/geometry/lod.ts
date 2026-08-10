const MIN_SEGMENTS = 8;
const MAX_SEGMENTS = 160;

export function resolutionAwareSegments(
  radiusMapUnits: number,
  resolution: number,
  pxError = 1.5
): number {
  if (!(radiusMapUnits > 0) || !(resolution > 0)) return MIN_SEGMENTS;
  const errorMapUnits = pxError * resolution;
  const ratio = Math.min(1, errorMapUnits / radiusMapUnits);
  const maxAngle = 2 * Math.acos(1 - ratio);
  if (!(maxAngle > 0) || !isFinite(maxAngle)) return MAX_SEGMENTS;
  const needed = Math.ceil((2 * Math.PI) / maxAngle);
  return Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, needed));
}
