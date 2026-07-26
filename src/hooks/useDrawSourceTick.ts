import { useEffect, useState } from 'react';
import type VectorSource from 'ol/source/Vector.js';

export function useDrawSourceTick(drawSource: VectorSource | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!drawSource) return;
    const bump = () => setTick((n) => n + 1);
    drawSource.on('addfeature', bump);
    drawSource.on('removefeature', bump);
    drawSource.on('change', bump);
    return () => {
      drawSource.un('addfeature', bump);
      drawSource.un('removefeature', bump);
      drawSource.un('change', bump);
    };
  }, [drawSource]);
  return tick;
}
