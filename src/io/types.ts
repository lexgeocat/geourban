import type { FeatureCollection } from 'geojson';
import type { BaseMapId } from '../map/baseMaps';
import type { ProjectCrsConfig } from '../geo/crs/utmZones';
import type { Layer } from '../core/objectModel';

export type GeoUrbanLayerMeta = Layer;

export type GeoUrbanProject = {
  version: '1.0';
  name: string;
  createdAt: string;
  updatedAt: string;
  baseMap: BaseMapId;
  layers: Layer[];
  activeLayerId: string | null;
  view: { center: [number, number]; zoom: number };
  crs: ProjectCrsConfig;
  data: FeatureCollection;
  id?: number;
};

export type ImportFormat = 'geourban' | 'geojson' | 'kml' | 'kmz' | 'shp' | 'gpkg' | 'dxf';
export type ExportFormat = ImportFormat | 'png' | 'svg';

export type ImportResult = { project: GeoUrbanProject; warnings: string[] };

export function createEmptyProject(name = 'Sin título'): GeoUrbanProject {
  const now = new Date().toISOString();
  return {
    version: '1.0',
    name,
    createdAt: now,
    updatedAt: now,
    baseMap: 'osm',
    layers: [],
    activeLayerId: null,
    view: { center: [-68.3, -16.65], zoom: 19 },
    crs: { mode: 'utm', utmZone: 19, utmHemisphere: 'S' },
    data: { type: 'FeatureCollection', features: [] },
  };
}