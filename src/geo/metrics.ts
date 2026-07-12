import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { area, length, lineString, polygon, along, centroid } from '@turf/turf';
import type {
  LineString as GeoJsonLineString,
  Polygon as GeoJsonPolygon,
} from 'geojson';
import { DISPLAY_PROJECTION, GEOGRAPHIC_PROJECTION } from './projections';

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

const geoJsonFormat = new GeoJSON();

function toGeoJsonGeometry(geometry: Geometry): GeoJsonPolygon | GeoJsonLineString | null {
  const geo = geoJsonFormat.writeGeometryObject(geometry, {
    featureProjection: DISPLAY_PROJECTION,
    dataProjection: GEOGRAPHIC_PROJECTION,
  });
  if (geo.type === 'Polygon' || geo.type === 'LineString') {
    return geo as GeoJsonPolygon | GeoJsonLineString;
  }
  return null;
}

function projectCoordinateToDisplay(coord: [number, number]): [number, number] {
  const projected = geoJsonFormat.readGeometry(
    { type: 'Point', coordinates: coord },
    { featureProjection: DISPLAY_PROJECTION, dataProjection: GEOGRAPHIC_PROJECTION }
  );
  const xy = (projected as import('ol/geom/Point.js').default).getCoordinates();
  return [xy[0], xy[1]];
}

function normalizeTextAngle(angleRad: number) {
  if (angleRad > Math.PI / 2 || angleRad < -Math.PI / 2) {
    return angleRad + Math.PI;
  }
  return angleRad;
}

function getSegmentMetricsFromRing(ring: [number, number][], closeRing = false): SegmentMetric[] {
  const end = closeRing ? ring.length - 1 : ring.length - 1;
  const segments: SegmentMetric[] = [];

  for (let i = 0; i < end; i++) {
    const start = ring[i];
    const finish = ring[i + 1];
    if (!start || !finish) continue;

    const startDisplay = projectCoordinateToDisplay(start);
    const finishDisplay = projectCoordinateToDisplay(finish);
    const dx = finishDisplay[0] - startDisplay[0];
    const dy = finishDisplay[1] - startDisplay[1];

    const segment = lineString([start, finish], { units: 'meters' });
    const lengthM = length(segment, { units: 'meters' });
    if (!Number.isFinite(lengthM) || lengthM <= 0) continue;

    const midpointDisplay: [number, number] = [
      (startDisplay[0] + finishDisplay[0]) / 2,
      (startDisplay[1] + finishDisplay[1]) / 2,
    ];

    segments.push({
      midpoint: midpointDisplay,
      lengthM,
      angleRad: normalizeTextAngle(Math.atan2(dy, dx)),
    });
  }

  return segments;
}

function calculatePolygonMetrics(geometry: Polygon): FeatureMetrics {
  const geo = toGeoJsonGeometry(geometry);
  if (!geo || geo.type !== 'Polygon') {
    throw new Error('Geometría de polígono inválida para métricas Turf');
  }

  const outerRing = geo.coordinates[0] as [number, number][];
  const areaM2 = Math.abs(area(polygon(geo.coordinates)));
  const perimeterM = length(lineString([...outerRing, outerRing[0]]), { units: 'meters' });
  const center = centroid(polygon(geo.coordinates));
  const labelCoord = center.geometry.coordinates as [number, number];

  return {
    areaM2,
    perimeterM,
    segmentLengths: getSegmentMetricsFromRing(outerRing, true),
    labelPoint: projectCoordinateToDisplay(labelCoord),
    metricsUpdatedAt: Date.now(),
  };
}

function calculateLineMetrics(geometry: LineString): FeatureMetrics {
  const geo = toGeoJsonGeometry(geometry);
  if (!geo || geo.type !== 'LineString') {
    throw new Error('Geometría de línea inválida para métricas Turf');
  }

  const coords = geo.coordinates as [number, number][];
  const line = lineString(coords);
  const lengthM = length(line, { units: 'meters' });
  const mid = along(line, lengthM / 2, { units: 'meters' });
  const labelCoord = mid.geometry.coordinates as [number, number];

  return {
    lengthM,
    segmentLengths: getSegmentMetricsFromRing(coords, false),
    labelPoint: projectCoordinateToDisplay(labelCoord),
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
  if ((valueM2 ?? 0) >= 10000) return `${((valueM2 ?? 0) / 10000).toFixed(4)} ha`;
  return `${(valueM2 ?? 0).toFixed(2)} m²`;
}


