// src/geo/crs/affineCache.ts
import { containsExtent, buffer as bufferExtent, type Extent } from 'ol/extent.js';
import {
  fitAffineForExtent,
  fitLocalTangentPlane,
  applyAffine,
  IDENTITY_AFFINE,
  type AffineTransform,
  type AffineFitResult,
} from './affineApprox';
import { recordAffineReuse, recordAffineRefit, recordAffineDegraded } from '../../store/debug/affineTelemetry';

/** Margen de error aceptado — alarma de diagnóstico, no bloquea el uso de la matriz. */
export const MAX_ACCEPTABLE_ERROR_M = 0.01;

/**
 * Key sentinel para el modo CRS 'none' (dibujo libre, sin EPSG real).
 * `getMetricPlaneAffine`/`projectPathToMetricPlane` la reconocen y ajustan
 * un plano tangente local en forma cerrada en vez de pedirle a proj4 una
 * proyección real.
 */
export const LOCAL_TANGENT_PLANE_KEY = '__local-tangent-plane__';

// ════════════════════════════════════════════════════════════════════
// MODO 'none' (plano local) — UN ÚNICO sistema de coordenadas plano para
// TODO el proyecto (Fase 5.1-5.2 original, sin cambios funcionales).
//
// Esto es intencional y a propósito NO se tilea: el plano local no tiene
// anclaje real — no es una función global fija como UTM — su origen ES
// el centro del extent con el que se ajustó. Tilearlo produciría un
// salto de coordenadas del tamaño de un tile en cada borde, porque cada
// tile definiría su propio origen local. Los datos de Fase 5.4 confirman
// que este modo ya es preciso a cualquier escala medida (sub-mm hasta
// 100k features / ~8km de extent) — nunca tuvo el bug que sí tenía UTM.
// ════════════════════════════════════════════════════════════════════

const PADDING_FACTOR = 0.35;
const MIN_PADDING_M = 250;
const MIN_RETRY_PADDING_FACTOR = 0.02;
const MAX_PADDING_RETRIES = 4;

interface GlobalCacheEntry {
  key: string;
  fitExtent: Extent;
  transform: AffineTransform;
  maxErrorM: number;
}

let currentEntry: GlobalCacheEntry | null = null;

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
 * cubre `extentHint`. Uso previsto: SOLO `LOCAL_TANGENT_PLANE_KEY` — las
 * claves UTM pasan por `utmTileCache` (ver abajo). Se conserva exportada
 * con el mismo nombre/firma que antes de la Fase 5 robustecida (tests,
 * compatibilidad), pero `projectPathToMetricPlane` ya no la usa para UTM.
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
      'Se usa igual por ser la mejor aproximación disponible. Este modo (plano local) no debería degradar en uso ' +
      'normal — si esto se repite, es indicio de un proyecto anormalmente disperso.',
    );
  }

  currentEntry = { key, fitExtent, transform: fit.transform, maxErrorM: fit.maxErrorM };
  recordAffineRefit(key, fit.maxErrorM, fitExtent[2] - fitExtent[0], fitExtent[3] - fitExtent[1]);
  return fit.transform;
}

/** Extent (con padding aplicado) sobre el que se ajustó la matriz del plano local vigente. */
export function getCurrentFitExtent(): Extent | null {
  return currentEntry?.fitExtent ?? null;
}

/** Solo para tests/depuración — inspección del caché del plano local. */
export function _getAffineCacheEntryForTests(): Readonly<GlobalCacheEntry> | null {
  return currentEntry;
}

/**
 * Variante PURA para benchmarking/validación (Fase 5.4): computa la
 * matriz para `key`/`extentHint` SIN tocar el caché en vivo ni la
 * telemetría de producción.
 */
export function computeMetricPlaneAffineStandalone(key: string, extentHint: Extent): AffineFitResult {
  const fitExtent = paddedExtent(extentHint);
  const fit = fitForKey(key, fitExtent);
  if (!fit) {
    return { transform: IDENTITY_AFFINE, maxErrorM: Infinity, extent: fitExtent };
  }
  return fit;
}

