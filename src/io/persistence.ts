import Dexie, { type Table } from 'dexie';
import type { GeoUrbanProject } from './types';

export class GeoUrbanDB extends Dexie {
  projects!: Table<GeoUrbanProject & { id?: number; savedAt: string }, number>;

  constructor() {
    super('GeoUrbanDB');
    this.version(1).stores({
      projects: '++id, name, updatedAt, savedAt',
    });
  }
}

export const db = new GeoUrbanDB();

const AUTOSAVE_KEY = 'current';

export async function autosaveProject(project: GeoUrbanProject) {
  const payload = {
    ...project,
    updatedAt: new Date().toISOString(),
    savedAt: new Date().toISOString(),
  };
  const existing = await db.projects.orderBy('id').reverse().first();
  if (existing?.id) {
    await db.projects.update(existing.id, payload);
    return existing.id;
  }
  return db.projects.add(payload);
}

export async function loadAutosavedProject(): Promise<GeoUrbanProject | null> {
  const row = await db.projects.orderBy('updatedAt').reverse().first();
  if (!row) return null;
  const { id: _id, savedAt: _savedAt, ...project } = row;
  return project;
}

export async function clearAutosave() {
  await db.projects.clear();
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

export { AUTOSAVE_KEY };
