import React, { useEffect, useState } from 'react';
import { Modal } from '@shared-ui/Modal';
import { listProjects, loadProject, deleteProject, type ProjectSummary } from '../projectFile';
import { useProjectFileStore } from '../store/projectFileStore';
import { toast } from '@shared-ui/store/toastStore';
import { confirmAsync } from '@shared-ui/store/confirmDialogStore';

function formatDate(ms: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function OpenProjectModal() {
  const open = useProjectFileStore((s) => s.openModalOpen);
  const setOpen = useProjectFileStore((s) => s.setOpenModalOpen);
  const setCurrentName = useProjectFileStore((s) => s.setCurrentName);
  const busy = useProjectFileStore((s) => s.busy);
  const setBusy = useProjectFileStore((s) => s.setBusy);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listProjects()
      .then((result) => {
        if (cancelled) return;
        setProjects(result);
        setLoadError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'No se pudo listar los proyectos');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleOpen = async (name: string) => {
    setBusy(true);
    try {
      await loadProject(name);
      setCurrentName(name);
      toast(`Proyecto "${name}" cargado.`, { variant: 'success' });
      setOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo cargar el proyecto', { variant: 'error', durationMs: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (name: string) => {
    const ok = await confirmAsync(`¿Eliminar el proyecto "${name}"? Esta acción no se puede deshacer.`, {
      title: 'Eliminar proyecto', confirmLabel: 'Eliminar', cancelLabel: 'Cancelar', danger: true,
    });
    if (!ok) return;
    try {
      await deleteProject(name);
      setProjects((prev) => prev.filter((p) => p.name !== name));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'No se pudo eliminar el proyecto', { variant: 'error' });
    }
  };

  return (
    <Modal open={open} onOpenChange={setOpen} title="Abrir proyecto" visuallyHiddenTitle width="min(480px, 90vw)">
      <h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--cad-text)', marginBottom: 12 }}>
        Abrir proyecto
      </h2>

      {loadError && (
        <p style={{ fontSize: '0.72rem', color: 'var(--cad-accent-red)', marginBottom: 10 }}>{loadError}</p>
      )}

      {projects.length === 0 && !loadError ? (
        <p style={{ fontSize: '0.72rem', color: 'var(--cad-text-muted)' }}>No hay proyectos guardados todavía.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
          {projects.map((p) => (
            <div
              key={p.name}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--cad-bg-surface)', border: '1px solid var(--cad-border)', borderRadius: 6 }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--cad-text)', fontWeight: 600, overflowWrap: 'anywhere' }}>{p.name}</div>
                <div style={{ fontSize: '0.62rem', color: 'var(--cad-text-muted)' }}>
                  {formatDate(p.modifiedAtMs)} · {formatSize(p.sizeBytes)}
                </div>
              </div>
              <button
                onClick={() => void handleOpen(p.name)}
                disabled={busy}
                className="cad-icon-btn"
                style={{ width: 'auto', height: 'auto', padding: '5px 10px', fontSize: '0.68rem', color: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 4 }}
              >
                Abrir
              </button>
              <button
                onClick={() => void handleDelete(p.name)}
                disabled={busy}
                style={{ background: 'none', border: 'none', color: 'var(--cad-accent-red)', cursor: 'pointer', fontSize: '0.8rem' }}
                title="Eliminar"
                aria-label={`Eliminar ${p.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}