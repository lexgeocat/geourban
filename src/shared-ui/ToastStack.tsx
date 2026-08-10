import React from 'react';
import { useToastStore, type Toast, type ToastVariant } from './store/toastStore';

const VARIANT_COLORS: Record<ToastVariant, { bg: string; border: string; fg: string }> = {
  info:    { bg: 'rgba(13, 17, 23, 0.95)', border: 'var(--cad-accent)',     fg: 'var(--cad-text)' },
  success: { bg: 'rgba(13, 17, 23, 0.95)', border: '#10b981',               fg: '#10b981' },
  warning: { bg: 'rgba(13, 17, 23, 0.95)', border: '#e3b341',               fg: '#e3b341' },
  error:   { bg: 'rgba(13, 17, 23, 0.95)', border: 'var(--cad-accent-red)', fg: 'var(--cad-accent-red)' },
};

const VARIANT_ICONS: Record<ToastVariant, string> = {
  info: 'ⓘ',
  success: '✓',
  warning: '⚠',
  error: '✕',
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const palette = VARIANT_COLORS[toast.variant];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        minWidth: 260,
        maxWidth: 380,
        padding: '10px 12px',
        marginBottom: 8,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderLeft: `3px solid ${palette.border}`,
        borderRadius: 6,
        color: 'var(--cad-text)',
        fontSize: '0.75rem',
        lineHeight: 1.4,
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        animation: 'fadeSlideIn 180ms ease-out',
      }}
    >
      <span aria-hidden style={{ color: palette.fg, fontWeight: 700, flexShrink: 0, lineHeight: 1.4 }}>
        {VARIANT_ICONS[toast.variant]}
      </span>
      <span style={{ flex: 1, whiteSpace: 'pre-line' }}>{toast.message}</span>
      <button
        onClick={() => dismiss(toast.id)}
        aria-label="Cerrar notificación"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--cad-text-dim)',
          cursor: 'pointer',
          fontSize: '0.85rem',
          padding: 0,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

export default function ToastStack() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div
      style={{
        position: 'fixed',
        right: 16,
        bottom: 'calc(var(--cad-statusbar-height, 24px) + 16px)',
        zIndex: 'var(--z-toast-stack)',
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
      }}
    >
      {toasts.map((t) => (
        <div key={t.id} style={{ pointerEvents: 'auto' }}>
          <ToastItem toast={t} />
        </div>
      ))}
    </div>
  );
}
