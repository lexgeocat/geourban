import TileLayer from 'ol/layer/Tile';
import TileImage from 'ol/source/TileImage';
import { createXYZ } from 'ol/tilegrid';

const SUBDOMAINS = ['0', '1', '2', '3'];

/**
 * Crea una capa de Google Maps con subdominios rotativos y fallback a Esri.
 */
export const createGoogleMapsLayer = (type: 'satellite' | 'roadmap' | 'terrain' = 'satellite') => {
  const lyrs = { satellite: 's', roadmap: 'm', terrain: 'p' };
  const googleUrl = `https://mt{s}.google.com/vt/lyrs=${lyrs[type]}&x={x}&y={y}&z={z}`;

  let subdomainIdx = 0;

  return new TileLayer({
    source: new TileImage({
      attributions: '© Google',
      tileGrid: createXYZ({ maxZoom: 22 }),
      tileUrlFunction: (tileCoord) => {
        const z = tileCoord[0];
        const x = tileCoord[1];
        const y = tileCoord[2];
        const s = SUBDOMAINS[subdomainIdx++ % SUBDOMAINS.length];
        return `https://mt${s}.google.com/vt/lyrs=${lyrs[type]}&x=${x}&y=${y}&z=${z}`;
      },
      tileLoadFunction: (imageTile, src) => {
        const img = imageTile.getImage() as HTMLImageElement;
        img.onload = () => imageTile.setState(2);
        img.onerror = () => {
          const coord = imageTile.tileCoord as [number, number, number];
          const esriSrc = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${coord[0]}/${coord[2]}/${coord[1]}`;
          console.warn('Google tile failed, fallback to Esri:', coord);
          img.src = esriSrc;
          img.onerror = () => {
            console.error('Esri fallback also failed:', coord);
            imageTile.setState(3);
          };
        };
        img.src = src;
      },
    }),
    visible: true,
    className: 'google-maps-layer',
  });
};