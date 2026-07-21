// src/io/persistence.ts
import { getProjectStore } from './projectStore';
import { useCurrentProjectStore } from '../store/currentProjectStore';
import type { GeoUrbanProject } from './types';

/**
 * Guarda/actualiza el proyecto en el backend correcto (Dexie en Web,
 * SQLite vía plugin-sql en Desktop — ver projectStore.ts). Usa
 * `currentProjectId` para saber A QUÉ proyecto pertenece este autosave;
 * antes se asumía "el último registro", lo cual era incorrecto en cuanto
 * hubiera más de un proyecto guardado.
 */
export async function autosaveProject(project: GeoUrbanProject): Promise<number> {
  const store = getProjectStore();
  const currentId = useCurrentProjectStore.getState().currentProjectId;
  const payload: GeoUrbanProject = { ...project, id: project.id ?? currentId ?? undefined };

  const id = await store.save(payload);
  if (useCurrentProjectStore.getState().currentProjectId !== id) {
    useCurrentProjectStore.getState().setCurrentProjectId(id);
  }
  return id;
}

export function startAutosave(getProject: () => GeoUrbanProject, intervalMs = 30_000) {
  let timer: ReturnType<typeof setInterval> | null = null;

  const save = () => {
    void autosaveProject(getProject()).catch(console.error);
  };

  timer = setInterval(save, intervalMs);

  const onBeforeUnload = () => save();
  window.addEventListener('beforeunload', onBeforeUnload);

  return () => {
    if (timer) clearInterval(timer);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}