import KML from 'ol/format/KML.js';
import JSZip from 'jszip';
import GeoJSON from 'ol/format/GeoJSON.js';
import { createEmptyProject, type GeoUrbanProject, type ImportResult } from './types';

const kmlFormat = new KML({ extractStyles: false });
const geoJsonFormat = new GeoJSON();

function featuresToProject(features: unknown[], name: string): GeoUrbanProject {
  const project = createEmptyProject(name);
  project.data = geoJsonFormat.writeFeaturesObject(features as never, {
    featureProjection: 'EPSG:3857',
    dataProjection: 'EPSG:4326',
  }) as GeoUrbanProject['data'];
  return project;
}

export async function importKml(file: File): Promise<ImportResult> {
  const text = await file.text();
  const features = kmlFormat.readFeatures(text, {
    featureProjection: 'EPSG:3857',
    dataProjection: 'EPSG:4326',
  });
  return {
    project: featuresToProject(features, file.name.replace(/\.kml$/i, '')),
    warnings: [],
  };
}

export async function importKmz(file: File): Promise<ImportResult> {
  const buffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  const kmlEntry = Object.values(zip.files).find((entry) =>
    entry.name.toLowerCase().endsWith('.kml')
  );
  if (!kmlEntry) throw new Error('KMZ inválido: no se encontró archivo .kml');
  const text = await kmlEntry.async('text');
  const features = kmlFormat.readFeatures(text, {
    featureProjection: 'EPSG:3857',
    dataProjection: 'EPSG:4326',
  });
  return {
    project: featuresToProject(features, file.name.replace(/\.kmz$/i, '')),
    warnings: [],
  };
}

export function exportKml(project: GeoUrbanProject): string {
  const features = geoJsonFormat.readFeatures(project.data, {
    featureProjection: 'EPSG:3857',
    dataProjection: 'EPSG:4326',
  });
  return kmlFormat.writeFeatures(features as never, {
    featureProjection: 'EPSG:3857',
    dataProjection: 'EPSG:4326',
  });
}

export async function exportKmz(project: GeoUrbanProject): Promise<Blob> {
  const kml = exportKml(project);
  const zip = new JSZip();
  zip.file('doc.kml', kml);
  return zip.generateAsync({ type: 'blob' });
}
