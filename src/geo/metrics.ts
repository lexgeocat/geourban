import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';
import VectorSource from 'ol/source/Vector.js';
import { transform } from 'ol/proj.js';
import { DISPLAY_PROJECTION, GEOGRAPHIC_PROJECTION } from './crs/projections';
import { useProjectCrsStore } from '../store/project/projectCrsStore';
import { ensureUtmZoneRegistered } from './crs/utmZones';
import { pathLength } from './math/polygonEngine';

export type SegmentMetric = {
  /** Punto inicial del lado lógico (mismas unidades que la geometría, ej. EPSG:3857). */
  p0: [number, number];
  /** Punto final del lado lógico. */
  p1: [number, number];
  midpoint: [number, number];
  lengthM: number;
  angleRad: number;
};

export type FeatureMetrics = {
  areaM2?: number;
  perimeterM?: number;
  lengthM?: number;
  segmentLengths: SegmentMetric[];
  labelPoint?: [number, number];
  metricsUpdatedAt: number;
};

export function projectPathToMetricPlane(path3857: Array<[number, number]>): [number, number][] {
  const crs = useProjectCrsStore.getState();

  if (crs.mode === 'utm') {
    const epsg = ensureUtmZoneRegistered(crs.utmZone, crs.utmHemisphere);
    return path3857.map((c) => transform(c, DISPLAY_PROJECTION, epsg) as [number, number]);
  }

  const lonLat = path3857.map((c) => transform(c, DISPLAY_PROJECTION, GEOGRAPHIC_PROJECTION));
  let sumLon = 0, sumLat = 0;
  for (const c of lonLat) { sumLon += c[0]; sumLat += c[1]; }
  const centerLon = sumLon / lonLat.length;
  const centerLat = sumLat / lonLat.length;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  return lonLat.map((c) => [
    (c[0] - centerLon) * mPerDegLon,
    (c[1] - centerLat) * mPerDegLat,
  ] as [number, number]);
}

function projectRingToMetricPlane(ring3857: number[][]): [number, number][] {
  return projectPathToMetricPlane(ring3857 as Array<[number, number]>);
}

