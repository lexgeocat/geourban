import { useState } from 'react';
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
      toast(err instanceof Error ? err.message : 'No se pudo guardar el proyecto', { variant: 'error', durationMs: 6000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={setOpen} title="Guardar proyecto" visuallyHiddenTitle width="min(420px, 90vw)">
      <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--cad-text)', marginBottom: 12 }}>
        Guardar proyecto
      </h2>
      <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        Nombre
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
          className="cad-input"
          placeholder="Nombre del proyecto"
        />
      </label>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 16 }}>
        <button onClick={() => setOpen(false)} className="cad-btn-secondary">
          Cancelar
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={busy || !name.trim()}
          className="cad-btn-primary"
        >
          {busy ? <><span className="cad-spinner" /> Guardando…</> : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
}