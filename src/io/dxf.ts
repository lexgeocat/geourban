import DxfParser, { type IEntity } from 'dxf-parser';
import Drawing from 'dxf-writer';
import { createEmptyProject, type GeoUrbanProject, type ImportResult } from './types';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';

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
