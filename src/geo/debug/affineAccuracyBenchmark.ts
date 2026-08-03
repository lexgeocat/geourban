// src/geo/debug/affineAccuracyBenchmark.ts
//
// Fase 5.4 robustecida — valida el camino REAL que usa producción para
// cada modo: 'utm' vía `TiledAffineCache` (mosaico), 'none' vía
// `computeMetricPlaneAffineStandalone` (plano local, sin cambios — nunca
// tuvo el bug de extent-único que sí tenía UTM). Instancias aisladas:
// nunca tocan el caché en vivo (`utmTileCache`/`currentEntry`) ni la
// telemetría de producción.

import { transform, fromLonLat } from 'ol/proj.js';
import type { Extent } from 'ol/extent.js';
import type { FeatureCollection } from 'geojson';
import { generateSyntheticManzanos } from './syntheticDataset';
import {
  TiledAffineCache,
  computeMetricPlaneAffineStandalone,
  LOCAL_TANGENT_PLANE_KEY,
  MAX_ACCEPTABLE_ERROR_M,
} from '../crs/affineCache';
import { applyAffine, extentOfPoints, referenceLocalTangentPoint } from '../crs/affineApprox';
import { ensureUtmZoneRegistered } from '../crs/utmZones';
import { DISPLAY_PROJECTION } from '../crs/projections';

const SUB_MM_INFO_THRESHOLD_M = 0.001;

export interface AffineAccuracyResult {
  label: string;
  key: string;
  datasetSize: number;
  vertexCount: number;
  maxErrorM: number;
  avgErrorM: number;
  p95ErrorM: number;
  p99ErrorM: number;
  extentWidthKm: number;
  extentHeightKm: number;
  elapsedMs: number;
  withinAcceptableError: boolean;
  subMillimeter: boolean;
}

function collectVertices(collection: FeatureCollection): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (const f of collection.features) {
    const geom = f.geometry;
    if (!geom || geom.type !== 'Polygon') continue;
    for (const ring of geom.coordinates) {
      for (const c of ring) pts.push([c[0], c[1]]);
    }
  }
  return pts;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx];
}

function ensureEpsgRegistered(epsg: string): void {
  const m = /^EPSG:(\d+)$/.exec(epsg);
  if (!m) return;
  const code = parseInt(m[1], 10);
  if (code >= 32601 && code <= 32660) {
    ensureUtmZoneRegistered(code - 32600, 'N');
  } else if (code >= 32701 && code <= 32760) {
    ensureUtmZoneRegistered(code - 32700, 'S');
  }
}

function buildResult(
  label: string,
  key: string,
  datasetSize: number,
  vertexCount: number,
  errors: number[],
  extent: Extent,
  elapsedMs: number,
): AffineAccuracyResult {
  errors.sort((a, b) => a - b);
  const sum = errors.reduce((a, b) => a + b, 0);
  const maxErrorM = errors.length > 0 ? errors[errors.length - 1] : 0;
  const [minX, minY, maxX, maxY] = extent;
  return {
    label,
    key,
    datasetSize,
    vertexCount,
    maxErrorM,
    avgErrorM: vertexCount > 0 ? sum / vertexCount : 0,
    p95ErrorM: percentile(errors, 0.95),
    p99ErrorM: percentile(errors, 0.99),
    extentWidthKm: (maxX - minX) / 1000,
    extentHeightKm: (maxY - minY) / 1000,
    elapsedMs,
    withinAcceptableError: maxErrorM < MAX_ACCEPTABLE_ERROR_M,
    subMillimeter: maxErrorM < SUB_MM_INFO_THRESHOLD_M,
  };
}

/**
 * Valida el camino REAL de producción para modo 'utm': el mosaico de
 * tiles, comparado punto a punto contra proj4 completo (referencia
 * global fija, no depende del extent — a diferencia del plano local).
 */
function runUtmTiled(epsg: string, datasetSize: number, center: [number, number]): AffineAccuracyResult {
  const t0 = performance.now();
  const { collection, extent } = generateSyntheticManzanos(datasetSize, center);
  const vertices = collectVertices(collection);

  const cache = new TiledAffineCache({ telemetry: false });
  const errors = new Array<number>(vertices.length);
  for (let i = 0; i < vertices.length; i++) {
    const approx = cache.applyPoint(epsg, vertices[i]);
    const exact = transform(vertices[i], DISPLAY_PROJECTION, epsg) as [number, number];
    errors[i] = Math.hypot(approx[0] - exact[0], approx[1] - exact[1]);
  }

  return buildResult(epsg, epsg, datasetSize, vertices.length, errors, extent as Extent, performance.now() - t0);
}

/** Modo 'none' (plano local) — sin cambios: ya era preciso a cualquier escala medida. */
function runLocalPlane(
  label: string,
  key: string,
  datasetSize: number,
  referenceFn: (pt: [number, number], fitExtent: Extent) => [number, number],
  center: [number, number],
): AffineAccuracyResult {
  const t0 = performance.now();
  const { collection, extent } = generateSyntheticManzanos(datasetSize, center);
  const vertices = collectVertices(collection);
  const extentHint = vertices.length > 0 ? extentOfPoints(vertices) : (extent as Extent);

  const fitResult = computeMetricPlaneAffineStandalone(key, extentHint);
  const affine = fitResult.transform;
  const fitExtent = fitResult.extent;

  const errors = new Array<number>(vertices.length);
  for (let i = 0; i < vertices.length; i++) {
    const approx = applyAffine(vertices[i], affine);
    const exact = referenceFn(vertices[i], fitExtent);
    errors[i] = Math.hypot(approx[0] - exact[0], approx[1] - exact[1]);
  }

  return buildResult(label, key, datasetSize, vertices.length, errors, extent as Extent, performance.now() - t0);
}

/**
 * Corre la validación de error acumulado para AMBOS modos de CRS sobre
 * varios tamaños del dataset sintético, anclado a una ubicación real
 * (default: La Paz, misma zona que `EPSG:32719` y el centro default de
 * la app en `mapStore.ts`).
 */
export function runAffineAccuracySuite(
  sizes: number[] = [1_000, 10_000, 100_000],
  utmEpsgList: string[] = ['EPSG:32719'],
  centerLonLat: [number, number] = [-68.3, -16.65],
): AffineAccuracyResult[] {
  const center = fromLonLat(centerLonLat) as [number, number];
  const results: AffineAccuracyResult[] = [];

  for (const epsg of utmEpsgList) {
    ensureEpsgRegistered(epsg);
    for (const size of sizes) {
      results.push(runUtmTiled(epsg, size, center));
    }
  }

  for (const size of sizes) {
    results.push(
      runLocalPlane('Plano local', LOCAL_TANGENT_PLANE_KEY, size, (pt, fitExtent) =>
        referenceLocalTangentPoint(pt, fitExtent), center),
    );
  }

  return results;
}