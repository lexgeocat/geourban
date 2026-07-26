// src/geo/lod.ts
import type Geometry from 'ol/geom/Geometry.js';

/**
 * Utilidades de "level of detail" (H18 — Fase 6).
 *
 * El costo real no está en las geometrías que dibuja el usuario (esas se
 * guardan tal cual; no corresponde alterarlas) sino en geometrías
 * SINTÉTICAS que el motor regenera en cada frame de postrender — hoy,
 * los anillos de las rotondas (`roundaboutEngine.ts`), teselados sin
 * saber nada del zoom vigente.
 *
 * `resolutionAwareSegments()` calcula cuántos segmentos hacen falta para
 * que el error de tesselación (la "flecha"/sagitta del arco) se
 * mantenga por debajo de ~1-2px en la resolución actual, en vez del
 * criterio fijo "más radio = más segmentos".
 */

const MIN_SEGMENTS = 8;
const MAX_SEGMENTS = 160;

export function resolutionAwareSegments(
  radiusMapUnits: number,
  resolution: number,
  pxError = 1.5,
): number {
  if (!(radiusMapUnits > 0) || !(resolution > 0)) return MIN_SEGMENTS;
  const errorMapUnits = pxError * resolution;
  // sagitta ≈ r * (1 - cos(θ/2))  ⇒  despejamos el ángulo máximo por segmento.
  const ratio = Math.min(1, errorMapUnits / radiusMapUnits);
  const maxAngle = 2 * Math.acos(1 - ratio);
  if (!(maxAngle > 0) || !isFinite(maxAngle)) return MAX_SEGMENTS;
  const needed = Math.ceil((2 * Math.PI) / maxAngle);
  return Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, needed));
}

/**
 * Caché de geometrías simplificadas por (id de feature, bucket de
 * resolución) — utilidad general para cuando algún consumidor futuro
 * necesite una versión más liviana de una geometría pesada (p.ej. un
 * polígono importado de DXF/KML con miles de vértices) para cómputo,
 * SIN alterar la geometría real guardada en el proyecto. No está
 * conectada a ningún call-site todavía (el render WebGL actual no
 * soporta swap de geometría por feature vía estilo); queda lista para
 * usarse en cuanto haga falta.
 */
interface CacheEntry {
  bucket: number;
  geometry: Geometry;
}

const simplifyCache = new Map<string, CacheEntry>();

function resolutionBucket(resolution: number): number {
  // Bucketiza en pasos de ~1.35x para no invalidar el caché en cada
  // pixel de zoom continuo (rueda del mouse) — mismo criterio que ya
  // usa PostrenderPainter (zoomBucket) para las etiquetas de calle.
  return Math.round(Math.log(resolution) / Math.log(1.35));
}

export function getSimplifiedGeometryCached<T extends Geometry>(
  id: string | number,
  geometry: T,
  resolution: number,
  toleranceFactor = 1,
): T {
  const bucket = resolutionBucket(resolution);
  const key = String(id);
  const hit = simplifyCache.get(key);
  if (hit && hit.bucket === bucket) return hit.geometry as T;
  const tolerance = resolution * toleranceFactor;
  const simplified = tolerance > 0 ? (geometry.simplify(tolerance) as T) : geometry;
  simplifyCache.set(key, { bucket, geometry: simplified });
  return simplified;
}

export function clearSimplifyCache(): void {
  simplifyCache.clear();
}