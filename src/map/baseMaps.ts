import TileLayer from 'ol/layer/Tile';
import { OSM, XYZ } from 'ol/source';

export type BaseMapId = 'osm' | 'topo' | 'satellite';

export interface BaseMapDef {
  id: BaseMapId;
  label: string;
  /** Crea una nueva capa TileLayer con la fuente correspondiente */
  create: () => TileLayer;
}

export const BASE_MAP_DEFS: BaseMapDef[] = [
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
