/** Throttling basado en requestAnimationFrame: garantiza a lo sumo una
 *  ejecución de `fn` por frame de render, usando siempre el último valor
 *  recibido entre frames (coalescing). Pensado para handlers de alta
 *  frecuencia (pointermove, changefeature durante drag) que disparan
 *  muchos más eventos por segundo de los que la UI necesita reflejar.
 */
export function rafThrottle<Args extends unknown[]>(
  fn: (...args: Args) => void,
): (...args: Args) => void {
  let scheduled = false;
  let lastArgs: Args | null = null;

  const flush = () => {
    scheduled = false;
    if (lastArgs) {
      fn(...lastArgs);
      lastArgs = null;
    }
  };

  return (...args: Args) => {
    lastArgs = args;
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  };
}