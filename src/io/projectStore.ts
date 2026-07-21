// src/io/projectStore.ts
//
// Fase 5: persistencia unificada Desktop + Web (resuelve H15).
//
// Antes: Dexie (autosave, siempre) + sql.js en memoria (Gestor de
// Proyectos, solo Tauri, nunca persistía a disco) — dos backends
// desincronizados que nunca se veían entre sí.
//
// Ahora: UNA interfaz (`ProjectStore`) con dos implementaciones:
//   - IndexedDbProjectStore → Web (Dexie/IndexedDB)
//   - TauriSqlProjectStore  → Desktop (@tauri-apps/plugin-sql, SQLite real)
//
// sql.js queda reservado EXCLUSIVAMENTE para leer/escribir .gpkg
// (io/gpkg.ts) — no debe volver a usarse como motor de persistencia de
// proyectos.

import Dexie, { type Table } from 'dexie';
import type Database from '@tauri-apps/plugin-sql';
import type { GeoUrbanProject } from './types';

export interface ProjectSummary {
  id: number;
  name: string;
  updatedAt: string;
  thumbnail?: string;
}

export interface ProjectStore {
  /** Crea o actualiza (upsert por `project.id`). Devuelve el id final. */
  save(project: GeoUrbanProject): Promise<number>;
  load(id: number): Promise<GeoUrbanProject | null>;
  list(): Promise<ProjectSummary[]>;
  delete(id: number): Promise<void>;
  duplicate(id: number, newName: string): Promise<number>;
  updateThumbnail(id: number, thumbnailDataUrl: string): Promise<void>;
}

/** Detecta si estamos corriendo dentro de Tauri (desktop). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as any).__TAURI__;
}

let cachedStore: ProjectStore | null = null;

/** Punto de entrada único — misma instancia dentro de una sesión. */
export function getProjectStore(): ProjectStore {
  if (!cachedStore) {
    cachedStore = isTauri() ? new TauriSqlProjectStore() : new IndexedDbProjectStore();
  }
  return cachedStore;
}

// ────────────────────────────────────────────────────────────────────
// Web: IndexedDB (Dexie)
// ────────────────────────────────────────────────────────────────────

type StoredRow = GeoUrbanProject & { thumbnail?: string };

class GeoUrbanDB extends Dexie {
  projects!: Table<StoredRow, number>;

  constructor() {
    super('GeoUrbanDB');
    // v1 (legado): el autosave viejo pisaba siempre "la última fila" sin
    // importar qué proyecto estuviera abierto. Se mantiene para que Dexie
    // pueda migrar en caliente las bases ya existentes en el navegador.
    this.version(1).stores({
      projects: '++id, name, updatedAt, savedAt',
    });
    // v2 (Fase 5): cada proyecto es su propia fila con identidad estable;
    // el autosave ahora sabe a qué id pertenece (ver useCurrentProjectStore).
    this.version(2).stores({
      projects: '++id, name, updatedAt',
    });
  }
}

class IndexedDbProjectStore implements ProjectStore {
  private db = new GeoUrbanDB();

  async save(project: GeoUrbanProject): Promise<number> {
    const updatedAt = new Date().toISOString();
    const payload: StoredRow = { ...project, updatedAt };
    if (project.id != null) {
      await this.db.projects.update(project.id, payload);
      return project.id;
    }
    return this.db.projects.add(payload);
  }

  async load(id: number): Promise<GeoUrbanProject | null> {
    const row = await this.db.projects.get(id);
    if (!row) return null;
    const { thumbnail: _thumbnail, ...project } = row;
    return project as GeoUrbanProject;
  }

  async list(): Promise<ProjectSummary[]> {
    const rows = await this.db.projects.orderBy('updatedAt').reverse().toArray();
    return rows.map((r) => ({
      id: r.id!,
      name: r.name,
      updatedAt: r.updatedAt,
      thumbnail: r.thumbnail,
    }));
  }

  async delete(id: number): Promise<void> {
    await this.db.projects.delete(id);
  }

  async duplicate(id: number, newName: string): Promise<number> {
    const row = await this.db.projects.get(id);
    if (!row) throw new Error('Proyecto no encontrado');
    const { id: _oldId, ...rest } = row;
    return this.db.projects.add({
      ...rest,
      name: newName,
      updatedAt: new Date().toISOString(),
    } as StoredRow);
  }

  async updateThumbnail(id: number, thumbnailDataUrl: string): Promise<void> {
    await this.db.projects.update(id, { thumbnail: thumbnailDataUrl });
  }
}

// ────────────────────────────────────────────────────────────────────
// Desktop: SQLite real vía @tauri-apps/plugin-sql (reemplaza el sql.js
// en memoria de la versión anterior — ver H15). El archivo vive en el
// directorio de datos de la app y sobrevive a reinicios.
// ────────────────────────────────────────────────────────────────────

class TauriSqlProjectStore implements ProjectStore {
  private dbPromise: Promise<Database> | null = null;

  private async getDb(): Promise<Database> {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const { default: DatabaseCtor } = await import('@tauri-apps/plugin-sql');
        const db = await DatabaseCtor.load('sqlite:geourban.db');
        await db.execute(`
          CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            thumbnail TEXT,
            geourban_json TEXT NOT NULL
          );
        `);
        return db;
      })();
    }
    return this.dbPromise;
  }

  async save(project: GeoUrbanProject): Promise<number> {
    const db = await this.getDb();
    const updatedAt = new Date().toISOString();
    const json = JSON.stringify({ ...project, updatedAt });

    if (project.id != null) {
      await db.execute(
        'UPDATE projects SET name = $1, updated_at = $2, geourban_json = $3 WHERE id = $4',
        [project.name, updatedAt, json, project.id],
      );
      return project.id;
    }

    const result = await db.execute(
      'INSERT INTO projects (name, updated_at, geourban_json) VALUES ($1, $2, $3)',
      [project.name, updatedAt, json],
    );
    return result.lastInsertId as number;
  }

  async load(id: number): Promise<GeoUrbanProject | null> {
    const db = await this.getDb();
    const rows = await db.select<Array<{ geourban_json: string }>>(
      'SELECT geourban_json FROM projects WHERE id = $1',
      [id],
    );
    if (rows.length === 0) return null;
    return JSON.parse(rows[0].geourban_json) as GeoUrbanProject;
  }

  async list(): Promise<ProjectSummary[]> {
    const db = await this.getDb();
    const rows = await db.select<Array<{ id: number; name: string; updated_at: string; thumbnail: string | null }>>(
      'SELECT id, name, updated_at, thumbnail FROM projects ORDER BY updated_at DESC',
      [],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      updatedAt: r.updated_at,
      thumbnail: r.thumbnail ?? undefined,
    }));
  }

  async delete(id: number): Promise<void> {
    const db = await this.getDb();
    await db.execute('DELETE FROM projects WHERE id = $1', [id]);
  }

  async duplicate(id: number, newName: string): Promise<number> {
    const db = await this.getDb();
    const rows = await db.select<Array<{ geourban_json: string }>>(
      'SELECT geourban_json FROM projects WHERE id = $1',
      [id],
    );
    if (rows.length === 0) throw new Error('Proyecto no encontrado');
    const project = JSON.parse(rows[0].geourban_json) as GeoUrbanProject;
    project.name = newName;
    project.id = undefined;
    return this.save(project);
  }

  async updateThumbnail(id: number, thumbnailDataUrl: string): Promise<void> {
    const db = await this.getDb();
    await db.execute('UPDATE projects SET thumbnail = $1 WHERE id = $2', [thumbnailDataUrl, id]);
  }
}