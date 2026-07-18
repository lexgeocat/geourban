import React, { useEffect, useState } from 'react';
import { ChevronLeft, Plus, Trash2, Copy, FolderOpen, Search } from 'lucide-react';
import type { GeoUrbanProject } from '../io/types';

interface StoredProject {
  id: number;
  name: string;
  updated_at: string;
  thumbnail?: string;
}

interface ProjectBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenProject: (project: GeoUrbanProject) => void;
  onNewProject: () => void;
  currentProjectName?: string;
}

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI__;

async function listProjects(): Promise<StoredProject[]> {
  if (!isTauri) return [];
  const { listProjectsDesktop } = await import('../io/persistenceDesktop');
  return listProjectsDesktop();
}

async function loadProject(projectId: number): Promise<GeoUrbanProject | null> {
  if (!isTauri) return null;
  const { loadProjectDesktop } = await import('../io/persistenceDesktop');
  return loadProjectDesktop(projectId);
}

async function deleteProject(projectId: number): Promise<void> {
  if (!isTauri) return;
  const { deleteProjectDesktop } = await import('../io/persistenceDesktop');
  return deleteProjectDesktop(projectId);
}

async function duplicateProject(projectId: number, newName: string): Promise<number> {
  if (!isTauri) throw new Error('No disponible en web');
  const { duplicateProjectDesktop } = await import('../io/persistenceDesktop');
  return duplicateProjectDesktop(projectId, newName);
}

export const ProjectBrowserModal: React.FC<ProjectBrowserModalProps> = ({
  isOpen,
  onClose,
  onOpenProject,
  onNewProject,
  currentProjectName,
}) => {
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      refresh();
    }
  }, [isOpen]);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await listProjects();
      setProjects(list);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = async (project: StoredProject) => {
    const full = await loadProject(project.id);
    if (full) onOpenProject(full);
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`¿Eliminar proyecto "${name}"? Esta acción no se puede deshacer.`)) return;
    setDeletingId(id);
    try {
      await deleteProject(id);
      setProjects((p) => p.filter((pr) => pr.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const handleDuplicate = async (id: number, name: string) => {
    const newName = window.prompt('Nombre para la copia:', `${name} (copia)`);
    if (!newName) return;
    try {
      const newId = await duplicateProject(id, newName);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al duplicar');
    }
  };

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

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
          {!isTauri ? (
            <div className="project-browser-web-notice">
              <p>El gestor multi-proyecto está disponible solo en la versión de escritorio (Tauri).</p>
              <p>En la web, usa <strong>Archivo → Guardar como .geourban</strong> y <strong>Abrir .geourban</strong>.</p>
              <button className="btn btn-primary" onClick={onNewProject}>Nuevo proyecto</button>
            </div>
          ) : (
            <>
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
                      {p.thumbnail && (
                        <img
                          src={p.thumbnail}
                          alt=""
                          className="project-thumbnail"
                        />
                      )}
                      <div className="project-info">
                        <h3>{p.name}</h3>
                        <span className="project-date">
                          {new Date(p.updated_at).toLocaleString()}
                        </span>
                        {p.id === Number(currentProjectName) && <span className="current-badge">Actual</span>}
                      </div>
                      <div className="project-actions">
                        <button
                          className="action-btn"
                          onClick={() => handleOpen(p)}
                          title="Abrir"
                        >
                          <FolderOpen />
                        </button>
                        <button
                          className="action-btn"
                          onClick={() => handleDuplicate(p.id, p.name)}
                          title="Duplicar"
                        >
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};