import initSqlJs, { type Database } from 'sql.js';
import type { Feature as GeoJSONFeature, Geometry as GeoJSONGeometry } from 'geojson';
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

  const features: GeoJSONFeature[] = [];
  let skipped = 0;
  for (const row of rows[0].values) {
    const feature = parseGpkgGeometry(row[0] as Uint8Array);
    if (feature) features.push(feature);
    else skipped++;
  }

  if (skipped > 0) {
    warnings.push(
      `${skipped} de ${rows[0].values.length} geometrías no se pudieron leer (formato binario no soportado).`
    );
  }
  if (features.length === 0) {
    throw new Error(
      `No se pudo leer ninguna geometría de la capa "${layer.table}" (parser WKB falló para todas).`
    );
  }

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

/* ================================================================
   Parser real de geometrías GeoPackage (header GPKG + WKB estándar).
   Antes esto era un stub: `return null` para toda fila -> importar
   un GPKG daba `features: []` sin ningún error visible.
   Formato: magic "GP" (2 bytes) + version (1) + flags (1) + srs_id
   (4) [+ envelope opcional según flags] + WKB (ISO estándar).
   ================================================================ */

function parseGpkgGeometry(blob: Uint8Array | null | undefined): GeoJSONFeature | null {
  if (!blob || blob.length < 8) return null;
  if (blob[0] !== 0x47 || blob[1] !== 0x50) return null; // 'G' 'P'

  const flags = blob[3];
  const envelopeIndicator = (flags >> 1) & 0x07;
  const isEmpty = (flags >> 4) & 0x01;
  if (isEmpty) return null;

  // Bytes de envelope según el indicador (spec OGC GeoPackage, tabla
  // "envelope contents indicator code"): 0,1,2,3,4 -> 0,4,6,6,8 doubles.
  const envelopeDoubles = [0, 4, 6, 6, 8][envelopeIndicator] ?? 0;
  const wkbOffset = 8 + envelopeDoubles * 8;
  if (blob.length <= wkbOffset) return null;

  try {
    const geometry = parseWkbGeometry(blob, wkbOffset);
    if (!geometry) return null;
    return { type: 'Feature', properties: {}, geometry };
  } catch {
    return null;
  }
}

function parseWkbGeometry(bytes: Uint8Array, offset: number): GeoJSONGeometry | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = offset;

  const readByte = () => view.getUint8(pos++);
  const readUint32 = (le: boolean) => {
    const v = view.getUint32(pos, le);
    pos += 4;
    return v;
  };
  const readDouble = (le: boolean) => {
    const v = view.getFloat64(pos, le);
    pos += 8;
    return v;
  };

  function readGeometry(): GeoJSONGeometry | null {
    const byteOrder = readByte();
    const le = byteOrder === 1;
    const rawType = readUint32(le);
    // Algunos exports agregan flags Z/M (1001, 2001...); nos quedamos
    // con el tipo base 1-7.
    const type = rawType % 1000;

    switch (type) {
      case 1: {
        const x = readDouble(le);
        const y = readDouble(le);
        return { type: 'Point', coordinates: [x, y] };
      }
      case 2: {
        const n = readUint32(le);
        const coords: [number, number][] = [];
        for (let i = 0; i < n; i++) coords.push([readDouble(le), readDouble(le)]);
        return { type: 'LineString', coordinates: coords };
      }
      case 3: {
        const numRings = readUint32(le);
        const rings: [number, number][][] = [];
        for (let r = 0; r < numRings; r++) {
          const n = readUint32(le);
          const ring: [number, number][] = [];
          for (let i = 0; i < n; i++) ring.push([readDouble(le), readDouble(le)]);
          rings.push(ring);
        }
        return { type: 'Polygon', coordinates: rings };
      }
      case 4: {
        const n = readUint32(le);
        const points: [number, number][] = [];
        for (let i = 0; i < n; i++) {
          const g = readGeometry();
          if (g?.type === 'Point') points.push(g.coordinates as [number, number]);
        }
        return { type: 'MultiPoint', coordinates: points };
      }
      case 5: {
        const n = readUint32(le);
        const lines: [number, number][][] = [];
        for (let i = 0; i < n; i++) {
          const g = readGeometry();
          if (g?.type === 'LineString') lines.push(g.coordinates as [number, number][]);
        }
        return { type: 'MultiLineString', coordinates: lines };
      }
      case 6: {
        const n = readUint32(le);
        const polys: [number, number][][][] = [];
        for (let i = 0; i < n; i++) {
          const g = readGeometry();
          if (g?.type === 'Polygon') polys.push(g.coordinates as [number, number][][]);
        }
        return { type: 'MultiPolygon', coordinates: polys };
      }
      default:
        return null;
    }
  }

  return readGeometry();
}

export async function exportGpkg(_project: GeoUrbanProject): Promise<never> {
  throw new Error('Exportación GPKG pendiente de implementación completa (Fase 6)');
}