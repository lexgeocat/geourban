const FILLET_MAX_RADIUS_M = 8;

export function getFilletRadiusForAngle(angleDeg: number, roadHalfWidthM?: number): number {
  const tableValue = (() => {
    if (angleDeg <= 35) return 2.5;
    if (angleDeg <= 45) return 3;
    if (angleDeg <= 95) return 4;
    if (angleDeg <= 120) return 4.5;
    if (angleDeg <= 150) return 5;
    return FILLET_MAX_RADIUS_M;
  })();

  const base = Math.min(tableValue, FILLET_MAX_RADIUS_M);
  if (roadHalfWidthM == null) return base;

  const scaledForWidth = Math.min(FILLET_MAX_RADIUS_M, roadHalfWidthM * 0.5);
  return Math.max(base, scaledForWidth);
}