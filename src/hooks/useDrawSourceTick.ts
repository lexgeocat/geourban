import { useEffect, useRef, useState } from 'react';
import type VectorSource from 'ol/source/Vector.js';

const CHANGE_THROTTLE_MS = 150;

export function useDrawSourceTick(drawSource: VectorSource | null): number {
  const [tick, setTick] = useState(0);
  const lastChangeAtRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!drawSource) return;

    const bumpImmediate = () => setTick((n) => n + 1);

    // 'change' se dispara en cada micro-movimiento durante un arrastre de
    // vértice — sin throttle, cada paneles con recorridos O(n) del dataset
    // completo recalculaba en cada pixel de drag.
    const bumpThrottled = () => {
      const now = Date.now();
      const elapsed = now - lastChangeAtRef.current;
      if (elapsed >= CHANGE_THROTTLE_MS) {
        lastChangeAtRef.current = now;
        setTick((n) => n + 1);
      } else if (!pendingRef.current) {
        pendingRef.current = setTimeout(() => {
          pendingRef.current = null;
          lastChangeAtRef.current = Date.now();
          setTick((n) => n + 1);
        }, CHANGE_THROTTLE_MS - elapsed);
      }
    };

    drawSource.on('addfeature', bumpImmediate);
    drawSource.on('removefeature', bumpImmediate);
    drawSource.on('change', bumpThrottled);
    return () => {
      drawSource.un('addfeature', bumpImmediate);
      drawSource.un('removefeature', bumpImmediate);
      drawSource.un('change', bumpThrottled);
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
  }, [drawSource]);

  return tick;
}