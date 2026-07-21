import DxfParser, { type IEntity } from 'dxf-parser';
import Drawing from 'dxf-writer';
import { createEmptyProject, type GeoUrbanProject, type ImportResult } from './types';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { useMapStore } from '../store/mapStore';
import { useProjectCrsStore } from '../store/projectCrsStore';
import { ensureUtmZoneRegistered, utmZoneLabel } from '../geo/utmZones';
import { reprojectFeatureCollection, mapFeatureCollectionCoords, utmWkt } from '../geo/crsTransform';
import { sampleArc } from '../geo/arcMath';
const GEOGRAPHIC = 'EPSG:4326';

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
    warnings.push('No se encontraron entidades DXF convertibles (LWPOLYLINE, LINE, POLYLINE, CIRCLE, ARC, POINT).');
  }

  return { project, warnings };
}

/** Samplea un arco (CIRCLE/ARC) en un LineString con N segmentos.
 *  CIRCLE/ARC en DXF vienen en grados; los pasamos a radianes para sampleArc. */
function arcToLineString(
  cx: number,
  cy: number,
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
  closed: boolean,
  segments = 32,
): [number, number][] {
  const startRad = (startAngleDeg * Math.PI) / 180;
  let endRad = (endAngleDeg * Math.PI) / 180;
  // Para un arco completo (CIRCLE), endAngle - startAngle = 360° → 2π
  if (closed && Math.abs(endRad - startRad) >= Math.PI * 2 - 1e-6) {
    endRad = startRad + Math.PI * 2;
  }
  const points = sampleArc(
    {
      center: [cx, cy],
      radius,
      startAngle: startRad,
      endAngle: endRad,
      counterClockwise: false, // DXF usa sentido antihorario positivo pero para el muestreo no afecta el render
    },
    segments,
  );
  if (closed && points.length > 0) points.push(points[0]);
  return points;
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
  if (type === 'CIRCLE') {
    const center = entity.position;
    const radius = entity.radius;
    if (!center || radius == null) return null;
    // CIRCLE = arco completo (0° → 360°) sampleado y cerrado.
    const coords = arcToLineString(center.x, center.y, radius, 0, 360, true);
    const geometry: Polygon = { type: 'Polygon', coordinates: [coords] };
    return { type: 'Feature', properties: { dxfType: type, radius }, geometry };
  }
  if (type === 'ARC') {
    const center = entity.position;
    const radius = entity.radius;
    const startAngle = entity.startAngle ?? 0;
    const endAngle = entity.endAngle ?? 360;
    if (!center || radius == null) return null;
    // ARC = arco parcial sampleado, NO cerrado en el origen/fin.
    const coords = arcToLineString(center.x, center.y, radius, startAngle, endAngle, false);
    const geometry: LineString = { type: 'LineString', coordinates: coords };
    return { type: 'Feature', properties: { dxfType: type, radius, startAngle, endAngle }, geometry };
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
    const props = feature.properties ?? {};
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
    } else if (geom.type === 'Point') {
      // Handle CIRCLE and ARC from properties
      const dxfType = props.dxfType;
      if (dxfType === 'CIRCLE' && props.radius != null) {
        const [x, y] = geom.coordinates;
        dxf.drawCircle(x, y, props.radius);
      } else if (dxfType === 'ARC' && props.radius != null && props.startAngle != null && props.endAngle != null) {
        const [x, y] = geom.coordinates;
        dxf.drawArc(x, y, props.radius, props.startAngle, props.endAngle);
      } else {
        // Regular point
        const [x, y] = geom.coordinates;
        dxf.drawPoint(x, y);
      }
    }
    // Handle cota features (dimensions)
    if (props.kind === 'cota') {
      const originStart = props.originStart as [number, number] | undefined;
      const originEnd = props.originEnd as [number, number] | undefined;
      const value = props.value as number | undefined;
      if (originStart && originEnd && value != null) {
        // DXF DIMENSION: requires definition point, text position, dimension line
        const [x1, y1] = originStart;
        const [x2, y2] = originEnd;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        (dxf as any).drawLinearDimension(x1, y1, x2, y2, midX, midY + 5, value.toString());
      }
    }
  }

  return { dxfText: dxf.toDxfString(), epsg, prjWkt, instructions };
}