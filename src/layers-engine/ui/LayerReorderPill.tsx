// src/layers-engine/ui/LayerReorderPill.tsx
import { createPortal } from 'react-dom';
import { useState } from 'react';
import { GripVertical } from 'lucide-react';
import type { PointerReorderRow } from '@layers-engine/hooks/usePointerLayerReorder';

interface LayerReorderPillProps {
  row: PointerReorderRow | null;
  pointer: { x: number; y: number } | null;
}

/**
 * Pill flotante que sigue al cursor mientras se arrastra una capa.
 *
 * Se monta por portal a `document.body` con `position: fixed` para no
 * ser cortado por el `overflow:hidden` del panel ni por el viewport
 * del scroller. La traslación se aplica con `transform` directo (no
 * con `top`/`left` por frame) — un solo cambio de estilo por frame
 * en lugar de un re-render de React.
 */
export function LayerReorderPill({ row, pointer }: LayerReorderPillProps) {
  // SSR guard: en SSR `document` no existe. Lazy init evita el
  // `useEffect` + `setState` que el plugin de hooks marca como
  // anti-pattern en React 19.
  const [mounted] = useState(() => typeof document !== 'undefined');
  if (!mounted) return null;
  if (!row || !pointer) return null;

  const color = row.color || 'var(--cad-accent)';

  return createPortal(
    <div
      aria-hidden="true"
      data-layer-reorder-pill="true"
      style={{
        position: 'fixed',
        // Offset para que el pill se vea "agarrado" desde la izquierda del cursor.
        left: 0,
        top: 0,
        transform: `translate3d(${pointer.x + 12}px, ${pointer.y - 18}px, 0)`,
        willChange: 'transform',
        pointerEvents: 'none',
        zIndex: 'var(--z-ribbon-dropdown, 9999)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px 4px 6px',
        borderRadius: 6,
        background: 'rgba(20, 28, 48, 0.92)',
        backdropFilter: 'blur(8px)',
        border: '1px solid var(--cad-border)',
        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.04)',
        fontSize: '0.7rem',
        fontWeight: 600,
        color: 'var(--cad-text)',
        maxWidth: 240,
        lineHeight: 1.1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14, height: 14, flexShrink: 0,
          color: 'var(--cad-text-dim)',
        }}
      >
        <GripVertical size={12} strokeWidth={1.75} />
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 10, height: 10, flexShrink: 0,
          borderRadius: 2,
          background: color,
          border: '1px solid rgba(255, 255, 255, 0.3)',
          boxShadow: `0 0 6px ${color}66`,
        }}
      />
      <span
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        {row.name}
      </span>
    </div>,
    document.body,
  );
}
