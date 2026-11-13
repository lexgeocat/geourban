import { useEffect, useState } from 'react';
import { FolderOpen, FolderKanban, Trash2, X, Clock, HardDrive } from 'lucide-react';
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
      toast(err instanceof Error ? err.message : 'No se pudo cargar el proyecto', {
        variant: 'error',
        durationMs: 6000,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (name: string) => {
    const ok = await confirmAsync(`¿Eliminar el proyecto "${name}"? Esta acción no se puede deshacer.`, {
      title: 'Eliminar proyecto',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      danger: true,
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
    <Modal
      open={open}
      onOpenChange={setOpen}
      title="Abrir proyecto"
      visuallyHiddenTitle
      width="min(500px, 92vw)"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(251, 191, 36, 0.16)',
                border: '1px solid rgba(251, 191, 36, 0.38)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <FolderOpen size={18} color="#FBBF24" />
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
                Abrir proyecto
              </h2>
              <p style={{ fontSize: '0.68rem', color: 'var(--cad-text-muted)', marginTop: 2 }}>
                Seleccioná un proyecto guardado en tu estación de trabajo
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

        {loadError && (
          <div
            style={{
              padding: '9px 12px',
              borderRadius: 9,
              background: 'rgba(244, 63, 94, 0.14)',
              border: '1px solid rgba(244, 63, 94, 0.35)',
              fontSize: '0.72rem',
              color: '#FB7185',
            }}
          >
            {loadError}
          </div>
        )}

        {projects.length === 0 && !loadError ? (
          <div
            style={{
              padding: '28px 16px',
              textAlign: 'center',
              borderRadius: 12,
              background: 'var(--cad-bg-surface)',
              border: '1px dashed var(--cad-border)',
              color: 'var(--cad-text-muted)',
              fontSize: '0.75rem',
            }}
          >
            No hay proyectos guardados todavía.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 330, overflowY: 'auto', paddingRight: 2 }}>
            {projects.map((p) => (
              <div
                key={p.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  background: 'var(--cad-bg-surface)',
                  border: '1px solid var(--cad-border)',
                  borderRadius: 10,
                  transition: 'border-color 140ms ease',
                }}
              >
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: 'rgba(255, 107, 74, 0.12)',
                    border: '1px solid rgba(255, 107, 74, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <FolderKanban size={15} color="#FF6B4A" />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '0.79rem',
                      color: 'var(--cad-text)',
                      fontWeight: 700,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {p.name}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: '0.62rem',
                      color: 'var(--cad-text-muted)',
                      marginTop: 2,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <Clock size={10} /> {formatDate(p.modifiedAtMs)}
                    </span>
                    <span>·</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <HardDrive size={10} /> {formatSize(p.sizeBytes)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => void handleOpen(p.name)}
                  disabled={busy}
                  className="cad-btn-primary"
                  style={{ padding: '6px 12px', fontSize: '0.68rem', borderRadius: 7 }}
                >
                  Abrir
                </button>
                <button
                  onClick={() => void handleDelete(p.name)}
                  disabled={busy}
                  className="cad-icon-btn"
                  style={{ width: 28, height: 28, color: '#FB7185' }}
                  title={`Eliminar ${p.name}`}
                  aria-label={`Eliminar ${p.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            paddingTop: 8,
            borderTop: '1px solid var(--cad-border)',
          }}
        >
          <button onClick={() => setOpen(false)} className="cad-btn-secondary">
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}
