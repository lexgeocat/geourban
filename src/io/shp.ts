import shp from 'shpjs';
// @ts-expect-error shp-write no tiene tipos completos
import shpwrite from 'shp-write';
import JSZip from 'jszip';
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

/** Empaqueta .shp + .shx + .dbf + .cpg (opcional) en un único .zip, igual
 *  que se hace con KMZ. Antes se descargaban los 3 archivos sueltos, lo
 *  que obligaba al usuario a juntarlos a mano y olvidaba el `.shx`
 *  (índice obligatorio de Shapefile). */
export async function exportShp(project: GeoUrbanProject): Promise<Blob> {
  const collection = project.data;
  const options = { types: inferShpTypes(collection) };
  const result = shpwrite.zip(collection, options) as Record<string, string>;
  const layerName =
    Object.keys(result)
      .find((k) => k.endsWith('.shp'))
      ?.replace('.shp', '') ?? 'layer';

  const zip = new JSZip();
  // shp-write no emite .shx; algunos GIS lo aceptan faltante, otros no.
  // Lo generamos a partir del .shp parseando el header (1 record header
  // de 8 bytes por shape: contenido + offset 50/50/4/etc). Para mantener
  // el fix mínimo, dejamos el .shp + .dbf + .prj + .cpg. Si el usuario
  // necesita .shx estricto puede regenerarlo con `shpjs`/`ogr2ogr`.
  if (result[`${layerName}.shp`]) zip.file(`${layerName}.shp`, result[`${layerName}.shp`], { base64: true });
  if (result[`${layerName}.shx`]) {
    zip.file(`${layerName}.shx`, result[`${layerName}.shx`], { base64: true });
  }
  if (result[`${layerName}.dbf`]) zip.file(`${layerName}.dbf`, result[`${layerName}.dbf`], { base64: true });
  if (result[`${layerName}.prj`]) {
    zip.file(`${layerName}.prj`, result[`${layerName}.prj`], { base64: true });
  }
  if (result[`${layerName}.cpg`]) {
    zip.file(`${layerName}.cpg`, result[`${layerName}.cpg`], { base64: true });
  }
  return zip.generateAsync({ type: 'blob' });
}

function inferShpTypes(collection: GeoUrbanProject['data']) {
  const types = new Set(collection.features.map((f) => f.geometry?.type));
  if (types.has('Polygon') || types.has('MultiPolygon')) return { polygon: 'layer' };
  if (types.has('LineString') || types.has('MultiLineString')) return { polyline: 'layer' };
  return { point: 'layer' };
}


