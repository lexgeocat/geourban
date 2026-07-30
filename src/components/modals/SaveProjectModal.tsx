import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { saveProject } from '../../persistence/projectFile';
import { useProjectFileStore } from '../../store/ui/projectFileStore';
import { toast } from '../../store/ui/toastStore';

export default function SaveProjectModal() {
  const open = useProjectFileStore((s) => s.saveModalOpen);
  const setOpen = useProjectFileStore((s) => s.setSaveModalOpen);
  const currentName = useProjectFileStore((s) => s.currentName);
  const setCurrentName = useProjectFileStore((s) => s.setCurrentName);
  const busy = useProjectFileStore((s) => s.busy);
  const setBusy = useProjectFileStore((s) => s.setBusy);
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) setName(currentName ?? '');
  }, [open, currentName]);

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
        <button
          onClick={() => setOpen(false)}
          className="cad-icon-btn"
          style={{ width: 'auto', height: 'auto', padding: '7px 12px', fontSize: '0.72rem', color: 'var(--cad-text-dim)', border: '1px solid var(--cad-border)', borderRadius: 6 }}
        >
          Cancelar
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={busy || !name.trim()}
          className="cad-icon-btn"
          style={{ width: 'auto', height: 'auto', padding: '7px 14px', fontSize: '0.72rem', fontWeight: 600, color: '#0d1117', background: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 6, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? <><span className="cad-spinner" /> Guardando…</> : 'Guardar'}
        </button>
      </div>
    </Modal>
  );
}