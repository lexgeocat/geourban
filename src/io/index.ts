import type { ImportFormat, ExportFormat, ImportResult, GeoUrbanProject } from './types';
import { parseGeoUrbanJson, parseGeoJson, serializeGeoUrbanProject, downloadTextFile } from './geojson';
import { importKml, importKmz, exportKml, exportKmz } from './kml';
import { importShp, exportShp } from './shp';
import { importGpkg } from './gpkg';
import { importDxf, exportDxf } from './dxf';

export * from './types';
export * from './geojson';
export * from './kml';
export * from './shp';
export * from './gpkg';
export * from './dxf';
export * from './persistence';

export async function importFile(file: File, format?: ImportFormat): Promise<ImportResult> {
  const ext = format ?? inferFormat(file.name);
  switch (ext) {
    case 'geourban':
      return { project: parseGeoUrbanJson(await file.text()), warnings: [] };
    case 'geojson':
      return { project: parseGeoJson(await file.text(), file.name), warnings: [] };
    case 'kml':
      return importKml(file);
    case 'kmz':
      return importKmz(file);
    case 'shp':
      return importShp([file]);
    case 'gpkg':
      return importGpkg(file);
    case 'dxf':
      return importDxf(file);
    default:
      throw new Error(`Formato no soportado: ${ext}`);
  }
}

export async function exportProject(project: GeoUrbanProject, format: ExportFormat, filename: string) {
  switch (format) {
    case 'geourban':
      downloadTextFile(`${filename}.geourban`, serializeGeoUrbanProject(project));
      break;
    case 'geojson':
      downloadTextFile(`${filename}.geojson`, JSON.stringify(project.data, null, 2));
      break;
    case 'kml':
      downloadTextFile(`${filename}.kml`, exportKml(project), 'application/vnd.google-earth.kml+xml');
      break;
    case 'kmz': {
      const blob = await exportKmz(project);
      downloadBlob(`${filename}.kmz`, blob);
      break;
    }
    case 'shp': {
      const { shp, dbf, prj } = exportShp(project);
      downloadBlob(`${filename}.shp`, shp);
      downloadBlob(`${filename}.dbf`, dbf);
      downloadBlob(`${filename}.prj`, prj);
      break;
    }
    case 'dxf':
      downloadTextFile(`${filename}.dxf`, exportDxf(project), 'application/dxf');
      break;
    case 'gpkg':
      throw new Error('Exportación GPKG aún no implementada');
    default:
      throw new Error(`Formato de exportación no soportado: ${format}`);
  }
}

function inferFormat(filename: string): ImportFormat {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map: Record<string, ImportFormat> = {
    geourban: 'geourban',
    json: 'geojson',
    geojson: 'geojson',
    kml: 'kml',
    kmz: 'kmz',
    shp: 'shp',
    gpkg: 'gpkg',
    dxf: 'dxf',
  };
  const fmt = ext ? map[ext] : undefined;
  if (!fmt) throw new Error(`No se pudo inferir formato para "${filename}"`);
  return fmt;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
