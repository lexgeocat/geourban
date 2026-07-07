import initSqlJs, { type Database } from 'sql.js';
import { createEmptyProject, type GeoUrbanProject, type ImportResult } from './types';

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;

async function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({
      locateFile: (file) => `https://sql.js.org/dist/${file}`,
    });
  }
  return sqlPromise;
}

export async function importGpkg(file: File): Promise<ImportResult> {
  const SQL = await getSql();
  const buffer = new Uint8Array(await file.arrayBuffer());
  const db = new SQL.Database(buffer);

  const layers = listVectorLayers(db);
  if (layers.length === 0) {
    db.close();
    throw new Error('GPKG sin capas vectoriales legibles');
  }

  const warnings: string[] = [];
  if (layers.length > 1) {
    warnings.push(`Se detectaron ${layers.length} capas; se importará "${layers[0].table}".`);
  }

  const layer = layers[0];
  const rows = db.exec(`SELECT data FROM "${layer.table}"`);
  db.close();

  if (!rows[0]?.values?.length) {
    throw new Error(`La capa "${layer.table}" no tiene geometrías`);
  }

  const features = rows[0].values
    .map((row) => parseGpkgGeometry(row[0] as Uint8Array))
    .filter(Boolean);

  const project = createEmptyProject(file.name.replace(/\.gpkg$/i, ''));
  project.data = { type: 'FeatureCollection', features: features as never[] };

  return { project, warnings };
}

type GpkgLayer = { table: string; geometryType: string };

function listVectorLayers(db: Database): GpkgLayer[] {
  const result = db.exec(`
    SELECT table_name, data_type
    FROM gpkg_contents
    WHERE data_type = 'features'
    ORDER BY table_name
  `);
  if (!result[0]) return [];
  return result[0].values.map((row) => ({
    table: String(row[0]),
    geometryType: String(row[1] ?? 'unknown'),
  }));
}

function parseGpkgGeometry(_blob: Uint8Array) {
  // GeoPackage almacena geometrías en formato GPKG binario (WKB con header).
  // MVP: stub — requiere parser binario completo en fase 6 extendida.
  return null;
}

export async function exportGpkg(_project: GeoUrbanProject): Promise<never> {
  throw new Error('Exportación GPKG pendiente de implementación completa (Fase 6)');
}
