import { toLonLat } from 'ol/proj.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import Point from 'ol/geom/Point.js';
import CircleGeom from 'ol/geom/Circle.js';
import type VectorSource from 'ol/source/Vector.js';
import { getFeatureKind, getLayerSuggestion, getLotStatus, type Layer } from '@kernel/domain-model/featureModel';
import { polyArea, type Pt } from '@kernel/geometry/polygonEngine';
import { projectPathToMetricPlane, streetLengthMetricM } from '@georef-engine/metrics';
import type { Street } from '@vias-engine/store/streetStore';
import type { Roundabout } from '@vias-engine/store/roundaboutStore';
import { roundaboutGeometry } from '@vias-engine/geometry/roundaboutEngine';

export interface MetricPolygonEntity {
  id: string;
  kind: 'perimetro' | 'manzana' | 'lote' | 'circulo';
  ring: [number, number][];
  bbox: [number, number, number, number];
  centroid: [number, number];
  color: string;
  opacity: number;
  strokeWidth: number;
  zIndex: number;
  code: string;
  areaM2: number;
  perimeterM: number;
  frontM?: number;
  depthM?: number;
  subdivided: boolean;
  attributes: Record<string, string>;
}

export interface MetricLineEntity {
  id: string;
  kind: 'linea' | 'polilinea';
  path: [number, number][];
  color: string;
  opacity: number;
  strokeWidth: number;
  zIndex: number;
  label: string;
}

export interface MetricPointEntity {
  id: string;
  coord: [number, number];
  color: string;
  opacity: number;
  zIndex: number;
  label: string;
}

export interface MetricStreetEntity {
  id: string;
  name: string;
  path: [number, number][];
  widthM: number;
  sideWidthM: number;
  lengthM: number;
  color: string;
  opacity: number;
}

export interface MetricRoundaboutEntity {
  id: string;
  name: string;
  center: [number, number];
  roadOuter: [number, number][];
  sideOuter: [number, number][];
  island: [number, number][] | null;
  radiusM: number;
  roadWidthM: number;
  color: string;
  opacity: number;
}

export interface MetricRoadNetworkGroup {
  layerId: string;
  color: string;
  opacity: number;
  outerPolygons: [number, number][][][];
  roadPolygons: [number, number][][][];
}

export interface LotVertexRow {
  vertexLabel: string;
  sideLabel: string;
  distanceM: number;
  eastM: number;
  northM: number;
}

export interface LotCatalogItem {
  id: string;
  code: string;
  manzanoCode: string;
  manzanoBBox: [number, number, number, number];
  areaM2: number;
  perimeterM: number;
  frontM: number;
  depthM: number;
  ring: [number, number][];
  centroid: [number, number];
  centroidLonLat: [number, number];
  bboxMetric: [number, number, number, number];
  vertices: LotVertexRow[];
  frontStreetName: string;
  featureAttributes: Record<string, string>;
  isDemo?: boolean;
}

export interface ManzanoSummaryRow {
  code: string;
  areaM2: number;
  lotCount: number;
}

export interface LegendEntry {
  label: string;
  color: string;
  kind: 'polygon' | 'line' | 'point' | 'street' | 'roundabout';
  count: number;
}

export interface ExtractedCartography {
  hasRealGeometry: boolean;
  bboxMetric: [number, number, number, number];
  centroidLonLat: [number, number];
  centroidMetric: [number, number];
  polygons: MetricPolygonEntity[];
  lines: MetricLineEntity[];
  points: MetricPointEntity[];
  streets: MetricStreetEntity[];
  roundabouts: MetricRoundaboutEntity[];
  roadNets?: MetricRoadNetworkGroup[];
  lotsCatalog: LotCatalogItem[];
  totalAreaM2: number;
  manzanoAreaM2: number;
  lotAreaM2: number;
  streetAreaM2: number;
  totalStreetLengthM: number;
  manzanoCount: number;
  lotCount: number;
  streetCount: number;
  manzanoRows: ManzanoSummaryRow[];
  legend: LegendEntry[];
  crsLabel: string;
  epsgCode: string;
}

