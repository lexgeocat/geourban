import type { FeatureCollection } from 'geojson';

export type GeoUrbanLayerMeta = {
  id: string;
  name: string;
  visible: boolean;
  type: 'polygon' | 'line' | 'mixed';
};

export type GeoUrbanProject = {
  version: '1.0';
  name: string;
  createdAt: string;
  updatedAt: string;
  baseMap: 'osm' | 'cad' | 'google-satellite';
  layers: GeoUrbanLayerMeta[];
  view: {
    center: [number, number];
    zoom: number;
  };
  data: FeatureCollection;
};

export type ImportFormat = 'geourban' | 'geojson' | 'kml' | 'kmz' | 'shp' | 'gpkg' | 'dxf';
export type ExportFormat = ImportFormat;

export type ImportResult = {
  project: GeoUrbanProject;
  warnings: string[];
};

export function createEmptyProject(name = 'Sin título'): GeoUrbanProject {
  const now = new Date().toISOString();
  return {
    version: '1.0',
    name,
    createdAt: now,
    updatedAt: now,
    baseMap: 'osm',
    layers: [{ id: 'draw', name: 'Dibujo', visible: true, type: 'mixed' }],
    view: { center: [-68.3, -16.65], zoom: 17 },
    data: { type: 'FeatureCollection', features: [] },
  };
}
