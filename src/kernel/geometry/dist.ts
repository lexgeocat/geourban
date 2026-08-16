import type { Pt } from './polygonEngine';

export function distToSegmentXY(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  return distToSegmentXY(p[0], p[1], a[0], a[1], b[0], b[1]);
}
