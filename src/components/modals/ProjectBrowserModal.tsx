import React, { useEffect, useState } from 'react';
import { ChevronLeft, Plus, Trash2, Copy, FolderOpen, Search } from 'lucide-react';
import type { GeoUrbanProject } from '../../io/types';
import { getProjectStore, type ProjectSummary } from '../../io/projectStore';
import { Modal } from '../ui/Modal';

interface ProjectBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenProject: (project: GeoUrbanProject) => void;
  onNewProject: () => void;
  currentProjectId?: number | null;
}

export const ProjectBrowserModal: React.FC<ProjectBrowserModalProps> = ({
  isOpen,
  onClose,
  onOpenProject,
  onNewProject,
  currentProjectId,
}) => {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen]);

  const refresh = async () => {
    setLoading(true);
    try {
      setProjects(await getProjectStore().list());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async (project: ProjectSummary) => {
    const full = await getProjectStore().load(project.id);
    if (full) onOpenProject(full);
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`¿Eliminar proyecto "${name}"? Esta acción no se puede deshacer.`)) return;
    setDeletingId(id);
    try {
      await getProjectStore().delete(id);
      setProjects((p) => p.filter((pr) => pr.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDuplicate = async (id: number, name: string) => {
    const newName = window.prompt('Nombre para la copia:', `${name} (copia)`);
    if (!newName) return;
    try {
      await getProjectStore().duplicate(id, newName);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al duplicar');
    }
  };

  const filtered = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Modal
      open={isOpen}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Gestor de Proyectos"
      visuallyHiddenTitle
      width="min(720px, 92vw)"
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: '1px solid var(--cad-border)',
        }}
      >
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--cad-text)', letterSpacing: '0.02em' }}>
          Gestor de Proyectos
        </h2>
        <button onClick={onClose} className="cad-icon-btn" aria-label="Cerrar" style={{ width: 28, height: 28 }}>
          <ChevronLeft size={16} />
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--cad-text-muted)' }} />
          <input
            type="text"
            placeholder="Buscar proyectos..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="cad-input"
            style={{ paddingLeft: 26 }}
          />
        </div>
        <button
          onClick={onNewProject}
          className="cad-icon-btn"
          style={{
            width: 'auto', height: 'auto', padding: '8px 12px', fontSize: '0.75rem', fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--cad-accent)', color: '#0d1117', border: '1px solid var(--cad-accent)', borderRadius: 6,
          }}
        >
          <Plus size={14} /> Nuevo
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '24px 0', textAlign: 'center', fontSize: '0.75rem', color: 'var(--cad-text-muted)' }}>
          Cargando proyectos...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center' }}>
          <FolderOpen size={32} style={{ color: 'var(--cad-text-muted)', marginBottom: 10 }} />
          <p style={{ fontSize: '0.78rem', color: 'var(--cad-text-dim)', marginBottom: 12 }}>
            No hay proyectos guardados.
          </p>
          <button
            onClick={onNewProject}
            className="cad-icon-btn"
            style={{
              width: 'auto', height: 'auto', padding: '8px 14px', fontSize: '0.75rem', fontWeight: 600,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'var(--cad-accent)', color: '#0d1117', border: '1px solid var(--cad-accent)', borderRadius: 6,
            }}
          >
            <Plus size={14} /> Crear el primero
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '55vh', overflowY: 'auto' }}>
          {filtered.map((p) => (
            <div
              key={p.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                background: 'var(--cad-bg-surface)', border: '1px solid var(--cad-border)', borderRadius: 6,
              }}
            >
              {p.thumbnail ? (
                <img src={p.thumbnail} alt="" style={{ width: 48, height: 36, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
              ) : (
                <div style={{ width: 48, height: 36, borderRadius: 4, background: 'var(--cad-bg-deepest)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <FolderOpen size={16} style={{ color: 'var(--cad-text-muted)' }} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--cad-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </span>
                  {currentProjectId != null && p.id === currentProjectId && (
                    <span style={{ fontSize: '0.6rem', color: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 3, padding: '0 5px' }}>
                      Actual
                    </span>
                  )}
                </div>
                <span style={{ fontSize: '0.65rem', color: 'var(--cad-text-muted)' }}>
                  {new Date(p.updatedAt).toLocaleString()}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                <button className="cad-icon-btn" onClick={() => handleOpen(p)} title="Abrir" style={{ width: 30, height: 30 }}>
                  <FolderOpen size={14} />
                </button>
                <button className="cad-icon-btn" onClick={() => handleDuplicate(p.id, p.name)} title="Duplicar" style={{ width: 30, height: 30 }}>
                  <Copy size={14} />
                </button>
                <button
                  className="cad-icon-btn"
                  onClick={() => handleDelete(p.id, p.name)}
                  disabled={deletingId === p.id}
                  title="Eliminar"
                  style={{ width: 30, height: 30, color: 'var(--cad-accent-red)', opacity: deletingId === p.id ? 0.5 : 1 }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};