import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import type VectorSource from 'ol/source/Vector.js';
import { polyArea, centroid, ringPerimeter, type Pt } from '../math/polygonEngine';
import { getFeatureKind, getLotStatus, type LotStatus } from '../../core/objectModel';

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
  lots: LotInfo[];
  lotStatus: LotStatus;
}

export function readManzanoRows(drawSource: VectorSource | null): ManzanoRow[] {
  if (!drawSource) return [];

  // Un solo recorrido: agrupamos lotes por lotGroupId y separamos manzanos/equipamientos.
  const lotsByGroup = new Map<string, LotInfo[]>();
  const manzanoFeatures: Feature<Geometry>[] = [];

  drawSource.forEachFeature((f: Feature<Geometry>) => {
    const kind = getFeatureKind(f);
    if (kind === 'manzana' || kind === 'equipamiento') {
      manzanoFeatures.push(f);
      return;
    }
    if (kind === 'lote') {
      const groupId = f.get('lotGroupId') as string | undefined;
      if (!groupId) return;
      const info: LotInfo = {
        label: (f.get('label') as string) ?? 'Lote',
        areaM2: (f.get('areaM2') as number) ?? 0,
        isRemnant: !!f.get('isRemnant'),
      };
      const list = lotsByGroup.get(groupId);
      if (list) list.push(info);
      else lotsByGroup.set(groupId, [info]);
    }
  });

  const rows: ManzanoRow[] = [];
  let fallbackIdx = 0;
  for (const f of manzanoFeatures) {
    const id = f.getId();
    if (id == null) continue;
    const geom = f.getGeometry();
    const ring: Pt[] = geom instanceof Polygon
      ? ((geom.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt)
      : [];
    const areaM2 = (f.get('areaM2') as number | undefined) ?? (ring.length ? polyArea(ring) : 0);
    const perimeterM = ring.length ? ringPerimeter(ring) : 0;
    const centroidPt: Pt = ring.length ? centroid(ring) : [0, 0];
    const colorIdx = (f.get('colorIdx') as number | undefined) ?? fallbackIdx;

    rows.push({
      id,
      colorIdx,
      areaM2,
      perimeterM,
      centroid: centroidPt,
      lots: lotsByGroup.get(String(id)) ?? [],
      lotStatus: getLotStatus(f),
    });
    fallbackIdx++;
  }
  return rows;
}