import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';
import VectorSource from 'ol/source/Vector.js';
import { transform } from 'ol/proj.js';
import { DISPLAY_PROJECTION, GEOGRAPHIC_PROJECTION } from './projections';
import { useProjectCrsStore } from '../store/projectCrsStore';
import { ensureUtmZoneRegistered } from './utmZones';

export type SegmentMetric = {
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

/* ================================================================
   PLANO MÉTRICO DEL PROYECTO
   ================================================================
   Antes, área/perímetro/longitudes se calculaban con Turf sobre
   WGS84 (área geodésica real sobre el elipsoide). Eso NO coincide
   con lo que un CAD/GIS calcula al abrir el DXF exportado: ese
   archivo está en un plano proyectado (UTM, o local en modo "none"),
   sin curvatura, y cualquier programa hace un shoelace/euclídeo
   plano sobre esas coordenadas.

   Para que "lo que ve GeoUrban" == "lo que mide AutoCAD/QGIS sobre
   el DXF exportado", reproyectamos cada anillo/línea EXACTAMENTE al
   mismo plano que usa exportDxf() (io/dxf.ts) antes de medir:
     - modo 'utm'  -> UTM zone/hemisferio configurados (mismo EPSG)
     - modo 'none' -> plano local equirectangular (mismo criterio,
                      aunque anclado al centroide de cada feature en
                      vez de a la vista actual, para no crear un
                      import circular metrics.ts -> mapStore.ts ->
                      metrics.ts; la escala por latitud que introduce
                      esa diferencia de anclaje es del orden de 1e-5
                      relativo, irrelevante para área/longitud ya que
                      son invariantes a traslación).
   ================================================================ */

function projectRingToMetricPlane(ring3857: number[][]): [number, number][] {
  const crs = useProjectCrsStore.getState();

  if (crs.mode === 'utm') {
    const epsg = ensureUtmZoneRegistered(crs.utmZone, crs.utmHemisphere);
    return ring3857.map((c) => transform(c, DISPLAY_PROJECTION, epsg) as [number, number]);
  }

  const lonLat = ring3857.map((c) => transform(c, DISPLAY_PROJECTION, GEOGRAPHIC_PROJECTION));
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

function planarArea(ringMetric: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < ringMetric.length - 1; i++) {
    const [x1, y1] = ringMetric[i];
    const [x2, y2] = ringMetric[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function planarPathLength(coordsMetric: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < coordsMetric.length - 1; i++) {
    total += Math.hypot(
      coordsMetric[i + 1][0] - coordsMetric[i][0],
      coordsMetric[i + 1][1] - coordsMetric[i][1]
    );
  }
  return total;
}

function normalizeTextAngle(angleRad: number) {
  if (angleRad > Math.PI / 2 || angleRad < -Math.PI / 2) {
    return angleRad + Math.PI;
  }
  return angleRad;
}

function getSegmentMetrics(
  coords3857: [number, number][],
  coordsMetric: [number, number][]
): SegmentMetric[] {
  const segments: SegmentMetric[] = [];
  for (let i = 0; i < coords3857.length - 1; i++) {
    const start3857 = coords3857[i];
    const finish3857 = coords3857[i + 1];
    if (!start3857 || !finish3857) continue;

    const lengthM = Math.hypot(
      coordsMetric[i + 1][0] - coordsMetric[i][0],
      coordsMetric[i + 1][1] - coordsMetric[i][1]
    );
    if (!Number.isFinite(lengthM) || lengthM <= 0) continue;

    const dx = finish3857[0] - start3857[0];
    const dy = finish3857[1] - start3857[1];

    segments.push({
      midpoint: [(start3857[0] + finish3857[0]) / 2, (start3857[1] + finish3857[1]) / 2],
      lengthM,
      angleRad: normalizeTextAngle(Math.atan2(dy, dx)),
    });
  }
  return segments;
}

function calculatePolygonMetrics(geometry: Polygon): FeatureMetrics {
  const ring3857 = geometry.getCoordinates()[0] as [number, number][];
  if (!ring3857 || ring3857.length < 3) {
    throw new Error('Geometría de polígono inválida para métricas');
  }

  const ringMetric = projectRingToMetricPlane(ring3857);
  const areaM2 = planarArea(ringMetric);
  const perimeterM = planarPathLength(ringMetric);

  // Centroide simple (promedio de vértices, sin el cierre duplicado) en
  // EPSG:3857 — solo posiciona la etiqueta en el mapa, no participa del
  // cálculo de área/perímetro (por eso no necesita ser el centroide de
  // área real).
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
  const lengthM = planarPathLength(coordsMetric);

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