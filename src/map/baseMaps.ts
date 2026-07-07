import TileLayer from 'ol/layer/Tile.js';
import type BaseLayer from 'ol/layer/Base.js';
import type Map from 'ol/Map.js';
import { OSM, XYZ } from 'ol/source.js';
import { createCadBaseMap, CAD_BASE_MAP_ATTRIBUTION, cadBaseMapBundles } from './cadGridLayer';

export type BaseMapId = 'osm' | 'topo' | 'satellite' | 'cad';

export interface BaseMapDef {
  id: BaseMapId;
  label: string;
  /** Crea la capa base (TileLayer o LayerGroup) */
  create: () => BaseLayer;
  /** Registra listeners de vista (p. ej. grilla CAD dinámica) */
  attach?: (map: Map, layer: BaseLayer) => () => void;
  attribution?: string;
}

export const BASE_MAP_DEFS: BaseMapDef[] = [
  {
    id: 'cad',
    label: 'CAD — Grilla',
    attribution: CAD_BASE_MAP_ATTRIBUTION,
    create: () => {
      const bundle = createCadBaseMap();
      cadBaseMapBundles.set(bundle.layer, bundle);
      return bundle.layer;
    },
    attach: (map, layer) => {
      const bundle = cadBaseMapBundles.get(layer as ReturnType<typeof createCadBaseMap>['layer']);
      return bundle ? bundle.attach(map) : () => {};
    },
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    create: () =>
      new TileLayer({
        source: new OSM(),
      }),
  },
  {
    id: 'topo',
    label: 'Topográfico',
    create: () =>
      new TileLayer({
        source: new XYZ({
          url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
          attributions: '© <a href="https://opentopomap.org">OpenTopoMap</a> contributors',
        }),
      }),
  },
  {
    id: 'satellite',
    label: 'Satélite',
    create: () =>
      new TileLayer({
        source: new XYZ({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          attributions: '© <a href="https://esri.com">Esri</a>, Maxar, Earthstar Geographics',
        }),
      }),
  },
];
