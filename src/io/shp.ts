import shp from 'shpjs';
// @ts-expect-error shp-write no tiene tipos completos
import shpwrite from 'shp-write';
import { createEmptyProject, type GeoUrbanProject, type ImportResult } from './types';

export async function importShp(files: FileList | File[]): Promise<ImportResult> {
  const list = Array.from(files);
  const shpFile = list.find((f) => f.name.toLowerCase().endsWith('.shp'));
  if (!shpFile) throw new Error('Se requiere al menos un archivo .shp');

  const buffer = await shpFile.arrayBuffer();
  const parsed = await shp(buffer);
  const collection = Array.isArray(parsed) ? parsed[0] : parsed;

  const project = createEmptyProject(shpFile.name.replace(/\.shp$/i, ''));
  project.data = collection as GeoUrbanProject['data'];

  const warnings: string[] = [];
  if (!list.some((f) => f.name.toLowerCase().endsWith('.dbf'))) {
    warnings.push('No se encontró .dbf; los atributos pueden estar incompletos.');
  }

  return { project, warnings };
}

export function exportShp(project: GeoUrbanProject): { shp: Blob; dbf: Blob; prj: Blob } {
  const collection = project.data;
  const options = { types: inferShpTypes(collection) };
  const result = shpwrite.zip(collection, options) as Record<string, string>;
  const layerName =
    Object.keys(result)
      .find((k) => k.endsWith('.shp'))
      ?.replace('.shp', '') ?? 'layer';

  return {
    shp: base64ToBlob(result[`${layerName}.shp`], 'application/octet-stream'),
    dbf: base64ToBlob(result[`${layerName}.dbf`], 'application/octet-stream'),
    prj: base64ToBlob(result[`${layerName}.prj`] ?? '', 'text/plain'),
  };
}

function inferShpTypes(collection: GeoUrbanProject['data']) {
  const types = new Set(collection.features.map((f) => f.geometry?.type));
  if (types.has('Polygon') || types.has('MultiPolygon')) return { polygon: 'layer' };
  if (types.has('LineString') || types.has('MultiLineString')) return { polyline: 'layer' };
  return { point: 'layer' };
}

function base64ToBlob(base64: string, mime: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}


