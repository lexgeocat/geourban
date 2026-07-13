import initSqlJs, { type Database } from 'sql.js';
import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';
import type { Feature as GeoJSONFeature, FeatureCollection, Geometry as GeoJSONGeometry } from 'geojson';
import { createEmptyProject, type GeoUrbanProject, type ImportResult } from './types';
import { ensureUtmZoneRegistered } from '../geo/utmZones';
import { reprojectFeatureCollection } from '../geo/crsTransform';

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;

async function getSql() {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: (file) => `https://sql.js.org/dist/${file}` });
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

  if (!rows[0]?.values?.length) {
    db.close();
    throw new Error(`La capa "${layer.table}" no tiene geometrías`);
  }

  const features: GeoJSONFeature[] = [];
  let skipped = 0;
  let detectedSrsId: number | null = null;

  for (const row of rows[0].values) {
    const parsed = parseGpkgGeometry(row[0] as Uint8Array);
    if (parsed) {
      features.push(parsed.feature);
      if (detectedSrsId === null) detectedSrsId = parsed.srsId;
    } else {
      skipped++;
    }
  }

  // Leer gpkg_spatial_ref_sys ANTES de cerrar la DB. GPKG casi nunca viene
  // en WGS84 puro (lo usual es UTM); asumirlo a ciegas produce el mismo
  // bug de "chiquito y en otro lugar" que afectaba a DXF.
  const srsTable = detectedSrsId !== null ? loadSrsTable(db) : null;
  db.close();

  if (skipped > 0) {
    warnings.push(`${skipped} de ${rows[0].values.length} geometrías no se pudieron leer (formato binario no soportado).`);
  }
  if (features.length === 0) {
    throw new Error(`No se pudo leer ninguna geometría de la capa "${layer.table}" (parser WKB falló para todas).`);
  }

  let collection: FeatureCollection = { type: 'FeatureCollection', features: features as never[] };

  if (detectedSrsId !== null && detectedSrsId > 0 && detectedSrsId !== 4326 && srsTable) {
    const projCode = resolveProjCode(srsTable.get(detectedSrsId) ?? null);
    if (projCode) {
      collection = reprojectFeatureCollection(collection, projCode, 'EPSG:4326');
    } else {
      warnings.push(
        `No se pudo resolver el CRS (srs_id=${detectedSrsId}); las coordenadas se importaron sin reproyectar y pueden estar desplazadas o con escala incorrecta.`
      );
    }
  }

  const project = createEmptyProject(file.name.replace(/\.gpkg$/i, ''));
  project.data = collection;
  return { project, warnings };
}

type GpkgLayer = { table: string; geometryType: string };

function listVectorLayers(db: Database): GpkgLayer[] {
  const result = db.exec(`
    SELECT table_name, data_type FROM gpkg_contents
    WHERE data_type = 'features' ORDER BY table_name
  `);
  if (!result[0]) return [];
  return result[0].values.map((row) => ({ table: String(row[0]), geometryType: String(row[1] ?? 'unknown') }));
}

type SrsInfo = { organization: string; orgCoordsysId: number; definition: string };

function loadSrsTable(db: Database): Map<number, SrsInfo> {
  const map = new Map<number, SrsInfo>();
  try {
    const result = db.exec(`SELECT srs_id, organization, organization_coordsys_id, definition FROM gpkg_spatial_ref_sys`);
    if (!result[0]) return map;
    for (const row of result[0].values) {
      map.set(Number(row[0]), {
        organization: String(row[1] ?? ''),
        orgCoordsysId: Number(row[2] ?? 0),
        definition: String(row[3] ?? ''),
      });
    }
  } catch {
    /* tabla ausente/no estándar: se deja vacío, se avisa al caller */
  }
  return map;
}

