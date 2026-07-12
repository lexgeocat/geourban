import TileLayer from 'ol/layer/Tile';
import type BaseLayer from 'ol/layer/Base';
import type Map from 'ol/Map';
import { OSM } from 'ol/source';
import { createCadBaseMap, CAD_BASE_MAP_ATTRIBUTION, cadBaseMapBundles } from './cadGridLayer';

export type BaseMapId = 'cad' | 'osm';

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
];