function ringPerimeter(ring: [number, number][]): number {
  let len = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    len += Math.hypot(ring[i + 1][0] - ring[i][0], ring[i + 1][1] - ring[i][1]);
  }
  return len;
}

function ringBBox(ring: [number, number][]): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

export function ringCentroid(ring: [number, number][]): [number, number] {
  if (ring.length === 0) return [0, 0];
  const isClosed =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const count = isClosed ? ring.length - 1 : ring.length;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < count; i++) {
    sx += ring[i][0];
    sy += ring[i][1];
  }
  return [sx / Math.max(1, count), sy / Math.max(1, count)];
}

function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  const [px, py] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointToSegmentDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function buildLotVertices(ring: [number, number][]): LotVertexRow[] {
  const isClosed =
    ring.length > 1 &&
    Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < 1e-3;
  const pts = isClosed ? ring.slice(0, -1) : ring;
  const rows: LotVertexRow[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const dist = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    rows.push({
      vertexLabel: `V${i + 1}`,
      sideLabel: `V${i + 1} - V${((i + 1) % n) + 1}`,
      distanceM: dist,
      eastM: cur[0],
      northM: cur[1],
    });
  }
  return rows;
}

export function formatDms(deg: number, isLat: boolean): string {
  const dir = isLat ? (deg >= 0 ? 'N' : 'S') : deg >= 0 ? 'E' : 'W';
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = ((mFloat - m) * 60).toFixed(1);
  return `${d}° ${String(m).padStart(2, '0')}' ${String(s).padStart(4, '0')}" ${dir}`;
}

function extractFeatureStringAttributes(feat: Feature<Geometry>): Record<string, string> {
  const props = feat.getProperties();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (k === 'geometry' || k === 'labelConfig' || v == null) continue;
    if (typeof v === 'string' && v.trim().length > 0) {
      out[k] = v.trim();
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = Number.isInteger(v) ? String(v) : v.toFixed(2);
    } else if (typeof v === 'boolean') {
      out[k] = v ? 'Sí' : 'No';
    }
  }
  return out;
}

