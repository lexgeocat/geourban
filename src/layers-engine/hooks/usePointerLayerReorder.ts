// src/layers-engine/hooks/usePointerLayerReorder.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { rafThrottle } from '@kernel/utils/rafThrottle';

export interface PointerReorderRow {
  id: string;
  /** Rect de la fila en coordenadas de viewport. Se re-mide en cada frame del drag. */
  rect: DOMRect;
  /** Color representativo de la capa (se muestra en el pill flotante). */
  color?: string;
  /** Nombre a mostrar en el pill flotante. */
  name: string;
}

export type DropPosition = 'before' | 'after';

export interface PointerReorderState {
  /** id de la capa que se está arrastrando, o null. */
  draggingId: string | null;
  /** id de la fila bajo el cursor + posición relativa. */
  dropTarget: { id: string; position: DropPosition } | null;
  /** Posición del puntero en viewport (para el portal del pill). */
  pointer: { x: number; y: number } | null;
  /** Datos de la capa que se está arrastrando (para el pill y la fila atenuada). */
  draggingRow: PointerReorderRow | null;
}

export interface UsePointerLayerReorderOptions {
  /** Lista de filas en el orden en que se renderizan (top → bottom). */
  rows: PointerReorderRow[];
  /**
   * Callback opcional para leer el rect vivo de una fila durante el
   * drag. Si se provee, el hook prioriza este sobre `rows[].rect`
   * (que es un snapshot que puede quedar stale al auto-scrollear).
   * El consumer debe devolver el `getBoundingClientRect()` del
   * elemento del DOM que renderiza la fila, o `null` si la fila no
   * está montada.
   */
  getLiveRect?: (id: string) => DOMRect | null;
  /** Distancia mínima en px antes de iniciar el drag (default 4). */
  threshold?: number;
  /** Callback al soltar. `position` es 'before' (insertar arriba) o 'after' (abajo). */
  onDrop: (sourceId: string, targetId: string, position: DropPosition) => void;
  /** Callback opcional al cancelar (Escape o soltar sin target). */
  onCancel?: () => void;
  /** Habilita/deshabilita el hook entero. */
  enabled?: boolean;
}

export interface UsePointerLayerReorderResult {
  state: PointerReorderState;
  /** Handlers a aplicar a cada fila. */
  rowProps: (id: string) => {
    onPointerDown: (e: React.PointerEvent) => void;
    'aria-grabbed'?: boolean;
  };
  /** Ref para el contenedor scrollable; se usa para auto-scroll. */
  scrollerRef: React.RefObject<HTMLElement | null>;
}

/**
 * Drag & drop de filas basado en Pointer Events.
 *
 * Por qué no HTML5 DnD: falla al iniciar el drag sobre elementos
 * anidados (color picker, slider, botones internos) y genera un ghost
 * nativo no estilizable.
 *
 * Por qué pointer events + threshold de 4px: queremos que un click
 * normal NO dispare drag. Recién después de moverse 4px con el botón
 * presionado se considera drag válido.
 *
 * Por qué una línea de inserción independiente: vive entre dos filas
 * (no superpuesta) y se mueve con `transform` directo sobre el DOM,
 * sin re-render de React por frame.
 *
 * Por qué el pill por portal: el panel tiene `overflow:hidden`; un
 * nodo con `position:fixed` portal-eado a `document.body` no se corta.
 */
