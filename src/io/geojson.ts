import GeoJSON from 'ol/format/GeoJSON.js';
import type { FeatureCollection } from 'geojson';
import { createEmptyProject, type GeoUrbanProject } from './types';

const geoJsonFormat = new GeoJSON();

export function parseGeoUrbanJson(raw: string): GeoUrbanProject {
  const parsed = JSON.parse(raw) as Partial<GeoUrbanProject> & { data?: FeatureCollection };
  if (!parsed.data || parsed.data.type !== 'FeatureCollection') {
    throw new Error('Archivo .geourban inválido: falta FeatureCollection en data');
  }
  const base = createEmptyProject(parsed.name ?? 'Proyecto importado');
  return {
    ...base,
    ...parsed,
    version: '1.0',
    data: parsed.data,
    updatedAt: new Date().toISOString(),
  };
}

export function serializeGeoUrbanProject(project: GeoUrbanProject): string {
  return JSON.stringify(
    {
      ...project,
      updatedAt: new Date().toISOString(),
    },
    null,
    2
  );
}

export function parseGeoJson(raw: string, name?: string): GeoUrbanProject {
  const data = JSON.parse(raw) as FeatureCollection;
  if (data.type !== 'FeatureCollection') {
    throw new Error('GeoJSON inválido: se esperaba FeatureCollection');
  }
  const project = createEmptyProject(name ?? 'GeoJSON importado');
  project.data = data;
  return project;
}

export function featuresToGeoJson(features: FeatureCollection): string {
  return JSON.stringify(features, null, 2);
}

export function readOlFeaturesFromProject(project: GeoUrbanProject) {
  return geoJsonFormat.readFeatures(project.data, {
    featureProjection: 'EPSG:3857',
    dataProjection: 'EPSG:4326',
  });
}

export function writeProjectFromOlFeatures(features: unknown[]): GeoUrbanProject {
  const project = createEmptyProject();
  project.data = geoJsonFormat.writeFeaturesObject(features as never, {
    featureProjection: 'EPSG:3857',
    dataProjection: 'EPSG:4326',
  }) as FeatureCollection;
  return project;
}

export function downloadTextFile(filename: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readFileAsText(file: File) {
  return file.text();
}

export async function readFileAsArrayBuffer(file: File) {
  return file.arrayBuffer();
}
