import type { Pt } from '@kernel/geometry/polygonEngine';

export function normalize(dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}
