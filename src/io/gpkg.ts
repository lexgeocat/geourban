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

export async function exportGpkg(project: GeoUrbanProject): Promise<void> {
  const SQL = await getSql();
  const db = new SQL.Database();

  const features = project.data.features;
  if (features.length === 0) {
    db.close();
    throw new Error('No hay features para exportar');
  }

  const srsId = 4326;
  const tableName = 'geourban_features';

  // --- GPKG metadata tables ---
  db.run(`CREATE TABLE gpkg_contents (
    table_name TEXT NOT NULL PRIMARY KEY,
    data_type TEXT NOT NULL,
    identifier TEXT,
    description TEXT,
    last_change DATETIME NOT NULL,
    min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE,
    srs_id INTEGER
  )`);
  db.run(`CREATE TABLE gpkg_geometry_columns (
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    geometry_type_name TEXT NOT NULL,
    srs_id INTEGER NOT NULL,
    z TINYINT NOT NULL,
    m TINYINT NOT NULL,
    UNIQUE (table_name, column_name)
  )`);
  db.run(`CREATE TABLE gpkg_spatial_ref_sys (
    srs_id INTEGER NOT NULL PRIMARY KEY,
    organization TEXT NOT NULL,
    organization_coordsys_id INTEGER NOT NULL,
    definition TEXT NOT NULL,
    description TEXT
  )`);
  db.run(`INSERT INTO gpkg_spatial_ref_sys VALUES (
    4326, 'EPSG', 4326,
    'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',
    'WGS 84 geodetic'
  )`);

  // Detect geometry types present
  const geomTypes = new Set<string>();
  for (const f of features) {
    if (f.geometry) geomTypes.add(f.geometry.type);
  }
  const gpkgGeomType = geomTypes.size === 1
    ? [...geomTypes][0]
    : 'GEOMETRY';

  // --- Feature table ---
  db.run(`CREATE TABLE "${tableName}" (
    fid INTEGER PRIMARY KEY AUTOINCREMENT,
    geom BLOB,
    kind TEXT,
    label TEXT
  )`);
  db.run(`INSERT INTO gpkg_contents VALUES (
    '${tableName}', 'features', 'GeoUrban features', NULL,
    datetime('now'), NULL, NULL, NULL, NULL, ${srsId}
  )`);
  db.run(`INSERT INTO gpkg_geometry_columns VALUES (
    '${tableName}', 'geom', '${gpkgGeomType}', ${srsId}, 0, 0
  )`);

  // --- Insert features ---
  const stmt = db.prepare(`INSERT INTO "${tableName}" (geom, kind, label) VALUES (?, ?, ?)`);
  for (const f of features) {
    if (!f.geometry) continue;
    const gpbuf = geometryToGpkgBlob(f.geometry, srsId);
    stmt.run([gpbuf, f.properties?.kind ?? null, f.properties?.label ?? null]);
  }
  stmt.free();

  // --- Export as download ---
  const rawBuffer: any = db.export();
  const buf = new ArrayBuffer(rawBuffer.length);
  const rawView = new Uint8Array(buf);
  for (let i = 0; i < rawBuffer.length; i++) rawView[i] = rawBuffer[i];
  db.close();

  const blob = new Blob([buf], { type: 'application/geopackage+sqlite3' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.gpkg`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Converts a GeoJSON geometry to a GPKG blob (GP header + WKB). */
function geometryToGpkgBlob(geom: GeoJSONGeometry, srsId: number): Uint8Array {
  const wkb = geometryToWkb(geom);
  const header = new Uint8Array(8 + 4 * 8); // 8 bytes GP header + 4 doubles envelope (minx, maxx, miny, maxy)
  const view = new DataView(header.buffer);
  // GP header
  header[0] = 0x47; // 'G'
  header[1] = 0x50; // 'P'
  header[2] = 0x00; // version
  header[3] = 0x01; // flags: little endian, envelope indicator = 001 (x2) → minx, maxx, miny, maxy
  view.setInt32(4, srsId, true);
  // Envelope: compute bounding box
  const bbox = geomToBbox(geom);
  view.setFloat64(8, bbox[0], true);  // minx
  view.setFloat64(16, bbox[1], true); // maxx
  view.setFloat64(24, bbox[2], true); // miny
  view.setFloat64(32, bbox[3], true); // maxy

  const result = new Uint8Array(header.length + wkb.length);
  result.set(header);
  result.set(wkb, header.length);
  return result;
}

/** Converts a GeoJSON geometry to WKB (little-endian). */
function geometryToWkb(geom: GeoJSONGeometry): Uint8Array {
  const le = true;
  const chunks: Uint8Array[] = [];

  function pushUint8(v: number) { const a = new Uint8Array(1); a[0] = v; chunks.push(a); }
  function pushUint32(v: number) { const a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, v, le); chunks.push(a); }
  function pushFloat64(v: number) { const a = new Uint8Array(8); new DataView(a.buffer).setFloat64(0, v, le); chunks.push(a); }
  function pushCoords2D(coords: [number, number][]) {
    pushUint32(coords.length);
    for (const c of coords) { pushFloat64(c[0]); pushFloat64(c[1]); }
  }

  switch (geom.type) {
    case 'Point': {
      pushUint8(1); pushUint32(1);
      pushFloat64((geom.coordinates as [number, number])[0]);
      pushFloat64((geom.coordinates as [number, number])[1]);
      break;
    }
    case 'LineString': {
      pushUint8(1); pushUint32(2);
      pushCoords2D(geom.coordinates as [number, number][]);
      break;
    }
    case 'Polygon': {
      pushUint8(1); pushUint32(3);
      const rings = geom.coordinates as [number, number][][];
      pushUint32(rings.length);
      for (const ring of rings) pushCoords2D(ring);
      break;
    }
    case 'MultiPoint': {
      pushUint8(1); pushUint32(4);
      const pts = geom.coordinates as [number, number][];
      pushUint32(pts.length);
      for (const p of pts) {
        const ptGeom: GeoJSONGeometry = { type: 'Point', coordinates: p };
        const ptWkb = geometryToWkb(ptGeom);
        chunks.push(ptWkb);
      }
      break;
    }
    case 'MultiLineString': {
      pushUint8(1); pushUint32(5);
      const lines = geom.coordinates as [number, number][][];
      pushUint32(lines.length);
      for (const line of lines) {
        const lsGeom: GeoJSONGeometry = { type: 'LineString', coordinates: line };
        const lsWkb = geometryToWkb(lsGeom);
        chunks.push(lsWkb);
      }
      break;
    }
    case 'MultiPolygon': {
      pushUint8(1); pushUint32(6);
      const polys = geom.coordinates as [number, number][][][];
      pushUint32(polys.length);
      for (const poly of polys) {
        const polyGeom: GeoJSONGeometry = { type: 'Polygon', coordinates: poly };
        const polyWkb = geometryToWkb(polyGeom);
        chunks.push(polyWkb);
      }
      break;
    }
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return result;
}

/** Computes [minx, maxx, miny, maxy] bounding box from a GeoJSON geometry. */
function geomToBbox(geom: GeoJSONGeometry): [number, number, number, number] {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  function processCoord(c: number[]) {
    if (c[0] < minx) minx = c[0];
    if (c[0] > maxx) maxx = c[0];
    if (c[1] < miny) miny = c[1];
    if (c[1] > maxy) maxy = c[1];
  }
  function processCoords(coords: number[][]) { for (const c of coords) processCoord(c); }
  function processRings(rings: number[][][]) { for (const r of rings) processCoords(r); }

  switch (geom.type) {
    case 'Point': processCoord(geom.coordinates as number[]); break;
    case 'LineString': processCoords(geom.coordinates as number[][]); break;
    case 'Polygon': processRings(geom.coordinates as number[][][]); break;
    case 'MultiPoint': processCoords(geom.coordinates as number[][]); break;
    case 'MultiLineString': for (const l of geom.coordinates as number[][][]) processCoords(l); break;
    case 'MultiPolygon': for (const p of geom.coordinates as number[][][][]) processRings(p); break;
  }
  if (!isFinite(minx)) return [0, 0, 0, 0];
  return [minx, maxx, miny, maxy];
}