export function usePointerLayerReorder({
  rows,
  getLiveRect,
  threshold = 4,
  onDrop,
  onCancel,
  enabled = true,
}: UsePointerLayerReorderOptions): UsePointerLayerReorderResult {
  // Estado visible: lo que el panel y el pill consumen.
  const [state, setState] = useState<PointerReorderState>({
    draggingId: null,
    dropTarget: null,
    pointer: null,
    draggingRow: null,
  });

  // Refs para callbacks y datos vivos (sin provocar re-render).
  const onDropRef = useRef(onDrop);
  const onCancelRef = useRef(onCancel);
  const rowsRef = useRef(rows);
  const getLiveRectRef = useRef(getLiveRect);
  const scrollerRef = useRef<HTMLElement | null>(null);

  // Datos del gesto en curso (viven en un ref, no en useState).
  const gesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    candidateId: string;
    started: boolean;
    capturedElement: HTMLElement | null;
  } | null>(null);

  // Última resolución del target — vive en un ref para que el handler
  // de `pointerup` la lea de forma sincrónica sin pasar por React state.
  const lastTargetRef = useRef<{ id: string; position: DropPosition } | null>(null);

  // Fingerprint de la composición de filas (ids concatenados). Se usa
  // para detectar cambios estructurales y cancelar defensivamente un
  // drag en curso si el conjunto de filas cambia.
  const prevFingerprintRef = useRef<string>('');

  useEffect(() => {
    onDropRef.current = onDrop;
    onCancelRef.current = onCancel;
    getLiveRectRef.current = getLiveRect;
    const newFingerprint = rows.map((r) => r.id).join('|');
    const oldFingerprint = prevFingerprintRef.current;
    prevFingerprintRef.current = newFingerprint;
    // Si cambia la composición de filas mientras hay un drag en curso,
    // cancelamos defensivamente: los targets que el usuario estaba
    // apuntando ya no son válidos.
    if (
      state.draggingId &&
      gesture.current?.started &&
      oldFingerprint !== '' &&
      oldFingerprint !== newFingerprint
    ) {
      onCancelRef.current?.();
      // Limpiar el gesto en línea (no podemos llamar a cleanupGesture
      // porque está declarado más abajo; repetimos la lógica mínima).
      const g = gesture.current;
      gesture.current = null;
      lastTargetRef.current = null;
      if (g?.capturedElement) {
        try { g.capturedElement.releasePointerCapture(g.pointerId); } catch { /* */ }
      }
      setState({ draggingId: null, dropTarget: null, pointer: null, draggingRow: null });
    }
    rowsRef.current = rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDrop, onCancel, rows, getLiveRect]);

  /**
   * Resuelve qué fila está bajo el cursor y si cae en la mitad
   * superior (before) o inferior (after). Excluye la fila origen y
   * las filas con rect "vacío" (filas que aún no se montaron en el
   * DOM — caso típico: incremental render todavía no las reveló).
   *
   * Si el consumer proveyó `getLiveRect`, se prioriza sobre el
   * `rect` del snapshot (que puede quedar stale al auto-scrollear).
   */
  const resolveTarget = useCallback(
    (clientX: number, clientY: number, sourceId: string) => {
      const visible = rowsRef.current;
      const liveReader = getLiveRectRef.current;
      for (let i = 0; i < visible.length; i++) {
        const liveRect = liveReader ? liveReader(visible[i].id) : null;
        const r = liveRect ?? visible[i].rect;
        // Fila aún no montada (rect cero): no es un target válido.
        if (r.width === 0 && r.height === 0) continue;
        if (clientY >= r.top && clientY <= r.bottom) {
          if (visible[i].id === sourceId) return null;
          const position: DropPosition = clientY < r.top + r.height / 2 ? 'before' : 'after';
          return { id: visible[i].id, position };
        }
      }
      return null;
    },
    [],
  );

  // Wrappers rAF-throttled. Se crean una sola vez (al montaje) y viven
  // en refs para no recrearse entre renders. `resolveTarget` ya está
  // memorizado con `useCallback`, así que no hace falta actualizarlo.
  const updateDropTargetRef = useRef<((x: number, y: number, id: string) => void) | null>(null);
  const tickAutoScrollRef = useRef<((y: number) => void) | null>(null);
  useEffect(() => {
    updateDropTargetRef.current = rafThrottle(
      (clientX: number, clientY: number, sourceId: string) => {
        const next = resolveTarget(clientX, clientY, sourceId);
        lastTargetRef.current = next;
        setState((prev) => {
          if (
            (prev.dropTarget === null && next === null) ||
            (prev.dropTarget?.id === next?.id && prev.dropTarget?.position === next?.position)
          ) {
            return prev;
          }
          return { ...prev, dropTarget: next };
        });
      },
    );
    tickAutoScrollRef.current = rafThrottle((clientY: number) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const rect = scroller.getBoundingClientRect();
      const top = clientY - rect.top;
      const height = rect.height;
      const edge = Math.max(28, height * 0.18);
      if (top < edge) {
        const intensity = (edge - top) / edge;
        scroller.scrollTop -= 4 + 6 * intensity;
      } else if (top > height - edge) {
        const intensity = (top - (height - edge)) / edge;
        scroller.scrollTop += 4 + 6 * intensity;
      }
    });
    // cleanup: cancelar cualquier rAF pendiente al desmontar.
    return () => {
      updateDropTargetRef.current = null;
      tickAutoScrollRef.current = null;
    };
    // resolveTarget es estable (useCallback []); rowsRef y scrollerRef son refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Callbacks de un solo nivel que delegan a los wrappers rAF. Son
  // referencialmente estables entre renders (definidos con useCallback
  // con []), lo que evita re-suscribir listeners en cada frame.
  const updateDropTarget = useCallback((x: number, y: number, id: string) => {
    updateDropTargetRef.current?.(x, y, id);
  }, []);
  const tickAutoScroll = useCallback((y: number) => {
    tickAutoScrollRef.current?.(y);
  }, []);

  const cleanupGesture = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    lastTargetRef.current = null;
    if (g?.capturedElement) {
      try {
        g.capturedElement.releasePointerCapture(g.pointerId);
      } catch {
        /* el elemento pudo haber sido removido del DOM; ignorar. */
      }
    }
  }, []);

  // Listeners globales: solo se montan mientras hay un drag en curso
  // (es decir, mientras `gesture.current` exista — equivalente a
  // `state.draggingId != null`).
  useEffect(() => {
    if (!state.draggingId) return;

    const handleMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;

      // Posición del cursor → pill y resolución de target.
      setState((prev) => ({ ...prev, pointer: { x: e.clientX, y: e.clientY } }));
      updateDropTarget(e.clientX, e.clientY, g.candidateId);
      tickAutoScroll(e.clientY);

      // Arrancar el drag visual solo después de superar el threshold.
      if (!g.started) {
        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        if (Math.hypot(dx, dy) >= threshold) {
          g.started = true;
          const sourceRow = rowsRef.current.find((r) => r.id === g.candidateId) ?? null;
          setState((prev) => ({
            ...prev,
            draggingId: g.candidateId,
            draggingRow: sourceRow,
            pointer: { x: e.clientX, y: e.clientY },
          }));
        }
      }
    };

    const handleUp = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      if (g.started && lastTargetRef.current) {
        onDropRef.current(g.candidateId, lastTargetRef.current.id, lastTargetRef.current.position);
      } else if (g.started) {
        onCancelRef.current?.();
      }
      cleanupGesture();
      setState({ draggingId: null, dropTarget: null, pointer: null, draggingRow: null });
    };

    const handleCancel = (e: PointerEvent) => {
      if (gesture.current && e.pointerId === gesture.current.pointerId) {
        onCancelRef.current?.();
        cleanupGesture();
        setState({ draggingId: null, dropTarget: null, pointer: null, draggingRow: null });
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancelRef.current?.();
        cleanupGesture();
        setState({ draggingId: null, dropTarget: null, pointer: null, draggingRow: null });
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleCancel);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      window.removeEventListener('keydown', handleKey);
    };
  }, [state.draggingId, threshold, updateDropTarget, tickAutoScroll, cleanupGesture]);

  const rowProps = useCallback(
    (id: string) => ({
      onPointerDown: (e: React.PointerEvent) => {
        if (!enabled) return;
        // Ignorar drags iniciados sobre controles anidados.
        const target = e.target as HTMLElement;
        if (target.closest('button, input, select, textarea, [data-no-drag]')) {
          return;
        }
        // Solo botón principal / touch / pen.
        if (e.button !== 0) return;
        const el = e.currentTarget as HTMLElement;
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* algunos browsers no lo permiten en synthetic events; seguimos sin captura. */
        }
        gesture.current = {
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          candidateId: id,
          started: false,
          capturedElement: el,
        };
        // Marcamos draggingId para que React monte los listeners globales;
        // el drag visual (pill, atenuar fila) recién se activa al pasar
        // el threshold dentro de handleMove.
        setState({
          draggingId: id,
          dropTarget: null,
          pointer: { x: e.clientX, y: e.clientY },
          draggingRow: null,
        });
        e.preventDefault();
      },
      'aria-grabbed': state.draggingId === id ? true : undefined,
    }),
    [enabled, state.draggingId],
  );

  return {
    state,
    rowProps,
    scrollerRef,
  };
}