function planarArea(ringMetric: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ringMetric.length - 1; i++) {
    const [x1, y1] = ringMetric[i];
    const [x2, y2] = ringMetric[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function normalizeTextAngle(angleRad: number) {
  if (angleRad > Math.PI / 2 || angleRad < -Math.PI / 2) {
    return angleRad + Math.PI;
  }
  return angleRad;
}

const ARC_MERGE_BREAK_RAD = (12 * Math.PI) / 180;
/** Tope de seguridad: nunca fusionar más de N aristas crudas en un lado. */
const ARC_MERGE_MAX_RUN = 48;

function getSegmentMetrics(
  coords3857: [number, number][],
  coordsMetric: [number, number][]
): SegmentMetric[] {
  const n = Math.min(coords3857.length, coordsMetric.length);
  if (n < 2) return [];

  const edgeCount = n - 1;
  const edgeLenM = new Array<number>(edgeCount);
  const dirX = new Array<number>(edgeCount);
  const dirY = new Array<number>(edgeCount);

  for (let i = 0; i < edgeCount; i++) {
    const a3 = coords3857[i], b3 = coords3857[i + 1];
    const aM = coordsMetric[i], bM = coordsMetric[i + 1];
    if (!a3 || !b3 || !aM || !bM) {
      edgeLenM[i] = 0;
      dirX[i] = 0;
      dirY[i] = 0;
      continue;
    }
    edgeLenM[i] = Math.hypot(bM[0] - aM[0], bM[1] - aM[1]);
    const dx = b3[0] - a3[0];
    const dy = b3[1] - a3[1];
    const len = Math.hypot(dx, dy) || 1;
    dirX[i] = dx / len;
    dirY[i] = dy / len;
  }

  const segments: SegmentMetric[] = [];

  const flushRun = (runStart: number, runEndVertex: number) => {
    const start3857 = coords3857[runStart];
    const finish3857 = coords3857[runEndVertex];
    if (!start3857 || !finish3857) return;

    let lengthM = 0;
    for (let k = runStart; k < runEndVertex; k++) lengthM += edgeLenM[k];
    if (!Number.isFinite(lengthM) || lengthM <= 0) return;

    const dx = finish3857[0] - start3857[0];
    const dy = finish3857[1] - start3857[1];

    segments.push({
      p0: [start3857[0], start3857[1]],
      p1: [finish3857[0], finish3857[1]],
      midpoint: [(start3857[0] + finish3857[0]) / 2, (start3857[1] + finish3857[1]) / 2],
      lengthM,
      angleRad: normalizeTextAngle(Math.atan2(dy, dx)),
    });
  };

  let runStart = 0;
  for (let i = 1; i < edgeCount; i++) {
    const dot = Math.max(-1, Math.min(1, dirX[i - 1] * dirX[i] + dirY[i - 1] * dirY[i]));
    const turn = Math.acos(dot);
    const runLen = i - runStart;
    const isBreak = !Number.isFinite(turn) || turn > ARC_MERGE_BREAK_RAD || runLen >= ARC_MERGE_MAX_RUN;
    if (isBreak) {
      flushRun(runStart, i);
      runStart = i;
    }
  }
  flushRun(runStart, edgeCount);

  return segments;
}

function calculatePolygonMetrics(geometry: Polygon): FeatureMetrics {
  const ring3857 = geometry.getCoordinates()[0] as [number, number][];
  if (!ring3857 || ring3857.length < 3) {
    throw new Error('Geometría de polígono inválida para métricas');
  }

  const ringMetric = projectRingToMetricPlane(ring3857);
  const areaM2 = planarArea(ringMetric);
  const perimeterM = pathLength(ringMetric);

  let cx = 0, cy = 0;
  const vertexCount = ring3857.length - 1;
  for (let i = 0; i < vertexCount; i++) {
    cx += ring3857[i][0];
    cy += ring3857[i][1];
  }

  return {
    areaM2,
    perimeterM,
    segmentLengths: getSegmentMetrics(ring3857, ringMetric),
    labelPoint: [cx / vertexCount, cy / vertexCount],
    metricsUpdatedAt: Date.now(),
  };
}

function calculateLineMetrics(geometry: LineString): FeatureMetrics {
  const coords3857 = geometry.getCoordinates() as [number, number][];
  if (!coords3857 || coords3857.length < 2) {
    throw new Error('Geometría de línea inválida para métricas');
  }

  const coordsMetric = projectRingToMetricPlane(coords3857);
  const lengthM = pathLength(coordsMetric);

  const halfLength = lengthM / 2;
  let accumulated = 0;
  let labelPoint: [number, number] = coords3857[0];
  for (let i = 0; i < coordsMetric.length - 1; i++) {
    const segLen = Math.hypot(
      coordsMetric[i + 1][0] - coordsMetric[i][0],
      coordsMetric[i + 1][1] - coordsMetric[i][1]
    );
    if (accumulated + segLen >= halfLength) {
      const t = segLen > 1e-9 ? (halfLength - accumulated) / segLen : 0;
      labelPoint = [
        coords3857[i][0] + (coords3857[i + 1][0] - coords3857[i][0]) * t,
        coords3857[i][1] + (coords3857[i + 1][1] - coords3857[i][1]) * t,
      ];
      break;
    }
    accumulated += segLen;
    labelPoint = coords3857[i + 1];
  }

  return {
    lengthM,
    segmentLengths: getSegmentMetrics(coords3857, coordsMetric),
    labelPoint,
    metricsUpdatedAt: Date.now(),
  };
}

export function calculateFeatureMetrics(feature: Feature<Geometry>): FeatureMetrics | null {
  const geometry = feature.getGeometry();
  if (geometry instanceof Polygon) return calculatePolygonMetrics(geometry);
  if (geometry instanceof LineString) return calculateLineMetrics(geometry);
  return null;
}

export function updateFeatureMetrics(feature: Feature<Geometry>) {
  const metrics = calculateFeatureMetrics(feature);
  if (!metrics) return null;

  feature.setProperties(
    {
      areaM2: metrics.areaM2,
      perimeterM: metrics.perimeterM,
      lengthM: metrics.lengthM,
      segmentLengths: metrics.segmentLengths,
      labelPoint: metrics.labelPoint,
      metricsUpdatedAt: metrics.metricsUpdatedAt,
    },
    true
  );

  feature.changed();
  return metrics;
}

export function refreshSourceMetrics(source: VectorSource) {
  source.getFeatures().forEach((feature) => updateFeatureMetrics(feature as Feature<Geometry>));
  source.changed();
}

export type StreetPathLike = {
  start: [number, number];
  end: [number, number];
  waypoints?: Array<[number, number]>;
};

/**
 * Largo de una calle (eje) en metros sobre el plano métrico del proyecto
 * (UTM si está configurado, o tangente local con corrección por latitud si no).
 * Acepta waypoints intermedios: el camino recorrido es start → ...waypoints → end.
 */
export function streetLengthMetricM(street: StreetPathLike): number {
  const path: [number, number][] = [street.start, ...(street.waypoints ?? []), street.end];
  if (path.length < 2) return 0;
  const metricPath = projectPathToMetricPlane(path);
  return pathLength(metricPath);
}

export function formatMetricLength(valueM?: number) {
  if (!Number.isFinite(valueM)) return '';
  if ((valueM ?? 0) >= 1000) return `${((valueM ?? 0) / 1000).toFixed(2)} km`;
  return `${(valueM ?? 0).toFixed(2)} m`;
}

export function formatMetricArea(valueM2?: number) {
  if (!Number.isFinite(valueM2)) return '';
  if ((valueM2 ?? 0) >= 10000) return `${((valueM2 ?? 0) / 10000).toFixed(2)} ha`;
  return `${(valueM2 ?? 0).toFixed(2)} m²`;
}