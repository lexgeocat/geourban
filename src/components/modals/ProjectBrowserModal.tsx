import React, { useEffect, useState } from 'react';
import { ChevronLeft, Plus, Trash2, Copy, FolderOpen, Search } from 'lucide-react';
import type { GeoUrbanProject } from '../io/types';
import { getProjectStore, type ProjectSummary } from '../io/projectStore';

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

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Gestor de Proyectos</h2>
          <button className="modal-close" onClick={onClose}>
            <ChevronLeft />
          </button>
        </div>

        <div className="modal-body">
          <div className="project-browser-toolbar">
            <input
              type="text"
              placeholder="Buscar proyectos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="search-input"
            />
            <Search className="search-icon" />
            <button className="btn btn-primary" onClick={onNewProject}>
              <Plus /> Nuevo
            </button>
          </div>

          {loading ? (
            <div className="project-browser-loading">Cargando proyectos...</div>
          ) : filtered.length === 0 ? (
            <div className="project-browser-empty">
              <FolderOpen className="empty-icon" />
              <p>No hay proyectos guardados.</p>
              <button className="btn btn-primary" onClick={onNewProject}>
                <Plus /> Crear el primero
              </button>
            </div>
          ) : (
            <div className="project-list">
              {filtered.map((p) => (
                <div key={p.id} className="project-card">
                  {p.thumbnail && <img src={p.thumbnail} alt="" className="project-thumbnail" />}
                  <div className="project-info">
                    <h3>{p.name}</h3>
                    <span className="project-date">{new Date(p.updatedAt).toLocaleString()}</span>
                    {currentProjectId != null && p.id === currentProjectId && (
                      <span className="current-badge">Actual</span>
                    )}
                  </div>
                  <div className="project-actions">
                    <button className="action-btn" onClick={() => handleOpen(p)} title="Abrir">
                      <FolderOpen />
                    </button>
                    <button className="action-btn" onClick={() => handleDuplicate(p.id, p.name)} title="Duplicar">
                      <Copy />
                    </button>
                    <button
                      className="action-btn danger"
                      onClick={() => handleDelete(p.id, p.name)}
                      disabled={deletingId === p.id}
                      title="Eliminar"
                    >
                      <Trash2 />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};