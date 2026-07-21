// src/hooks/useIncrementalRender.ts
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Renderizado incremental para listas largas dentro de un contenedor con
 * scroll propio (H18 / Fase 6 — "Virtualización de listas largas en
 * paneles"). No es virtualización por índice/alto fijo a propósito:
 * ManzanoPanel renderiza tarjetas de alto variable (colapsadas/
 * expandidas, con sub-listas de lotes opcionales) — una virtualización
 * absoluta rompería la posición de scroll en cuanto una tarjeta cambia
 * de alto. Esto evita el costo real que importa (montar cientos de
 * tarjetas complejas de una sola vez) creciendo la cantidad de filas
 * montadas a medida que el usuario se acerca al final de la lista.
 */
export function useIncrementalRender(
  totalCount: number,
  batchSize = 40,
  rootRef?: RefObject<HTMLElement | null>,
) {
  const [visibleCount, setVisibleCount] = useState(Math.min(totalCount, batchSize));
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Si la lista se achica (filtro/borrado) o crece de golpe (import),
  // no dejar visibleCount desalineado respecto al total actual.
  useEffect(() => {
    setVisibleCount((v) => Math.min(Math.max(v, batchSize), totalCount));
  }, [totalCount, batchSize]);

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

  return { visibleCount, sentinelRef };
}