// ════════════════════════════════════════════════════════════════════
// MODO 'utm' — caché en MOSAICO (tiles) de tamaño fijo + refinamiento
// adaptativo. Fase 5 robustecida (2-ago-2026).
//
// Bug medido en producción con el caché de extent único (Fase 5.1-5.2):
//   1. Extents alargados (calle trazada punta a punta: 11.2x0.9km)
//      producen una caja de ajuste igual de alargada → sistema normal de
//      la corrección cuadrática mal condicionado → cientos de mm de
//      error en vez de milímetros (medido: err=300.20mm).
//   2. El error de la aproximación crece ~O(lado²) con el tamaño del
//      extent ajustado (medido: 0.8km→1.2mm, 2.5km→11.5mm, 7.9km→113.9mm
//      — ambos superan MAX_ACCEPTABLE_ERROR_M a partir de pocos km). Un
//      proyecto real crece con el tiempo: este caché SIEMPRE terminaba
//      degradando.
//
// La solución no es afinar el padding: es dejar de ajustar UNA matriz
// para el extent completo del proyecto. UTM es una función GLOBAL FIJA
// de (lon,lat) — no depende de qué región mirás — así que se puede
// aproximar con piezas CUADRADAS de tamaño fijo (tiles), cada una con su
// propio ajuste afín+cuadrático, cacheada indefinidamente. Como todas las
// piezas aproximan la MISMA función continua, dos tiles vecinos coinciden
// en el borde compartido dentro del margen de error de cada uno — nunca
// hay un salto de coordenadas grande. (Esto es justo lo opuesto de lo que
// pasaría si tileáramos el plano local: ver nota arriba.)
// ════════════════════════════════════════════════════════════════════

/** Lado del tile de nivel 0, en metros. Con ~1.3km de caja de ajuste
 * final (tile + padding) el residuo típico de la corrección cuadrática
 * queda en 1-3mm — muy por debajo de MAX_ACCEPTABLE_ERROR_M — según la
 * escala de error medida en Fase 5.4 (~1.84mm por km² de lado de caja). */
const UTM_TILE_SIZE_M = 1000;
/** Margen alrededor del tile para que los puntos cerca del borde queden
 * interpolados (dentro de la grilla de ajuste), no extrapolados. */
const UTM_TILE_PADDING_RATIO = 0.15;
const UTM_TILE_MIN_PADDING_M = 80;
/** Refinamiento adaptativo: si un tile de nivel L sigue por encima del
 * margen de error tras el ajuste, se subdivide en tiles de nivel L+1
 * (mitad de lado) — hasta este nivel máximo. En uso normal no debería
 * activarse casi nunca (nivel 0 ya cumple el margen con sobra). */
const UTM_MAX_LEVEL = 3; // 1000m → 500m → 250m → 125m
/** Válvula de seguridad de memoria — cada entrada pesa un puñado de
 * floats; miles de tiles son irrelevantes en memoria. */
const UTM_MAX_CACHE_ENTRIES = 20_000;
const UTM_FIT_GRID_SIZE = 7;

interface TileCacheEntry {
  transform: AffineTransform;
  maxErrorM: number;
  fitExtent: Extent;
  level: number;
}

export interface TiledAffineCacheOptions {
  tileSizeM?: number;
  tilePaddingRatio?: number;
  minTilePaddingM?: number;
  maxLevel?: number;
  maxCacheEntries?: number;
  gridSize?: number;
  /** false para instancias standalone (benchmarks/tests) — no reporta a
   * la telemetría de producción (`affineTelemetry.ts`). */
  telemetry?: boolean;
}

/**
 * Caché en mosaico de matrices afines UTM. Uso normal: el singleton
 * `utmTileCache` exportado más abajo. La clase se expone para poder
 * instanciar cachés aislados (Fase 5.4 — validación de precisión, o
 * tests) sin tocar el caché en vivo ni la telemetría de producción.
 */
export class TiledAffineCache {
  private readonly tileSizeM: number;
  private readonly tilePaddingRatio: number;
  private readonly minTilePaddingM: number;
  private readonly maxLevel: number;
  private readonly maxCacheEntries: number;
  private readonly gridSize: number;
  private readonly telemetry: boolean;
  private readonly tiles = new Map<string, TileCacheEntry>();

  constructor(opts: TiledAffineCacheOptions = {}) {
    this.tileSizeM = opts.tileSizeM ?? UTM_TILE_SIZE_M;
    this.tilePaddingRatio = opts.tilePaddingRatio ?? UTM_TILE_PADDING_RATIO;
    this.minTilePaddingM = opts.minTilePaddingM ?? UTM_TILE_MIN_PADDING_M;
    this.maxLevel = opts.maxLevel ?? UTM_MAX_LEVEL;
    this.maxCacheEntries = opts.maxCacheEntries ?? UTM_MAX_CACHE_ENTRIES;
    this.gridSize = opts.gridSize ?? UTM_FIT_GRID_SIZE;
    this.telemetry = opts.telemetry ?? true;
  }

  private sizeAtLevel(level: number): number {
    return this.tileSizeM / 2 ** level;
  }

  private tileCacheKey(key: string, level: number, tx: number, ty: number): string {
    return `${key}|L${level}|${tx}|${ty}`;
  }

