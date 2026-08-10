import { useCallback, useEffect, useRef, useState } from 'react';

export type PanelPosition = { top: number; left: number };

export type UseDraggablePanelOptions = {
  initial: PanelPosition;
  edgePadding?: number;
};

export function useDraggablePanel({
  initial,
  edgePadding = 8,
}: UseDraggablePanelOptions): {
  position: PanelPosition;
  onDragHandleMouseDown: (e: React.MouseEvent) => void;
  setPosition: React.Dispatch<React.SetStateAction<PanelPosition>>;
} {
  const [position, setPosition] = useState<PanelPosition>(initial);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startTop: number;
    startLeft: number;
  } | null>(null);

  const clamp = useCallback(
    (top: number, left: number) => {
      const maxLeft = Math.max(edgePadding, window.innerWidth - edgePadding);
      const maxTop = Math.max(edgePadding, window.innerHeight - edgePadding);
      return {
        top: Math.min(Math.max(edgePadding, top), maxTop),
        left: Math.min(Math.max(edgePadding, left), maxLeft),
      };
    },
    [edgePadding],
  );

  useEffect(() => {
    const onResize = () => {
      setPosition((p) => clamp(p.top, p.left));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  const onDragHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // solo botón izquierdo
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startTop: position.top,
        startLeft: position.left,
      };
      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const nextTop = dragRef.current.startTop + (ev.clientY - dragRef.current.startY);
        const nextLeft = dragRef.current.startLeft + (ev.clientX - dragRef.current.startX);
        const c = clamp(nextTop, nextLeft);
        setPosition(c);
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [position.top, position.left, clamp],
  );

  return { position, onDragHandleMouseDown, setPosition };
}
