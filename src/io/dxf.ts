import DxfParser, { type IEntity } from 'dxf-parser';
import Drawing from 'dxf-writer';
import { createEmptyProject, type GeoUrbanProject, type ImportResult } from './types';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { useMapStore } from '../store/mapStore';
import { useProjectCrsStore } from '../store/projectCrsStore';
import { ensureUtmZoneRegistered, utmZoneLabel } from '../geo/utmZones';
import { reprojectFeatureCollection, mapFeatureCollectionCoords, utmWkt } from '../geo/crsTransform';
const GEOGRAPHIC = 'EPSG:4326';

/**
 * Importa un DXF usando SIEMPRE el CRS configurado en useProjectCrsStore —
 * la misma fuente de verdad que exportDxf(). Antes cada import preguntaba
 * por separado y asumía UTM 19S a ciegas; si el DXF se había exportado con
 * otro CRS (o sin CRS), el resultado eran coordenadas sin sentido como
 * lon=-717 (fuera del rango ±180°). Con el CRS fijado una sola vez al
 * empezar el proyecto, export e import quedan sincronizados por diseño.
 */
export async function importDxf(file: File): Promise<ImportResult> {
  const text = await file.text();
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf) throw new Error('No se pudo parsear el archivo DXF');

  const features: Feature[] = [];
  for (const entity of dxf.entities ?? []) {
    const feature = entityToFeature(entity);
    if (feature) features.push(feature);
  }

  let collection: FeatureCollection = { type: 'FeatureCollection', features };
  const crs = useProjectCrsStore.getState();
  const warnings: string[] = [];

  if (crs.mode === 'utm') {
    const epsg = ensureUtmZoneRegistered(crs.utmZone, crs.utmHemisphere);
    collection = reprojectFeatureCollection(collection, epsg, GEOGRAPHIC);
    warnings.push(
      `Importado asumiendo ${utmZoneLabel(crs.utmZone, crs.utmHemisphere)} (CRS actual del proyecto). ` +
      `Si el DXF viene de otra zona, cambiala primero en "CRS del proyecto".`
    );
  } else {
    // Modo 'none': el DXF nunca tuvo anclaje real. Se reposiciona con el
    // MISMO criterio equirectangular (metros reales de terreno, escalados
    // por cos(latitud)) que usa exportDxf() en esta rama. Antes se usaba
    // fromLonLat/toLonLat (metros Web Mercator), que NO es la inversa del
    // export y metía un error de escala de varios % según la latitud del
    // proyecto — un DXF "libre" exportado y reimportado aparecía deformado.
    const [centerLon, centerLat] = useMapStore.getState().viewConfig.center;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
    const toViewLngLat = ([x, y]: number[]): [number, number] => [
      centerLon + x / mPerDegLon,
      centerLat + y / mPerDegLat,
    ];
    for (const feature of collection.features) {
      translateFeatureGeometryToView(feature, toViewLngLat);
    }
  }

  const project = createEmptyProject(file.name.replace(/\.dxf$/i, ''));
  project.data = collection;

  if (features.length === 0) {
    warnings.push('No se encontraron entidades DXF convertibles (LWPOLYLINE, LINE, POLYLINE).');
  }

  return { project, warnings };
}

function entityToFeature(entity: IEntity): Feature | null {
  const type = entity.type;
  if (type === 'LWPOLYLINE' || type === 'POLYLINE') {
    const vertices = entity.vertices ?? [];
    if (vertices.length < 2) return null;
    const coords = vertices.map((v) => [v.x, v.y]);
    const closed = Boolean(entity.shape ?? entity.closed);
    if (closed && coords.length >= 3) {
      coords.push(coords[0]);
      const geometry: Polygon = { type: 'Polygon', coordinates: [coords] };
      return { type: 'Feature', properties: { dxfType: type }, geometry };
    }
    const geometry: LineString = { type: 'LineString', coordinates: coords };
    return { type: 'Feature', properties: { dxfType: type }, geometry };
  }
  if (type === 'LINE') {
    const start = entity.start;
    const end = entity.end;
    if (!start || !end) return null;
    const geometry: LineString = { type: 'LineString', coordinates: [[start.x, start.y], [end.x, end.y]] };
    return { type: 'Feature', properties: { dxfType: type }, geometry };
  }
  if (type === 'POINT') {
    const pos = entity.position;
    if (!pos) return null;
    const geometry: Point = { type: 'Point', coordinates: [pos.x, pos.y] };
    return { type: 'Feature', properties: { dxfType: type }, geometry };
  }
  return null;
}