  private computeTile(key: string, level: number, tx: number, ty: number): TileCacheEntry {
    const size = this.sizeAtLevel(level);
    const pad = Math.max(this.minTilePaddingM, size * this.tilePaddingRatio);
    const fitExtent: Extent = [
      tx * size - pad,
      ty * size - pad,
      (tx + 1) * size + pad,
      (ty + 1) * size + pad,
    ];
    const fit = fitAffineForExtent(fitExtent, key, this.gridSize);
    const transform = fit?.transform ?? IDENTITY_AFFINE;
    const maxErrorM = fit?.maxErrorM ?? Infinity;

    if (this.telemetry) {
      recordAffineRefit(key, maxErrorM, fitExtent[2] - fitExtent[0], fitExtent[3] - fitExtent[1]);
    }

    return { transform, maxErrorM, fitExtent, level };
  }

  /** Mueve la entrada al final del Map (orden de inserción = recencia) para LRU barato. */
  private touch(cacheKey: string, entry: TileCacheEntry): void {
    this.tiles.delete(cacheKey);
    this.tiles.set(cacheKey, entry);
  }

  private evictIfNeeded(): void {
    while (this.tiles.size > this.maxCacheEntries) {
      const oldest = this.tiles.keys().next().value;
      if (oldest === undefined) break;
      this.tiles.delete(oldest);
    }
  }

  /** Busca (creando y refinando si hace falta) el tile que cubre `(x, y)`. */
  private resolveTile(key: string, x: number, y: number): TileCacheEntry {
    let level = 0;
    for (;;) {
      const size = this.sizeAtLevel(level);
      const tx = Math.floor(x / size);
      const ty = Math.floor(y / size);
      const cacheKey = this.tileCacheKey(key, level, tx, ty);

      let entry = this.tiles.get(cacheKey);
      if (entry) {
        if (this.telemetry) recordAffineReuse(key);
        this.touch(cacheKey, entry);
      } else {
        entry = this.computeTile(key, level, tx, ty);
        this.tiles.set(cacheKey, entry);
        this.evictIfNeeded();
      }

      const withinBudget = entry.maxErrorM <= MAX_ACCEPTABLE_ERROR_M;
      const atFloor = level >= this.maxLevel;
      if (withinBudget || atFloor) {
        if (!withinBudget && atFloor && this.telemetry) recordAffineDegraded(key);
        return entry;
      }
      level++;
    }
  }

  getTransform(key: string, x: number, y: number): AffineTransform {
    return this.resolveTile(key, x, y).transform;
  }

  applyPoint(key: string, pt: readonly [number, number]): [number, number] {
    return applyAffine(pt, this.getTransform(key, pt[0], pt[1]));
  }

  applyPath(key: string, pts: ReadonlyArray<readonly [number, number]>): [number, number][] {
    const out = new Array<[number, number]>(pts.length);
    for (let i = 0; i < pts.length; i++) out[i] = this.applyPoint(key, pts[i]);
    return out;
  }

  /** Cantidad de tiles cacheados actualmente (todas las claves/niveles). */
  get size(): number {
    return this.tiles.size;
  }

  /** Cantidad de tiles cacheados para una clave (EPSG) específica. */
  sizeForKey(key: string): number {
    let n = 0;
    const prefix = `${key}|`;
    for (const k of this.tiles.keys()) if (k.startsWith(prefix)) n++;
    return n;
  }

  clear(): void {
    this.tiles.clear();
  }

  /** Solo para tests/depuración. */
  _getEntriesForTests(): ReadonlyMap<string, TileCacheEntry> {
    return this.tiles;
  }
}

/** Caché de mosaico UTM en vivo — usado por `projectPathToMetricPlane` en modo 'utm'. */
export const utmTileCache = new TiledAffineCache();

/** Atajo usado por `metrics.ts` para transformar un path completo en modo 'utm'. */
export function projectPathThroughUtmTiles(
  epsg: string,
  pts: ReadonlyArray<readonly [number, number]>,
): [number, number][] {
  return utmTileCache.applyPath(epsg, pts);
}

/**
 * Fuerza la invalidación de AMBOS cachés (plano local + mosaico UTM).
 * Llamar al cambiar explícitamente la configuración de CRS del proyecto
 * (modo, zona UTM, hemisferio) — un cambio de zona invalida cualquier
 * tile UTM ya calculado, y un cambio de modo invalida el plano local.
 * `projectCrsStore.ts` ya llama esta función en cada mutación de CRS —
 * no requiere cambios.
 */
export function invalidateAffineCache(): void {
  currentEntry = null;
  utmTileCache.clear();
}