// src/io/persistenceDesktop.ts
//
// Fase 5: este archivo YA NO abre su propia base sql.js en memoria (esa
// base nunca tocaba disco — H15 — y quedaba completamente desincronizada
// del autosave, que usaba Dexie). Ahora delega en el ProjectStore
// unificado (projectStore.ts), que en Desktop usa @tauri-apps/plugin-sql.
//
// Se mantienen los mismos nombres exportados para no romper consumidores
// existentes.

import { getProjectStore, isTauri, type ProjectSummary } from './projectStore';
import type { GeoUrbanProject } from './types';

export { isTauri };

export async function autosaveProjectDesktop(project: GeoUrbanProject): Promise<number> {
  return getProjectStore().save(project);
}

/** @deprecated preferir `startAutosave` de io/persistence.ts — ya elige
 *  el backend correcto solo, no hace falta llamar la variante desktop a mano. */
export function startAutosaveDesktop(getProject: () => GeoUrbanProject, intervalMs = 30_000) {
  let timer: ReturnType<typeof setInterval> | null = null;
  const save = () => {
    void autosaveProjectDesktop(getProject()).catch(console.error);
  };
  timer = setInterval(save, intervalMs);
  const onBeforeUnload = () => save();
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => {
    if (timer) clearInterval(timer);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}

export async function loadProjectDesktop(projectId: number): Promise<GeoUrbanProject | null> {
  return getProjectStore().load(projectId);
}

export async function listProjectsDesktop(): Promise<ProjectSummary[]> {
  return getProjectStore().list();
}

export async function deleteProjectDesktop(projectId: number): Promise<void> {
  return getProjectStore().delete(projectId);
}

export async function duplicateProjectDesktop(projectId: number, newName: string): Promise<number> {
  return getProjectStore().duplicate(projectId, newName);
}

export async function updateProjectThumbnail(projectId: number, thumbnailDataUrl: string): Promise<void> {
  return getProjectStore().updateThumbnail(projectId, thumbnailDataUrl);
}