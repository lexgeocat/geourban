import type { Pt } from '@kernel/geometry/polygonEngine';

/**
 * Normaliza un vector 2D `(dx, dy)` a un vector unitario.
 *
 * Si el input es el vector cero (magnitud 0), devuelve `[1, 0]` como fallback
 * para evitar división por cero. Esto preserva el comportamiento original
 * de las dos copias que existían en `ringFillet.ts` y `roadNetworkEngine.ts`
 * (`const len = Math.hypot(dx, dy) || 1`).
 */
export function normalize(dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}