function translateFeatureGeometryToView(feature: Feature, toViewLngLat: (c: number[]) => [number, number]) {
  const geom = feature.geometry;
  if (!geom) return;
  if (geom.type === 'Point') geom.coordinates = toViewLngLat(geom.coordinates);
  else if (geom.type === 'LineString') geom.coordinates = geom.coordinates.map(toViewLngLat);
  else if (geom.type === 'Polygon') geom.coordinates = geom.coordinates.map((ring) => ring.map(toViewLngLat));
}

export interface DxfExportResult {
  dxfText: string;
  epsg: string | null;
  prjWkt: string | null;
  /** IMPORTANTE: QGIS/OGR no leen sidecar .prj para DXF (sí para shapefile).
   *  El .prj se entrega igual por si el destino es AutoCAD Map3D/Civil3D o
   *  Global Mapper, pero en QGIS el CRS hay que asignarlo a mano. */
  instructions: string;
}

export function exportDxf(project: GeoUrbanProject): DxfExportResult {
  const dxf = new Drawing();
  const collection = project.data as FeatureCollection;
  const crs = useProjectCrsStore.getState();

  let projected: FeatureCollection;
  let epsg: string | null = null;
  let prjWkt: string | null = null;
  let instructions: string;

  if (crs.mode === 'utm') {
    epsg = ensureUtmZoneRegistered(crs.utmZone, crs.utmHemisphere);
    prjWkt = utmWkt(crs.utmZone, crs.utmHemisphere);
    projected = reprojectFeatureCollection(collection, GEOGRAPHIC, epsg);
    instructions =
      `DXF exportado en ${utmZoneLabel(crs.utmZone, crs.utmHemisphere)} (${epsg}). ` +
      `QGIS no detecta el CRS de un DXF solo: click derecho en la capa → ` +
      `"Asignar SRC de capa" → buscar "${epsg.replace('EPSG:', '')}".`;
  } else {
    // Modo 'none': plano local en metros reales, centrado en la VISTA
    // ACTUAL del proyecto — el mismo punto de anclaje que usa importDxf()
    // en este modo. Antes se anclaba al centroide de los propios datos, lo
    // que desincronizaba import/export: si la vista se movía entre
    // exportar y volver a importar, el dibujo reaparecía desplazado del
    // lugar original.
    const [lon, lat] = useMapStore.getState().viewConfig.center;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
    projected = mapFeatureCollectionCoords(collection, ([x, y]) => [
      (x - lon) * mPerDegLon,
      (y - lat) * mPerDegLat,
    ]);
    instructions =
      'DXF exportado sin georreferenciar ("Dibujo libre"): (0,0) es el centro de la vista actual del mapa. ' +
      'Para anclarlo a un CRS real, configurá una zona UTM en "CRS del proyecto" y reexportá.';
  }

  for (const feature of projected.features) {
    const geom = feature.geometry;
    if (!geom) continue;
    if (geom.type === 'LineString') {
      const coords = geom.coordinates;
      for (let i = 0; i < coords.length - 1; i++) {
        dxf.drawLine(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
      }
    } else if (geom.type === 'Polygon') {
      const ring = geom.coordinates[0] ?? [];
      if (ring.length >= 2) {
        dxf.drawPolyline(ring.map((c) => [c[0], c[1]] as [number, number]), true);
      }
    }
  }

  return { dxfText: dxf.toDxfString(), epsg, prjWkt, instructions };
}