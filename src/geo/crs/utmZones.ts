import proj4 from 'proj4';
import { register } from 'ol/proj/proj4.js';


export type ProjectCrsMode = 'utm' | 'none';

export interface ProjectCrsConfig {
  mode: ProjectCrsMode;
  utmZone: number;
  utmHemisphere: UtmHemisphere;
}

export type UtmHemisphere = 'N' | 'S';

const registered = new Set<string>();

export function utmEpsgCode(zone: number, hemisphere: UtmHemisphere): string {
  if (!Number.isInteger(zone) || zone < 1 || zone > 60) {
    throw new Error(`Zona UTM inválida: ${zone} (debe ser 1-60)`);
  }
  const base = hemisphere === 'N' ? 32600 : 32700;
  return `EPSG:${base + zone}`;
}

/** Registra (lazy, una sola vez) la zona UTM pedida en proj4 + OpenLayers. */
export function ensureUtmZoneRegistered(zone: number, hemisphere: UtmHemisphere): string {
  const code = utmEpsgCode(zone, hemisphere);
  if (!registered.has(code)) {
    const south = hemisphere === 'S' ? ' +south' : '';
    proj4.defs(code, `+proj=utm +zone=${zone}${south} +datum=WGS84 +units=m +no_defs +type=crs`);
    register(proj4); // re-escanea proj4.defs y crea las Projection de OL
    registered.add(code);
  }
  return code;
}

/** Zona/hemisferio UTM estándar (WGS84) para una coordenada lon/lat. */
export function utmZoneFromLonLat(lon: number, lat: number): { zone: number; hemisphere: UtmHemisphere } {
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  const hemisphere: UtmHemisphere = lat >= 0 ? 'N' : 'S';
  return { zone, hemisphere };
}

export function utmZoneLabel(zone: number, hemisphere: UtmHemisphere): string {
  return `UTM ${zone}${hemisphere}`;
}

/** Las 120 zonas (60 × N/S) — útil para poblar un <select>. */
export function listAllUtmZones() {
  const zones: Array<{ code: string; label: string; zone: number; hemisphere: UtmHemisphere }> = [];
  for (const hemisphere of ['N', 'S'] as UtmHemisphere[]) {
    for (let zone = 1; zone <= 60; zone++) {
      zones.push({ code: utmEpsgCode(zone, hemisphere), label: utmZoneLabel(zone, hemisphere), zone, hemisphere });
    }
  }
  return zones;
}