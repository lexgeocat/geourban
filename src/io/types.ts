import type { FeatureCollection } from 'geojson';
import type { BaseMapId } from '../map/baseMaps';
import type { ProjectCrsConfig } from '../geo/crs/utmZones';
import { DEFAULT_LAYERS, type Layer } from '../core/objectModel';

/** Fase 2 (persistencia/integridad de capas): antes este tipo era una
 *  forma reducida ({id,name,visible,type}) que ni remotamente coincidía
 *  con `Layer` (core/objectModel.ts) — le faltaban color/fillColor/
 *  opacity/locked/showLabel/showCota/zIndex/kind, así que nada de eso se
 *  serializaba nunca al guardar un proyecto. Ahora reutiliza `Layer`
 *  directamente: 1:1 con lo que vive en `layersRegistryStore`. */
export type GeoUrbanLayerMeta = Layer;

export type GeoUrbanProject = {
  version: '1.0';
  name: string;
  createdAt: string;
  updatedAt: string;
  baseMap: BaseMapId;
  layers: Layer[];
  /** Capa activa (features nuevas se asignan acá) — Fase 2. */
  activeLayerId: string | null;
  view: { center: [number, number]; zoom: number };
  crs: ProjectCrsConfig;
  data: FeatureCollection;
  // Optional: used by desktop SQLite storage for project identity
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
    layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
    activeLayerId: null,
    view: { center: [-68.3, -16.65], zoom: 19 },
    crs: { mode: 'utm', utmZone: 19, utmHemisphere: 'S' },
    data: { type: 'FeatureCollection', features: [] },
  };
}