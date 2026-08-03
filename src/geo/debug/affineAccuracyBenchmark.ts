// src/geo/debug/affineAccuracyBenchmark.ts
//
// Fase 5.4 (auditoria-para-mejora.md) — "Validación de error acumulado":
// confirma que el error de la linealización afín+cuadrática (Fase 5,
// hardening) se mantiene dentro del margen de seguridad
// (MAX_ACCEPTABLE_ERROR_M) comparando, vértice por vértice, la matriz
// contra la transformación de referencia:
//   • modo 'utm'  → proj4 completo (transform(), sin aproximar).
//   • modo 'none' → fórmula esférica exacta de Mercator.
//
// Fase 5 (hardening, 2-ago-2026): este benchmark computa la matriz de
// forma STANDALONE (computeMetricPlaneAffineStandalone) — ya NO llama
// invalidateAffineCache()/getMetricPlaneAffine(), que antes contaminaban
// el caché en vivo y la telemetría de producción con datos sintéticos
// (síntoma observado: "refits=3 reuses=0" + "err=48.50m" en el panel de
// debug, mezclando el estado real de la sesión con esta suite). También
// genera el dataset sintético centrado en una ubicación real dentro de la
// zona UTM bajo prueba (antes usaba el origen (0,0) = "null island",
// miles de km fuera de cualquier zona UTM real, lo que inflaba el error
// medido sin que fuera un defecto del motor).

import { transform, fromLonLat } from 'ol/proj.js';
import type { Extent } from 'ol/extent.js';
import type { FeatureCollection } from 'geojson';
import { generateSyntheticManzanos } from './syntheticDataset';
import {
  computeMetricPlaneAffineStandalone,
  LOCAL_TANGENT_PLANE_KEY,
  MAX_ACCEPTABLE_ERROR_M,
} from '../crs/affineCache';
import { applyAffine, extentOfPoints, referenceLocalTangentPoint } from '../crs/affineApprox';
import { ensureUtmZoneRegistered } from '../crs/utmZones';
import { DISPLAY_PROJECTION } from '../crs/projections';

/** Umbral informativo (no bloqueante). */
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
  /** maxErrorM < MAX_ACCEPTABLE_ERROR_M (1cm) — el criterio real que ya aplica affineCache.ts. */
  withinAcceptableError: boolean;
  /** maxErrorM < 1mm — informativo. */
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

/** Parsea un EPSG UTM (326xx/327xx) y garantiza que proj4 lo tenga registrado. No-op para EPSGs no-UTM. */
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

function runOne(
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

  // Standalone: nunca toca el caché en vivo ni la telemetría de producción.
  const fitResult = computeMetricPlaneAffineStandalone(key, extentHint);
  const affine = fitResult.transform;
  const fitExtent = fitResult.extent;

  let maxErrorM = 0;
  let sumErrorM = 0;
  const errors = new Array<number>(vertices.length);

  for (let i = 0; i < vertices.length; i++) {
    const approx = applyAffine(vertices[i], affine);
    const exact = referenceFn(vertices[i], fitExtent);
    const err = Math.hypot(approx[0] - exact[0], approx[1] - exact[1]);
    errors[i] = err;
    sumErrorM += err;
    if (err > maxErrorM) maxErrorM = err;
  }
  errors.sort((a, b) => a - b);

  const [minX, minY, maxX, maxY] = extent;
  const elapsedMs = performance.now() - t0;

  return {
    label,
    key,
    datasetSize,
    vertexCount: vertices.length,
    maxErrorM,
    avgErrorM: vertices.length > 0 ? sumErrorM / vertices.length : 0,
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
 * Corre la validación de error acumulado para AMBOS modos de CRS sobre
 * varios tamaños del dataset sintético. `centerLonLat` ancla el dataset a
 * una ubicación real (default: La Paz, misma zona que `EPSG:32719` y el
 * centro default de la app en `mapStore.ts`) — antes se generaba en el
 * origen (0,0), fuera de cualquier zona UTM real, lo que medía distorsión
 * espuria en vez de precisión del motor.
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
      results.push(
        runOne(epsg, epsg, size, (pt) => transform(pt, DISPLAY_PROJECTION, epsg) as [number, number], center),
      );
    }
  }

  for (const size of sizes) {
    results.push(
      runOne('Plano local', LOCAL_TANGENT_PLANE_KEY, size, (pt, fitExtent) =>
        referenceLocalTangentPoint(pt, fitExtent), center),
    );
  }

  return results;
}