/** Resuelve srs_id -> código usable por ol/proj. Cubre EPSG genérico y, en especial, zonas UTM WGS84. */
function resolveProjCode(srs: SrsInfo | null): string | null {
  if (!srs || srs.organization.toUpperCase() !== 'EPSG') return null;
  if (srs.orgCoordsysId === 4326) return 'EPSG:4326';
  if (srs.orgCoordsysId >= 32601 && srs.orgCoordsysId <= 32660) return ensureUtmZoneRegistered(srs.orgCoordsysId - 32600, 'N');
  if (srs.orgCoordsysId >= 32701 && srs.orgCoordsysId <= 32760) return ensureUtmZoneRegistered(srs.orgCoordsysId - 32700, 'S');
  if (srs.definition) {
    const code = `EPSG:${srs.orgCoordsysId}`;
    try {
      proj4.defs(code, srs.definition); // proj4js parsea WKT1 GEOGCS/PROJCS directamente
      register(proj4);
      return code;
    } catch {
      return null;
    }
  }
  return null;
}

/* Parser WKB/GPKG sin cambios de formato, ahora también extrae srs_id del header. */
function parseGpkgGeometry(blob: Uint8Array | null | undefined): { feature: GeoJSONFeature; srsId: number } | null {
  if (!blob || blob.length < 8) return null;
  if (blob[0] !== 0x47 || blob[1] !== 0x50) return null;

  const flags = blob[3];
  const littleEndian = (flags & 0x01) === 1;
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const srsId = view.getInt32(4, littleEndian);

  const envelopeIndicator = (flags >> 1) & 0x07;
  const isEmpty = (flags >> 4) & 0x01;
  if (isEmpty) return null;

  const envelopeDoubles = [0, 4, 6, 6, 8][envelopeIndicator] ?? 0;
  const wkbOffset = 8 + envelopeDoubles * 8;
  if (blob.length <= wkbOffset) return null;

  try {
    const geometry = parseWkbGeometry(blob, wkbOffset);
    if (!geometry) return null;
    return { feature: { type: 'Feature', properties: {}, geometry }, srsId };
  } catch {
    return null;
  }
}

function parseWkbGeometry(bytes: Uint8Array, offset: number): GeoJSONGeometry | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = offset;
  const readByte = () => view.getUint8(pos++);
  const readUint32 = (le: boolean) => { const v = view.getUint32(pos, le); pos += 4; return v; };
  const readDouble = (le: boolean) => { const v = view.getFloat64(pos, le); pos += 8; return v; };

  function readGeometry(): GeoJSONGeometry | null {
    const byteOrder = readByte();
    const le = byteOrder === 1;
    const rawType = readUint32(le);
    const type = rawType % 1000;
    switch (type) {
      case 1: return { type: 'Point', coordinates: [readDouble(le), readDouble(le)] };
      case 2: {
        const n = readUint32(le); const coords: [number, number][] = [];
        for (let i = 0; i < n; i++) coords.push([readDouble(le), readDouble(le)]);
        return { type: 'LineString', coordinates: coords };
      }
      case 3: {
        const numRings = readUint32(le); const rings: [number, number][][] = [];
        for (let r = 0; r < numRings; r++) {
          const n = readUint32(le); const ring: [number, number][] = [];
          for (let i = 0; i < n; i++) ring.push([readDouble(le), readDouble(le)]);
          rings.push(ring);
        }
        return { type: 'Polygon', coordinates: rings };
      }
      case 4: {
        const n = readUint32(le); const points: [number, number][] = [];
        for (let i = 0; i < n; i++) { const g = readGeometry(); if (g?.type === 'Point') points.push(g.coordinates as [number, number]); }
        return { type: 'MultiPoint', coordinates: points };
      }
      case 5: {
        const n = readUint32(le); const lines: [number, number][][] = [];
        for (let i = 0; i < n; i++) { const g = readGeometry(); if (g?.type === 'LineString') lines.push(g.coordinates as [number, number][]); }
        return { type: 'MultiLineString', coordinates: lines };
      }
      case 6: {
        const n = readUint32(le); const polys: [number, number][][][] = [];
        for (let i = 0; i < n; i++) { const g = readGeometry(); if (g?.type === 'Polygon') polys.push(g.coordinates as [number, number][][]); }
        return { type: 'MultiPolygon', coordinates: polys };
      }
      default: return null;
    }
  }
  return readGeometry();
}

export async function exportGpkg(_project: GeoUrbanProject): Promise<never> {
  throw new Error('Exportación GPKG pendiente de implementación completa (Fase 6)');
}