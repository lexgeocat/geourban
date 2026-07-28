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