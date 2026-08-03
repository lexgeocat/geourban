// src/geo/crs/affineCache.ts
import { containsExtent, buffer as bufferExtent, type Extent } from 'ol/extent.js';
import { fitAffineForExtent, fitLocalTangentPlane, IDENTITY_AFFINE, type AffineTransform, type AffineFitResult } from './affineApprox';
import { recordAffineReuse, recordAffineRefit, recordAffineDegraded } from '../../store/debug/affineTelemetry';

/** Margen de error aceptado — alarma de diagnóstico, no bloquea el uso de la matriz. */
export const MAX_ACCEPTABLE_ERROR_M = 0.01;

/** Padding relativo (Fase 5.2, "hysteresis") aplicado al extent objetivo antes de ajustar. */
const PADDING_FACTOR = 0.35;
const MIN_PADDING_M = 250;

/** Fase 5 (hardening) — si el primer ajuste (afín + corrección cuadrática)
 * sigue superando MAX_ACCEPTABLE_ERROR_M, se reintenta con menos padding
 * (región más chica ⇒ menos curvatura que absorber) hasta este piso. */
const MIN_RETRY_PADDING_FACTOR = 0.02;
/** Techo de reintentos de padding — evita loops largos ante geometría patológica. */
const MAX_PADDING_RETRIES = 4;

/**
 * Key sentinel para el modo CRS 'none' (dibujo libre, sin EPSG real).
 * `getMetricPlaneAffine` la reconoce y ajusta un plano tangente local en
 * forma cerrada en vez de pedirle a proj4 una proyección real.
 */
export const LOCAL_TANGENT_PLANE_KEY = '__local-tangent-plane__';

interface CacheEntry {
  key: string;
  fitExtent: Extent;
  transform: AffineTransform;
  maxErrorM: number;
}

let currentEntry: CacheEntry | null = null;

function paddedExtent(extent: Extent, factor: number = PADDING_FACTOR): Extent {
  const w = extent[2] - extent[0];
  const h = extent[3] - extent[1];
  const pad = Math.max(MIN_PADDING_M, Math.max(w, h) * factor);
  return bufferExtent(extent, pad);
}

function fitForKey(key: string, fitExtent: Extent): AffineFitResult | null {
  return key === LOCAL_TANGENT_PLANE_KEY
    ? fitLocalTangentPlane(fitExtent)
    : fitAffineForExtent(fitExtent, key);
}

/**
 * Devuelve la matriz afín (+corrección cuadrática) vigente para `key` que
 * cubre `extentHint`. Reutiliza la matriz cacheada salvo que cambie `key`
 * o el extent crezca más allá del margen de padding vigente (Fase 5.2).
 *
 * Fase 5 (hardening): si el ajuste resultante sigue superando
 * MAX_ACCEPTABLE_ERROR_M incluso con la corrección cuadrática, reintenta
 * con menos padding (más refits, pero corrección real) antes de resignarse
 * a advertir y usar el mejor ajuste disponible — evita el caso observado
 * en producción (padding grande + extent lejos del centro de ajuste ⇒
 * decenas de metros de error silenciados por un solo `console.warn`).
 */
export function getMetricPlaneAffine(key: string, extentHint: Extent): AffineTransform {
  if (
    currentEntry &&
    currentEntry.key === key &&
    containsExtent(currentEntry.fitExtent, extentHint)
  ) {
    recordAffineReuse(key);
    return currentEntry.transform;
  }

  let paddingFactor = PADDING_FACTOR;
  let fitExtent = paddedExtent(extentHint, paddingFactor);
  let fit = fitForKey(key, fitExtent);
  let retries = 0;

  while (
    fit &&
    fit.maxErrorM > MAX_ACCEPTABLE_ERROR_M &&
    paddingFactor > MIN_RETRY_PADDING_FACTOR &&
    retries < MAX_PADDING_RETRIES
  ) {
    paddingFactor /= 2;
    fitExtent = paddedExtent(extentHint, paddingFactor);
    fit = fitForKey(key, fitExtent);
    retries++;
  }

  if (!fit) {
    currentEntry = { key, fitExtent, transform: IDENTITY_AFFINE, maxErrorM: Infinity };
    recordAffineRefit(key, Infinity, fitExtent[2] - fitExtent[0], fitExtent[3] - fitExtent[1]);
    return IDENTITY_AFFINE;
  }

  if (fit.maxErrorM > MAX_ACCEPTABLE_ERROR_M) {
    recordAffineDegraded(key);
    console.warn(
      `affineCache: error residual de la aproximación afín+cuadrática (${fit.maxErrorM.toFixed(3)}m) ` +
      `sigue por encima del margen de seguridad (${MAX_ACCEPTABLE_ERROR_M}m) tras ${retries} reintento(s) de padding ` +
      `para el extent actual (${(fitExtent[2] - fitExtent[0]).toFixed(0)}x${(fitExtent[3] - fitExtent[1]).toFixed(0)}m). ` +
      'Se usa igual por ser la mejor aproximación disponible; si esto se repite, revisar el tamaño del proyecto ' +
      'o la zona UTM configurada (la linealización asume escala urbana).',
    );
  }

  currentEntry = { key, fitExtent, transform: fit.transform, maxErrorM: fit.maxErrorM };
  recordAffineRefit(key, fit.maxErrorM, fitExtent[2] - fitExtent[0], fitExtent[3] - fitExtent[1]);
  return fit.transform;
}

/**
 * Fase 5.4 (hardening) — variante PURA para benchmarking/validación: computa
 * la matriz para `key`/`extentHint` SIN tocar el caché en vivo
 * (`currentEntry`) ni la telemetría de producción (`affineTelemetry.ts`).
 * Antes, los benchmarks llamaban `invalidateAffineCache()` +
 * `getMetricPlaneAffine()`, lo que contaminaba el estado real de la sesión
 * (refits/reuses y errores de un dataset sintético mezclados con el uso
 * real de la app). El hot path real de la app debe seguir usando
 * `getMetricPlaneAffine`.
 */
export function computeMetricPlaneAffineStandalone(key: string, extentHint: Extent): AffineFitResult {
  const fitExtent = paddedExtent(extentHint);
  const fit = fitForKey(key, fitExtent);
  if (!fit) {
    return { transform: IDENTITY_AFFINE, maxErrorM: Infinity, extent: fitExtent };
  }
  return fit;
}

/** Fuerza la invalidación del caché — llamar al cambiar explícitamente la configuración de CRS del proyecto. */
export function invalidateAffineCache(): void {
  currentEntry = null;
}

/** Extent (con padding aplicado) sobre el que se ajustó la matriz vigente. */
export function getCurrentFitExtent(): Extent | null {
  return currentEntry?.fitExtent ?? null;
}

/** Solo para tests/depuración. */
export function _getAffineCacheEntryForTests(): Readonly<CacheEntry> | null {
  return currentEntry;
}