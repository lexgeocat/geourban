import { create } from 'zustand';
import type { GeoUrbanProject } from './types';
import { getSql } from './sqlLoader';

interface StoredProject {
  id: number;
  name: string;
  updated_at: string;
  thumbnail?: string;
}

let db: any = null;

async function initDb() {
  if (db) return db;
  const SQL = await getSql();
  db = new SQL.Database();
  
  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      thumbnail TEXT
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS project_data (
      project_id INTEGER PRIMARY KEY,
      geourban_json TEXT NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
  
  return db;
}

export async function autosaveProjectDesktop(project: GeoUrbanProject): Promise<number> {
  const database = await initDb();
  const updatedAt = new Date().toISOString();
  
  if (project.id) {
    // Update existing
    database.run(
      'UPDATE projects SET name = ?, updated_at = ? WHERE id = ?',
      [project.name, updatedAt, project.id]
    );
  } else {
    // Insert new
    const stmt = database.prepare('INSERT INTO projects (name, updated_at) VALUES (?, ?)');
    stmt.run([project.name, updatedAt]);
    stmt.free();
    // Get the last insert ID
    project.id = database.exec('SELECT last_insert_rowid()')[0].values[0][0];
  }
  
  // Save project data
  const dataStmt = database.prepare(
    'INSERT OR REPLACE INTO project_data (project_id, geourban_json) VALUES (?, ?)'
  );
  dataStmt.run([project.id, JSON.stringify(project)]);
  dataStmt.free();
  
  return project.id!;
}

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
  const database = await initDb();
  const rows = database.exec(
    'SELECT geourban_json FROM project_data WHERE project_id = ?',
    [projectId]
  );
  if (rows.length === 0 || rows[0].values.length === 0) return null;
  return JSON.parse(rows[0].values[0][0]);
}

export async function listProjectsDesktop(): Promise<StoredProject[]> {
  const database = await initDb();
  const rows = database.exec('SELECT id, name, updated_at, thumbnail FROM projects ORDER BY updated_at DESC');
  if (rows.length === 0) return [];
  return rows[0].values.map((v: any[]) => ({
    id: v[0],
    name: v[1],
    updated_at: v[2],
    thumbnail: v[3],
  }));
}

export async function deleteProjectDesktop(projectId: number): Promise<void> {
  const database = await initDb();
  database.run('DELETE FROM projects WHERE id = ?', [projectId]);
}

export async function duplicateProjectDesktop(projectId: number, newName: string): Promise<number> {
  const database = await initDb();
  const rows = database.exec(
    'SELECT geourban_json FROM project_data WHERE project_id = ?',
    [projectId]
  );
  if (rows.length === 0 || rows[0].values.length === 0) throw new Error('Proyecto no encontrado');
  
  const project = JSON.parse(rows[0].values[0][0]);
  project.name = newName;
  project.updatedAt = new Date().toISOString();
  project.id = undefined; // Will get new ID on save
  
  return autosaveProjectDesktop(project);
}

export async function updateProjectThumbnail(projectId: number, thumbnailDataUrl: string): Promise<void> {
  const database = await initDb();
  database.run('UPDATE projects SET thumbnail = ? WHERE id = ?', [thumbnailDataUrl, projectId]);
}

/** Detecta si estamos corriendo dentro de Tauri (desktop) */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI__;
}