export function extractProjectCartography(params: {
  drawSource: VectorSource<Feature<Geometry>> | null;
  streets: Street[];
  roundabouts: Roundabout[];
  layers: Layer[];
  crsMode: 'utm' | 'none';
  utmZone: number;
  utmHemisphere: 'N' | 'S';
  fallbackCenterLonLat: [number, number];
}): ExtractedCartography {
  const { drawSource, streets, roundabouts, layers, crsMode, utmZone, utmHemisphere, fallbackCenterLonLat } = params;

  const layerById = new Map<string, Layer>();
  for (const lyr of layers) {
    layerById.set(lyr.id, lyr);
  }

  const polygons: MetricPolygonEntity[] = [];
  const lines: MetricLineEntity[] = [];
  const points: MetricPointEntity[] = [];
  const metricStreets: MetricStreetEntity[] = [];
  const metricRoundabouts: MetricRoundaboutEntity[] = [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  let min3857X = Infinity;
  let min3857Y = Infinity;
  let max3857X = -Infinity;
  let max3857Y = -Infinity;

  const expandMetric = (pt: [number, number]) => {
    if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return;
    if (pt[0] < minX) minX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] > maxY) maxY = pt[1];
  };

  const expand3857 = (pt: [number, number]) => {
    if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) return;
    if (pt[0] < min3857X) min3857X = pt[0];
    if (pt[1] < min3857Y) min3857Y = pt[1];
    if (pt[0] > max3857X) max3857X = pt[0];
    if (pt[1] > max3857Y) max3857Y = pt[1];
  };

  let mznIndex = 1;
  let lotIndex = 1;

  if (drawSource) {
    drawSource.forEachFeature((feat: Feature<Geometry>) => {
      const layerId = feat.get('layerId') as string | undefined;
      const layer = layerId ? layerById.get(layerId) : undefined;
      if (layer && !layer.visible) return;

      const geom = feat.getGeometry();
      if (!geom) return;
      const kind = getFeatureKind(feat) ?? 'lote';
      const featColor = feat.get('color') as string | undefined;
      const featOpacity = feat.get('opacity') as number | undefined;
      const featStrokeWidth =
        (feat.get('strokeWidth') as number | undefined) ??
        (feat.get('lineWidth') as number | undefined);
      const color =
        featColor ?? layer?.color ?? getLayerSuggestion(kind)?.color ?? '#58a6ff';
      const opacity =
        typeof featOpacity === 'number' && Number.isFinite(featOpacity)
          ? Math.max(0.05, Math.min(1, featOpacity))
          : (layer?.opacity ?? 1);
      const strokeWidth =
        typeof featStrokeWidth === 'number' && Number.isFinite(featStrokeWidth)
          ? Math.max(0.5, featStrokeWidth)
          : 2;
      const zIndex = layer?.zIndex ?? 0;

      if (geom instanceof Polygon) {
        const rawRing = geom.getCoordinates()[0];
        if (!rawRing || rawRing.length < 4) return;
        const pts3857: [number, number][] = rawRing.map((c) => [c[0], c[1]]);
        pts3857.forEach(expand3857);
        const metricRing = projectPathToMetricPlane(pts3857);
        metricRing.forEach(expandMetric);

        const subdivided = kind === 'manzana' && getLotStatus(feat) === 'subdivided';
        const areaM2 = (feat.get('areaM2') as number | undefined) ?? polyArea(metricRing as Pt[]);
        const perimeterM = (feat.get('perimeterM') as number | undefined) ?? ringPerimeter(metricRing);
        const rawCode = (feat.get('code') as string | undefined) ?? (feat.get('label') as string | undefined) ?? '';
        const code =
          rawCode ||
          (kind === 'manzana'
            ? `M-${String(mznIndex++).padStart(2, '0')}`
            : kind === 'lote'
              ? `${lotIndex++}`
              : '');

        polygons.push({
          id: String(feat.getId() ?? `${kind}-${polygons.length}`),
          kind: kind === 'perimetro' || kind === 'manzana' || kind === 'lote' || kind === 'circulo' ? kind : 'lote',
          ring: metricRing,
          bbox: ringBBox(metricRing),
          centroid: ringCentroid(metricRing),
          color,
          opacity,
          strokeWidth,
          zIndex,
          code,
          areaM2,
          perimeterM,
          frontM: feat.get('frontM') as number | undefined,
          depthM: feat.get('depthM') as number | undefined,
          subdivided,
          attributes: extractFeatureStringAttributes(feat),
        });
      } else if (geom instanceof CircleGeom) {
        const center3857 = geom.getCenter() as [number, number];
        const radius3857 = geom.getRadius();
        const segs = 48;
        const ring3857: [number, number][] = [];
        for (let i = 0; i <= segs; i++) {
          const ang = (i * 2 * Math.PI) / segs;
          ring3857.push([center3857[0] + Math.cos(ang) * radius3857, center3857[1] + Math.sin(ang) * radius3857]);
        }
        ring3857.forEach(expand3857);
        const metricRing = projectPathToMetricPlane(ring3857);
        metricRing.forEach(expandMetric);
        const areaM2 = polyArea(metricRing as Pt[]);
        polygons.push({
          id: String(feat.getId() ?? `circ-${polygons.length}`),
          kind: 'circulo',
          ring: metricRing,
          bbox: ringBBox(metricRing),
          centroid: ringCentroid(metricRing),
          color,
          opacity,
          strokeWidth,
          zIndex,
          code: (feat.get('label') as string | undefined) ?? 'Círculo',
          areaM2,
          perimeterM: ringPerimeter(metricRing),
          subdivided: false,
          attributes: extractFeatureStringAttributes(feat),
        });
      } else if (geom instanceof LineString) {
        const rawCoords = geom.getCoordinates();
        if (rawCoords.length < 2) return;
        const pts3857: [number, number][] = rawCoords.map((c) => [c[0], c[1]]);
        pts3857.forEach(expand3857);
        const metricPath = projectPathToMetricPlane(pts3857);
        metricPath.forEach(expandMetric);
        lines.push({
          id: String(feat.getId() ?? `line-${lines.length}`),
          kind: kind === 'polilinea' ? 'polilinea' : 'linea',
          path: metricPath,
          color,
          opacity,
          strokeWidth,
          zIndex,
          label: (feat.get('label') as string | undefined) ?? '',
        });
      } else if (geom instanceof Point) {
        const c = geom.getCoordinates();
        const pt3857: [number, number] = [c[0], c[1]];
        expand3857(pt3857);
        const [ptMetric] = projectPathToMetricPlane([pt3857]);
        if (ptMetric) {
          expandMetric(ptMetric);
          points.push({
            id: String(feat.getId() ?? `pt-${points.length}`),
            coord: ptMetric,
            color,
            opacity,
            zIndex,
            label: (feat.get('label') as string | undefined) ?? `P-${points.length + 1}`,
          });
        }
      }
    });
  }

  for (const st of streets) {
    const layer = st.layerId ? layerById.get(st.layerId) : layers.find((l) => l.kind === 'via');
    if (layer && !layer.visible) continue;
    const rawPts: [number, number][] = [st.start, ...(st.waypoints ?? []), st.end];
    rawPts.forEach(expand3857);
    const metricPath = projectPathToMetricPlane(rawPts);
    metricPath.forEach((pt) => {
      const pad = st.widthM / 2 + (st.sideWidthM ?? 0);
      expandMetric([pt[0] - pad, pt[1] - pad]);
      expandMetric([pt[0] + pad, pt[1] + pad]);
    });
    metricStreets.push({
      id: st.id,
      name: st.name,
      path: metricPath,
      widthM: st.widthM,
      sideWidthM: st.sideWidthM ?? 0,
      lengthM: streetLengthMetricM(st),
      color: layer?.color ?? getLayerSuggestion('via')?.color ?? '#8b5cf6',
      opacity: layer?.opacity ?? 1,
    });
  }

  for (const rb of roundabouts) {
    const layer = rb.layerId ? layerById.get(rb.layerId) : layers.find((l) => l.kind === 'rotonda') ?? layers.find((l) => l.kind === 'via');
    if (layer && !layer.visible) continue;
    const rbGeom = roundaboutGeometry(rb);
    rbGeom.sideOuter.forEach((pt) => expand3857([pt[0], pt[1]]));
    const [centerMetric] = projectPathToMetricPlane([[rb.center[0], rb.center[1]]]);
    const roadOuterMetric = projectPathToMetricPlane(rbGeom.roadOuter.map((p) => [p[0], p[1]]));
    const sideOuterMetric = projectPathToMetricPlane(rbGeom.sideOuter.map((p) => [p[0], p[1]]));
    const islandMetric = rbGeom.island
      ? projectPathToMetricPlane(rbGeom.island.map((p) => [p[0], p[1]]))
      : null;
    sideOuterMetric.forEach(expandMetric);
    if (centerMetric) {
      metricRoundabouts.push({
        id: rb.id,
        name: rb.name,
        center: centerMetric,
        roadOuter: roadOuterMetric,
        sideOuter: sideOuterMetric,
        island: islandMetric,
        radiusM: rb.radiusM,
        roadWidthM: rb.roadWidthM,
        color: layer?.color ?? getLayerSuggestion('rotonda')?.color ?? '#f78166',
        opacity: layer?.opacity ?? 1,
      });
    }
  }

  const hasRealGeometry =
    Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minY) && Number.isFinite(maxY);

  if (!hasRealGeometry) {
    const lon = fallbackCenterLonLat[0];
    const lat = fallbackCenterLonLat[1];
    const x3857 = (lon * 20037508.34) / 180;
    const y3857 =
      (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180);
    const [cMetric] = projectPathToMetricPlane([[x3857, y3857]]);
    const cx = cMetric ? cMetric[0] : 500000;
    const cy = cMetric ? cMetric[1] : 8150000;

    minX = cx - 50;
    maxX = cx + 50;
    minY = cy - 40;
    maxY = cy + 40;
    min3857X = x3857 - 100;
    max3857X = x3857 + 100;
    min3857Y = y3857 - 80;
    max3857Y = y3857 + 80;
  }

  const center3857: [number, number] = [(min3857X + max3857X) / 2, (min3857Y + max3857Y) / 2];
  const lonLatRaw = toLonLat(center3857);
  const centroidLonLat: [number, number] = [
    Number.isFinite(lonLatRaw[0]) ? lonLatRaw[0] : fallbackCenterLonLat[0],
    Number.isFinite(lonLatRaw[1]) ? lonLatRaw[1] : fallbackCenterLonLat[1],
  ];

  // Balances y catálogo de lotes
  let manzanoAreaM2 = 0;
  let lotAreaM2 = 0;
  let perimetroAreaM2 = 0;
  const manzanoRows: ManzanoSummaryRow[] = [];

  const activeManzanos = polygons.filter((p) => p.kind === 'manzana' && !p.subdivided);
  const allManzanos = polygons.filter((p) => p.kind === 'manzana');
  const allLots = polygons.filter((p) => p.kind === 'lote');
  const allPerimetros = polygons.filter((p) => p.kind === 'perimetro');

  for (const p of allPerimetros) perimetroAreaM2 += p.areaM2;
  for (const m of activeManzanos) manzanoAreaM2 += m.areaM2;
  for (const l of allLots) lotAreaM2 += l.areaM2;

  for (let i = 0; i < allManzanos.length; i++) {
    const m = allManzanos[i];
    let associatedLots = 0;
    for (const l of allLots) {
      if (pointInRing(l.centroid, m.ring)) {
        associatedLots++;
      }
    }
    manzanoRows.push({
      code: m.code || `M-${String(i + 1).padStart(2, '0')}`,
      areaM2: m.areaM2,
      lotCount: associatedLots,
    });
  }

  // Catálogo detallado de lotes para modo "Por Lote Individual"
  const lotsCatalog: LotCatalogItem[] = allLots.map((lot) => {
    let parentMzn: MetricPolygonEntity | undefined;
    for (const m of allManzanos) {
      if (pointInRing(lot.centroid, m.ring)) {
        parentMzn = m;
        break;
      }
    }
    if (!parentMzn && allManzanos.length > 0) {
      // Fallback por cercanía al centroide del manzano
      let bestDist = Infinity;
      for (const m of allManzanos) {
        const d = Math.hypot(lot.centroid[0] - m.centroid[0], lot.centroid[1] - m.centroid[1]);
        if (d < bestDist) {
          bestDist = d;
          parentMzn = m;
        }
      }
    }

    // Buscar vía más cercana y estimar frente real hacia dicha vía
    let frontStreetName = 'Vía Pública';
    let bestStreetDist = Infinity;
    let closestStreet: MetricStreetEntity | undefined;
    const vertices = buildLotVertices(lot.ring);

    for (const st of metricStreets) {
      for (let i = 0; i < st.path.length - 1; i++) {
        const d = pointToSegmentDist(lot.centroid, st.path[i], st.path[i + 1]);
        if (d < bestStreetDist) {
          bestStreetDist = d;
          frontStreetName = st.name;
          closestStreet = st;
        }
      }
    }

    let bestFrontEdgeM = 0;
    if (closestStreet) {
      let minEdgeDist = Infinity;
      for (let k = 0; k < lot.ring.length - 1; k++) {
        const pA = lot.ring[k];
        const pB = lot.ring[k + 1];
        const mid: [number, number] = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2];
        for (let i = 0; i < closestStreet.path.length - 1; i++) {
          const edgeDist = pointToSegmentDist(mid, closestStreet.path[i], closestStreet.path[i + 1]);
          if (edgeDist < minEdgeDist) {
            minEdgeDist = edgeDist;
            bestFrontEdgeM = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
          }
        }
      }
    }

    const fallbackFront = vertices[0]?.distanceM ?? Math.max(1, lot.bbox[2] - lot.bbox[0]);
    const frontM = lot.frontM && lot.frontM > 0 ? lot.frontM : bestFrontEdgeM > 0 ? bestFrontEdgeM : fallbackFront;
    const depthM = lot.depthM && lot.depthM > 0 ? lot.depthM : lot.areaM2 / Math.max(0.5, frontM);

    return {
      id: lot.id,
      code: lot.code,
      manzanoCode: parentMzn?.code ?? 'S/N',
      manzanoBBox: parentMzn?.bbox ?? lot.bbox,
      areaM2: lot.areaM2,
      perimeterM: lot.perimeterM,
      frontM,
      depthM,
      ring: lot.ring,
      centroid: lot.centroid,
      centroidLonLat,
      bboxMetric: lot.bbox,
      vertices,
      frontStreetName,
      featureAttributes: lot.attributes,
      isDemo: !hasRealGeometry,
    };
  });

  // Ordenar lotes por Manzano y luego código numérico/alfabético
  lotsCatalog.sort((a, b) => {
    const mCmp = a.manzanoCode.localeCompare(b.manzanoCode, 'es', { numeric: true });
    if (mCmp !== 0) return mCmp;
    return a.code.localeCompare(b.code, 'es', { numeric: true });
  });

  let streetAreaM2 = 0;
  let totalStreetLengthM = 0;
  for (const s of metricStreets) {
    totalStreetLengthM += s.lengthM;
    streetAreaM2 += s.lengthM * s.widthM;
  }

  const totalAreaM2 = perimetroAreaM2 > 0 ? perimetroAreaM2 : manzanoAreaM2 + lotAreaM2 + streetAreaM2;

  const legend: LegendEntry[] = [];
  if (allPerimetros.length > 0) {
    legend.push({ label: 'Perímetro de Intervención', color: allPerimetros[0].color, kind: 'polygon', count: allPerimetros.length });
  }
  if (allManzanos.length > 0) {
    legend.push({ label: 'Manzanos Urbanos', color: allManzanos[0].color, kind: 'polygon', count: allManzanos.length });
  }
  if (allLots.length > 0) {
    legend.push({ label: 'Lotes Catastrales', color: allLots[0].color, kind: 'polygon', count: allLots.length });
  }
  if (metricStreets.length > 0) {
    legend.push({ label: 'Red Vial (Calzada y Aceras)', color: metricStreets[0].color, kind: 'street', count: metricStreets.length });
  }
  if (metricRoundabouts.length > 0) {
    legend.push({ label: 'Rotondas', color: metricRoundabouts[0].color, kind: 'roundabout', count: metricRoundabouts.length });
  }
  if (lines.length > 0) {
    legend.push({ label: 'Líneas / Ejes', color: lines[0].color, kind: 'line', count: lines.length });
  }
  if (points.length > 0) {
    legend.push({ label: 'Puntos Geodésicos', color: points[0].color, kind: 'point', count: points.length });
  }

  const epsgNum = (utmHemisphere === 'N' ? 32600 : 32700) + utmZone;
  const epsgCode = crsMode === 'utm' ? `EPSG:${epsgNum}` : 'PLANO LOCAL';
  const crsLabel =
    crsMode === 'utm'
      ? `WGS 84 / UTM Zona ${utmZone}${utmHemisphere} (${epsgCode})`
      : 'Sistema Cartesiano Métrico Local (m)';

  return {
    hasRealGeometry,
    bboxMetric: [minX, minY, maxX, maxY],
    centroidLonLat,
    centroidMetric: [(minX + maxX) / 2, (minY + maxY) / 2],
    polygons,
    lines,
    points,
    streets: metricStreets,
    roundabouts: metricRoundabouts,
    lotsCatalog,
    totalAreaM2,
    manzanoAreaM2,
    lotAreaM2,
    streetAreaM2,
    totalStreetLengthM,
    manzanoCount: allManzanos.length,
    lotCount: allLots.length,
    streetCount: metricStreets.length,
    manzanoRows,
    legend,
    crsLabel,
    epsgCode,
  };
}
