import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Modal } from '@shared-ui/Modal';
import { useConfirmDialogStore } from './store/confirmDialogStore';

export default function ConfirmDialog() {
  const pending = useConfirmDialogStore((s) => s.pending);
  const resolve = useConfirmDialogStore((s) => s.resolve);

  return (
    <Modal
      open={!!pending}
      onOpenChange={(o) => {
        if (!o) resolve(false);
      }}
      title={pending?.title ?? 'Confirmar acción'}
      visuallyHiddenTitle
      width="min(440px, 90vw)"
    >
      {pending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: pending.danger ? 'rgba(244, 63, 94, 0.16)' : 'var(--ui-10-gradient-soft)',
                border: `1px solid ${pending.danger ? 'rgba(244, 63, 94, 0.4)' : 'rgba(255, 107, 74, 0.38)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {pending.danger ? (
                <AlertTriangle size={18} color="#FB7185" />
              ) : (
                <HelpCircle size={18} color="#FF6B4A" />
              )}
            </div>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '0.94rem',
                fontWeight: 700,
                color: 'var(--cad-text)',
              }}
            >
              {pending.title ?? 'Confirmar acción'}
            </h2>
          </div>

          <p
            style={{
              fontSize: '0.77rem',
              color: 'var(--cad-text-dim)',
              lineHeight: 1.55,
              whiteSpace: 'pre-line',
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--cad-bg-surface)',
              border: '1px solid var(--cad-border)',
            }}
          >
            {pending.message}
          </p>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              paddingTop: 8,
              borderTop: '1px solid var(--cad-border)',
            }}
          >
            <button onClick={() => resolve(false)} className="cad-btn-secondary">
              {pending.cancelLabel ?? 'Cancelar'}
            </button>
            <button
              onClick={() => resolve(true)}
              className={pending.danger ? 'cad-btn-danger' : 'cad-btn-primary'}
            >
              {pending.confirmLabel ?? 'Continuar'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
