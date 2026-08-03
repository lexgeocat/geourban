// src/geo/crs/affineCache.ts
import { containsExtent, buffer as bufferExtent, type Extent } from 'ol/extent.js';
import { fitAffineForExtent, IDENTITY_AFFINE, type AffineTransform } from './affineApprox';
import { recordAffineReuse, recordAffineRefit } from '../../store/debug/affineTelemetry';

/** Margen de error aceptado (5.4): a escala urbana (extents de hasta
 * decenas de km) la aproximación afín de una proyección conforme
 * (Mercator → UTM) da error residual sub-milimétrico; este umbral es
 * solo una alarma de diagnóstico, no bloquea el uso de la matriz. */
const MAX_ACCEPTABLE_ERROR_M = 0.01;

/** Padding relativo aplicado al extent objetivo antes de ajustar (Fase
 * 5.2, "hysteresis"): evita recalcular la matriz por cada feature nueva
 * que roza el borde de la región ya cubierta — el próximo refit solo
 * ocurre cuando el proyecto crece más allá de este margen, no en cada
 * edición individual. */
const PADDING_FACTOR = 0.35;
/** Padding mínimo absoluto (unidades de EPSG:3857 ≈ m) para extents
 * degenerados (un solo punto, o un trazo muy corto). */
const MIN_PADDING_M = 250;

interface CacheEntry {
  key: string;
  fitExtent: Extent;
  transform: AffineTransform;
  maxErrorM: number;
}

let currentEntry: CacheEntry | null = null;

function paddedExtent(extent: Extent): Extent {
  const w = extent[2] - extent[0];
  const h = extent[3] - extent[1];
  const pad = Math.max(MIN_PADDING_M, Math.max(w, h) * PADDING_FACTOR);
  return bufferExtent(extent, pad);
}

/**
 * Devuelve la matriz afín vigente para `dstEpsg` que cubre `extentHint`
 * (extent en EPSG:3857 del path/anillo a proyectar).
 *
 * Fase 5.2 — Invalidación de la matriz. Recalcula (refit, costoso: ~25
 * llamadas a proj4) únicamente si:
 *   1. cambió `dstEpsg` — la zona/hemisferio UTM ya está codificada en
 *      el string EPSG, así que un cambio de zona invalida por key
 *      mismatch sin lógica adicional; o
 *   2. `extentHint` no está contenido en la región para la que se
 *      ajustó la matriz vigente (el proyecto creció más allá del
 *      margen de padding con el que se calculó la última vez).
 *
 * En cualquier otro caso (la inmensa mayoría de las llamadas — cada
 * edición de geometría dentro del área ya cubierta) reutiliza la
 * matriz cacheada sin tocar proj4: el costo real se paga solo al
 * (re)ajustar, nunca por vértice ni por edición. `recordAffineReuse`/
 * `recordAffineRefit` alimentan el panel de debug para confirmar en
 * uso real que los refits son raros comparados con los reuses.
 */
export function getMetricPlaneAffine(dstEpsg: string, extentHint: Extent): AffineTransform {
  if (
    currentEntry &&
    currentEntry.key === dstEpsg &&
    containsExtent(currentEntry.fitExtent, extentHint)
  ) {
    recordAffineReuse(dstEpsg);
    return currentEntry.transform;
  }

  const fitExtent = paddedExtent(extentHint);
  const fit = fitAffineForExtent(fitExtent, dstEpsg);

  if (!fit) {
    // Extent degenerado (área ~0 incluso tras el padding — no debería
    // pasar dado MIN_PADDING_M, pero por robustez ante entradas
    // patológicas caemos a identidad en vez de propagar null.
    currentEntry = { key: dstEpsg, fitExtent, transform: IDENTITY_AFFINE, maxErrorM: Infinity };
    recordAffineRefit(dstEpsg, Infinity, fitExtent[2] - fitExtent[0], fitExtent[3] - fitExtent[1]);
    return IDENTITY_AFFINE;
  }

  if (fit.maxErrorM > MAX_ACCEPTABLE_ERROR_M) {
    console.warn(
      `affineCache: error residual de la aproximación afín (${fit.maxErrorM.toFixed(5)}m) ` +
      `supera el margen de seguridad (${MAX_ACCEPTABLE_ERROR_M}m) para el extent actual ` +
      `(${(fitExtent[2] - fitExtent[0]).toFixed(0)}x${(fitExtent[3] - fitExtent[1]).toFixed(0)}m). ` +
      'Se usa igual por ser la mejor aproximación lineal disponible; si esto se repite, ' +
      'revisar el tamaño del proyecto (la linealización afín asume escala urbana).',
    );
  }

  currentEntry = { key: dstEpsg, fitExtent, transform: fit.transform, maxErrorM: fit.maxErrorM };
  recordAffineRefit(
    dstEpsg,
    fit.maxErrorM,
    fitExtent[2] - fitExtent[0],
    fitExtent[3] - fitExtent[1],
  );
  return fit.transform;
}

/** Fuerza la invalidación del caché — llamar al cambiar explícitamente
 * la configuración de CRS del proyecto (zona/hemisferio UTM, modo). */
export function invalidateAffineCache(): void {
  currentEntry = null;
}

/** Solo para tests/depuración. */
export function _getAffineCacheEntryForTests(): Readonly<CacheEntry> | null {
  return currentEntry;
}