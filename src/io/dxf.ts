import DxfParser, { type IEntity } from 'dxf-parser';
import Drawing from 'dxf-writer';
import { createEmptyProject, type GeoUrbanProject, type ImportResult } from './types';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { fromLonLat, toLonLat, transform } from 'ol/proj.js';
import { useMapStore } from '../store/mapStore';

export async function importDxf(
  file: File,
  sourceCrs: 'local' | string = 'local'
): Promise<ImportResult> {
  const text = await file.text();
  const parser = new DxfParser();
  const dxf = parser.parseSync(text);
  if (!dxf) throw new Error('No se pudo parsear el archivo DXF');

const features: Feature[] = [];

  for (const entity of dxf.entities ?? []) {
    const feature = entityToFeature(entity);
    if (feature) features.push(feature);
  }

  if (sourceCrs === 'local') {
    // Sin CRS real: centramos relativo a la vista actual (fallback para DXF
    // "de escritorio" sin georreferenciar).
    const viewCenter = useMapStore.getState().viewConfig.center;
    const centerMerc = fromLonLat(viewCenter) as [number, number];
    for (const feature of features) {
      translateFeatureGeometryToView(feature, centerMerc);
    }
  } else {
    // CRS real (p. ej. EPSG:32719 desde AutoCAD Map 3D): reproyección
    // matemática real de UTM a WGS84, no un simple desplazamiento.
    for (const feature of features) {
      reprojectFeatureGeometry(feature, sourceCrs, 'EPSG:4326');
    }
  }
  function reprojectFeatureGeometry(feature: Feature, sourceCrs: string, destCrs: string) {
  const geom = feature.geometry;
  if (!geom) return;

  const toDest = (coord: number[]) => transform(coord, sourceCrs, destCrs) as [number, number];

  if (geom.type === 'Point') {
    geom.coordinates = toDest(geom.coordinates);
  } else if (geom.type === 'LineString') {
    geom.coordinates = geom.coordinates.map(toDest);
  } else if (geom.type === 'Polygon') {
    geom.coordinates = geom.coordinates.map((ring) => ring.map(toDest));
  }
}

  const project = createEmptyProject(file.name.replace(/\.dxf$/i, ''));
  project.data = { type: 'FeatureCollection', features };

  const warnings: string[] = [];
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
    const geometry: LineString = {
      type: 'LineString',
      coordinates: [
        [start.x, start.y],
        [end.x, end.y],
      ],
    };
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
function translateFeatureGeometryToView(feature: Feature, centerMerc: [number, number]) {
  const geom = feature.geometry;
  if (!geom) return;

  const toViewLngLat = ([x, y]: number[]): [number, number] =>
    toLonLat([x + centerMerc[0], y + centerMerc[1]]) as [number, number];

  if (geom.type === 'Point') {
    geom.coordinates = toViewLngLat(geom.coordinates);
  } else if (geom.type === 'LineString') {
    geom.coordinates = geom.coordinates.map(toViewLngLat);
  } else if (geom.type === 'Polygon') {
    geom.coordinates = geom.coordinates.map((ring) => ring.map(toViewLngLat));
  }
}

export function exportDxf(project: GeoUrbanProject): string {
  const dxf = new Drawing();
  const collection = project.data as FeatureCollection;

  for (const feature of collection.features) {
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
        const points: [number, number][] = ring.map((c) => [c[0], c[1]]);
        dxf.drawPolyline(points, true);
      }
    }
  }

  return dxf.toDxfString();
}
