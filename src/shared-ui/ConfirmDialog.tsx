import React from 'react';
import { Modal } from '@shared-ui/Modal';
import { useConfirmDialogStore } from './store/confirmDialogStore';

export default function ConfirmDialog() {
  const pending = useConfirmDialogStore((s) => s.pending);
  const resolve = useConfirmDialogStore((s) => s.resolve);

  return (
    <Modal
      open={!!pending}
      onOpenChange={(o) => {
        if (!o) resolve(false); // click afuera / Escape = cancelar, igual que window.confirm
      }}
      title={pending?.title ?? 'Confirmar acción'}
      visuallyHiddenTitle
      width="min(440px, 90vw)"
    >
      {pending && (
        <>
          <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--cad-text)', marginBottom: 10 }}>
            {pending.title ?? 'Confirmar acción'}
          </h2>
          <p
            style={{
              fontSize: '0.78rem',
              color: 'var(--cad-text-dim)',
              marginBottom: 16,
              lineHeight: 1.5,
              whiteSpace: 'pre-line',
            }}
          >
            {pending.message}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              onClick={() => resolve(false)}
              className="cad-icon-btn"
              style={{
                width: 'auto', height: 'auto', padding: '7px 14px', fontSize: '0.75rem',
                color: 'var(--cad-text-dim)', border: '1px solid var(--cad-border)', borderRadius: 6,
              }}
            >
              {pending.cancelLabel ?? 'Cancelar'}
            </button>
            <button
              onClick={() => resolve(true)}
              className="cad-icon-btn"
              style={{
                width: 'auto', height: 'auto', padding: '7px 14px', fontSize: '0.75rem', fontWeight: 600,
                color: pending.danger ? '#fff' : '#0d1117',
                background: pending.danger ? 'var(--cad-accent-red)' : 'var(--cad-accent)',
                border: `1px solid ${pending.danger ? 'var(--cad-accent-red)' : 'var(--cad-accent)'}`,
                borderRadius: 6,
              }}
            >
              {pending.confirmLabel ?? 'Continuar'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}