import { useState } from 'react';
import { Save, X, CheckCircle2 } from 'lucide-react';
import { Modal } from '@shared-ui/Modal';
import { saveProject } from '../projectFile';
import { useProjectFileStore } from '../store/projectFileStore';
import { toast } from '@shared-ui/store/toastStore';

export default function SaveProjectModal() {
  const open = useProjectFileStore((s) => s.saveModalOpen);
  const setOpen = useProjectFileStore((s) => s.setSaveModalOpen);
  const currentName = useProjectFileStore((s) => s.currentName);
  const setCurrentName = useProjectFileStore((s) => s.setCurrentName);
  const busy = useProjectFileStore((s) => s.busy);
  const setBusy = useProjectFileStore((s) => s.setBusy);
  const [name, setName] = useState('');
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setName(currentName ?? '');
  }

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await saveProject(trimmed);
      setCurrentName(trimmed);
      toast(`Proyecto "${trimmed}" guardado.`, { variant: 'success' });
      setOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo guardar el proyecto', {
        variant: 'error',
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title="Guardar proyecto"
      visuallyHiddenTitle
      width="min(430px, 90vw)"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(56, 189, 248, 0.16)',
                border: '1px solid rgba(56, 189, 248, 0.38)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Save size={18} color="#38BDF8" />
            </div>
            <div>
              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.96rem',
                  fontWeight: 700,
                  color: 'var(--cad-text)',
                }}
              >
                Guardar proyecto
              </h2>
              <p style={{ fontSize: '0.68rem', color: 'var(--cad-text-muted)', marginTop: 2 }}>
                Almacená todas las capas, vías, rotondas y manzanos localmente
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="cad-panel-header-close"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '0.66rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--cad-text-dim)',
            }}
          >
            Nombre del proyecto
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave();
            }}
            className="cad-input"
            placeholder="Ej. Plan Maestro Sector Norte"
            style={{
              padding: '8px 11px',
              fontSize: '0.78rem',
              fontFamily: 'var(--font-sans)',
              borderRadius: 8,
            }}
          />
        </label>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            paddingTop: 10,
            borderTop: '1px solid var(--cad-border)',
          }}
        >
          <button onClick={() => setOpen(false)} className="cad-btn-secondary">
            Cancelar
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={busy || !name.trim()}
            className="cad-btn-primary"
          >
            {busy ? (
              <>
                <span className="cad-spinner" /> Guardando…
              </>
            ) : (
              <>
                <CheckCircle2 size={14} />
                <span>Guardar proyecto</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
