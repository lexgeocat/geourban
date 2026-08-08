const FILLET_MAX_RADIUS_M = 8;

export function getFilletRadiusForAngle(angleDeg: number): number {
  if (angleDeg <= 35) return 2.5;
  if (angleDeg <= 45) return 3;
  if (angleDeg <= 95) return 4;
  if (angleDeg <= 120) return 4.5;
  if (angleDeg <= 150) return 5;
  return FILLET_MAX_RADIUS_M;
}