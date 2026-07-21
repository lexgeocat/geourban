import type { ImportFormat, ExportFormat, ImportResult, GeoUrbanProject } from './types';
import type { Feature as GeoJSONFeature, FeatureCollection, Geometry as GeoJSONGeometry, LineString, Point, Polygon } from 'geojson';
import {
  parseGeoUrbanJson,
  parseGeoJson,
  serializeGeoUrbanProject,
  downloadTextFile,
} from './geojson';
import { importKml, importKmz, exportKml, exportKmz } from './kml';
import { importShp, exportShp } from './shp';
import { importGpkg, exportGpkg } from './gpkg';
import { importDxf, exportDxf } from './dxf';

export * from './types';
export * from './geojson';
export * from './kml';
export * from './shp';
export * from './gpkg';
export * from './dxf';
export * from './persistence';

// Desktop-only exports
export { autosaveProjectDesktop, listProjectsDesktop, loadProjectDesktop, deleteProjectDesktop, duplicateProjectDesktop, updateProjectThumbnail, isTauri } from './persistenceDesktop';

export async function importFile(file: File, format?: ImportFormat): Promise<ImportResult> {
  const ext = format ?? inferFormat(file.name);
  switch (ext) {
    case 'geourban': return { project: parseGeoUrbanJson(await file.text()), warnings: [] };
    case 'geojson':  return { project: parseGeoJson(await file.text(), file.name), warnings: [] };
    case 'kml':  return importKml(file);
    case 'kmz':  return importKmz(file);
    case 'shp':  return importShp([file]);
    case 'gpkg': return importGpkg(file);
    case 'dxf':  return importDxf(file); // ya no recibe options — el CRS sale del store
    default: throw new Error(`Formato no soportado: ${ext}`);
  }
}

export async function exportProject(
  project: GeoUrbanProject,
  format: ExportFormat,
  filename: string
): Promise<{ message?: string } | void> {
  switch (format) {
    case 'geourban':
      downloadTextFile(`${filename}.geourban`, serializeGeoUrbanProject(project));
      break;
    case 'geojson':
      downloadTextFile(`${filename}.geojson`, JSON.stringify(project.data, null, 2));
      break;
    case 'kml':
      downloadTextFile(
        `${filename}.kml`,
        exportKml(project),
        'application/vnd.google-earth.kml+xml'
      );
      break;
    case 'kmz': {
      const blob = await exportKmz(project);
      downloadBlob(`${filename}.kmz`, blob);
      break;
    }
    case 'shp': {
      const zipBlob = await exportShp(project);
      downloadBlob(`${filename}.zip`, zipBlob);
      return { message: 'Se exportó un .zip con .shp, .shx (si está disponible), .dbf y .prj.' };
    }
    case 'dxf': {
      const { dxfText, prjWkt, instructions } = exportDxf(project);
      downloadTextFile(`${filename}.dxf`, dxfText, 'application/dxf');
      if (prjWkt) downloadTextFile(`${filename}.prj`, prjWkt, 'text/plain');
      return { message: instructions };
    }
    case 'png':
      throw new Error('Exportación PNG debe manejarse directamente desde la UI (requiere acceso al canvas del mapa)');
      break;
    case 'svg': {
      const svgContent = exportSvg(project);
      downloadTextFile(`${filename}.svg`, svgContent, 'image/svg+xml');
      break;
    }
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

function exportSvg(project: GeoUrbanProject): string {
  const collection = project.data;
  const paths: string[] = [];

  for (const feature of collection.features) {
    const geom = feature.geometry;
    if (!geom) continue;

    if (geom.type === 'LineString') {
      const coords = geom.coordinates.map((c) => `${c[0]},${c[1]}`).join(' ');
      paths.push(`<polyline points="${coords}" fill="none" stroke="black" stroke-width="0.5" />`);
    } else if (geom.type === 'Polygon') {
      const rings = geom.coordinates;
      for (const ring of rings) {
        const coords = ring.map((c) => `${c[0]},${c[1]}`).join(' ');
        paths.push(`<polygon points="${coords}" fill="none" stroke="black" stroke-width="0.5" />`);
      }
    } else if (geom.type === 'Point') {
      const [x, y] = geom.coordinates;
      paths.push(`<circle cx="${x}" cy="${y}" r="1" fill="black" />`);
    }
  }

  const bounds = getFeatureCollectionBounds(collection);
  const width = bounds ? bounds.maxX - bounds.minX : 800;
  const height = bounds ? bounds.maxY - bounds.minY : 600;
  const viewBox = bounds ? `${bounds.minX} ${bounds.minY} ${width} ${height}` : '0 0 800 600';

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">
      <g transform="translate(0,${height}) scale(1,-1)">
        ${paths.join('\n        ')}
      </g>
    </svg>
  `;
}

function getFeatureCollectionBounds(collection: FeatureCollection): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let hasBounds = false;

  for (const feature of collection.features) {
    const geom = feature.geometry;
    if (!geom) continue;

    function processCoord(c: number[]) {
      if (c[0] < minX) minX = c[0];
      if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1];
      if (c[1] > maxY) maxY = c[1];
      hasBounds = true;
    }

    if (geom.type === 'Point') {
      processCoord(geom.coordinates as number[]);
    } else if (geom.type === 'LineString') {
      for (const c of geom.coordinates) processCoord(c as number[]);
    } else if (geom.type === 'Polygon') {
      for (const ring of geom.coordinates) for (const c of ring) processCoord(c as number[]);
    }
  }

  if (!hasBounds) return null;
  return { minX, minY, maxX, maxY };
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}