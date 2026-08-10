import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export function useIncrementalRender(
  totalCount: number,
  batchSize = 40,
  rootRef?: RefObject<HTMLElement | null>,
) {
  const [visibleCount, setVisibleCount] = useState(Math.min(totalCount, batchSize));
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const effectiveVisibleCount = Math.min(Math.max(visibleCount, batchSize), totalCount);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || totalCount <= batchSize) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((v) => Math.min(totalCount, v + batchSize));
        }
      },
      { root: rootRef?.current ?? null, rootMargin: '160px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [totalCount, batchSize, rootRef]);

  return { visibleCount: effectiveVisibleCount, sentinelRef };
}