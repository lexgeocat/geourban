import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import type VectorSource from 'ol/source/Vector.js';
import { polyArea, centroid, ringPerimeter, type Pt } from '../math/polygonEngine';
import { getFeatureKind, getLotStatus, type LotStatus } from '../../core/objectModel';

export const MZN_COLORS = [
  '#58a6ff', '#3fb950', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
];

export interface LotInfo {
  label: string;
  areaM2: number;
  isRemnant: boolean;
}

export interface ManzanoRow {
  id: string | number;
  colorIdx: number;
  areaM2: number;
  perimeterM: number;
  centroid: Pt;
  isEquip: boolean;
  lots: LotInfo[];
  lotStatus: LotStatus;
}

export function readManzanoRows(drawSource: VectorSource | null): ManzanoRow[] {
  if (!drawSource) return [];
  const rows: ManzanoRow[] = [];
  let fallbackIdx = 0;
  drawSource.forEachFeature((f: Feature<Geometry>) => {
    const kind = getFeatureKind(f);
    if (kind !== 'manzana' && kind !== 'equipamiento') return;
    const id = f.getId();
    if (id == null) return;
    const geom = f.getGeometry();
    const ring: Pt[] = geom instanceof Polygon
      ? ((geom.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt)
      : [];
    const areaM2 = (f.get('areaM2') as number | undefined) ?? (ring.length ? polyArea(ring) : 0);
    const perimeterM = ring.length ? ringPerimeter(ring) : 0;
    const centroidPt: Pt = ring.length ? centroid(ring) : [0, 0];
    const lots: LotInfo[] = [];
    drawSource.forEachFeature((g: Feature<Geometry>) => {
      if (g.get('lotGroupId') !== String(id)) return;
      lots.push({
        label: (g.get('label') as string) ?? 'Lote',
        areaM2: (g.get('areaM2') as number) ?? 0,
        isRemnant: !!g.get('isRemnant'),
      });
    });
    const colorIdx = (f.get('colorIdx') as number | undefined) ?? fallbackIdx;
    rows.push({
      id,
      colorIdx: colorIdx % MZN_COLORS.length,
      areaM2,
      perimeterM,
      centroid: centroidPt,
      isEquip: kind === 'equipamiento',
      lots,
      lotStatus: getLotStatus(f),
    });
    fallbackIdx++;
  });
  return rows;
}