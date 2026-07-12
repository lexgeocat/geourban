import TileLayer from 'ol/layer/Tile';
import type BaseLayer from 'ol/layer/Base';
import type Map from 'ol/Map';
import { OSM } from 'ol/source';
import XYZ from 'ol/source/XYZ.js';
import { createCadBaseMap, CAD_BASE_MAP_ATTRIBUTION, cadBaseMapBundles } from './cadGridLayer';

export type BaseMapId = 'cad' | 'osm' | 'esri-sat' | 'carto-light' | 'carto-dark';

export interface BaseMapDef {
  id: BaseMapId;
  label: string;
  create: () => BaseLayer;
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
    attribution: '© OpenStreetMap contributors',
    create: () => new TileLayer({ source: new OSM() }),
  },
  {
    id: 'esri-sat',
    label: 'Esri — Satélite',
    attribution: '© Esri, Maxar, Earthstar Geographics',
    create: () =>
      new TileLayer({
        source: new XYZ({
          url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          attributions: '© Esri, Maxar, Earthstar Geographics',
        }),
      }),
  },
  {
    id: 'carto-light',
    label: 'Carto — Claro',
    attribution: '© CARTO © OpenStreetMap contributors',
    create: () =>
      new TileLayer({
        source: new XYZ({
          url: 'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          attributions: '© CARTO © OpenStreetMap contributors',
        }),
      }),
  },
  {
    id: 'carto-dark',
    label: 'Carto — Oscuro',
    attribution: '© CARTO © OpenStreetMap contributors',
    create: () =>
      new TileLayer({
        source: new XYZ({
          url: 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
          attributions: '© CARTO © OpenStreetMap contributors',
        }),
      }),
  },
];
