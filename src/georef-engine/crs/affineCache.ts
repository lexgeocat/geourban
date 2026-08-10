import { containsExtent, buffer as bufferExtent, type Extent } from 'ol/extent.js';
import {
  fitAffineForExtent,
  fitLocalTangentPlane,
  applyAffine,
  IDENTITY_AFFINE,
  type AffineTransform,
  type AffineFitResult,
} from './affineApprox';

const MAX_ACCEPTABLE_ERROR_M = 0.01;
export const LOCAL_TANGENT_PLANE_KEY = '__local-tangent-plane__';

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

export function getMetricPlaneAffine(key: string, extentHint: Extent): AffineTransform {
  if (
    currentEntry &&
    currentEntry.key === key &&
    containsExtent(currentEntry.fitExtent, extentHint)
  ) {
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
    return IDENTITY_AFFINE;
  }

  if (fit.maxErrorM > MAX_ACCEPTABLE_ERROR_M) {
    console.warn(
      `affineCache: error residual de la aproximación afín+cuadrática (${fit.maxErrorM.toFixed(3)}m) ` +
        `sigue por encima del margen de seguridad (${MAX_ACCEPTABLE_ERROR_M}m) tras ${retries} reintento(s) de padding ` +
        `para el extent actual (${(fitExtent[2] - fitExtent[0]).toFixed(0)}x${(fitExtent[3] - fitExtent[1]).toFixed(0)}m). ` +
        'Se usa igual por ser la mejor aproximación disponible. Este modo (plano local) no debería degradar en uso ' +
        'normal — si esto se repite, es indicio de un proyecto anormalmente disperso.'
    );
  }

  currentEntry = { key, fitExtent, transform: fit.transform, maxErrorM: fit.maxErrorM };
  return fit.transform;
}

const UTM_TILE_SIZE_M = 1000;
const UTM_TILE_PADDING_RATIO = 0.15;
const UTM_TILE_MIN_PADDING_M = 80;
const UTM_MAX_LEVEL = 3; // 1000m → 500m → 250m → 125m
const UTM_MAX_CACHE_ENTRIES = 20_000;
const UTM_FIT_GRID_SIZE = 7;

interface TileCacheEntry {
  transform: AffineTransform;
  maxErrorM: number;
  fitExtent: Extent;
  level: number;
}

interface TiledAffineCacheOptions {
  tileSizeM?: number;
  tilePaddingRatio?: number;
  minTilePaddingM?: number;
  maxLevel?: number;
  maxCacheEntries?: number;
  gridSize?: number;
}
class TiledAffineCache {
  private readonly tileSizeM: number;
  private readonly tilePaddingRatio: number;
  private readonly minTilePaddingM: number;
  private readonly maxLevel: number;
  private readonly maxCacheEntries: number;
  private readonly gridSize: number;
  private readonly tiles = new Map<string, TileCacheEntry>();

  constructor(opts: TiledAffineCacheOptions = {}) {
    this.tileSizeM = opts.tileSizeM ?? UTM_TILE_SIZE_M;
    this.tilePaddingRatio = opts.tilePaddingRatio ?? UTM_TILE_PADDING_RATIO;
    this.minTilePaddingM = opts.minTilePaddingM ?? UTM_TILE_MIN_PADDING_M;
    this.maxLevel = opts.maxLevel ?? UTM_MAX_LEVEL;
    this.maxCacheEntries = opts.maxCacheEntries ?? UTM_MAX_CACHE_ENTRIES;
    this.gridSize = opts.gridSize ?? UTM_FIT_GRID_SIZE;
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

    return { transform, maxErrorM, fitExtent, level };
  }

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

  private resolveTile(key: string, x: number, y: number): TileCacheEntry {
    let level = 0;
    for (;;) {
      const size = this.sizeAtLevel(level);
      const tx = Math.floor(x / size);
      const ty = Math.floor(y / size);
      const cacheKey = this.tileCacheKey(key, level, tx, ty);

      let entry = this.tiles.get(cacheKey);
      if (entry) {
        this.touch(cacheKey, entry);
      } else {
        entry = this.computeTile(key, level, tx, ty);
        this.tiles.set(cacheKey, entry);
        this.evictIfNeeded();
      }

      const withinBudget = entry.maxErrorM <= MAX_ACCEPTABLE_ERROR_M;
      const atFloor = level >= this.maxLevel;
      if (withinBudget || atFloor) {
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

  clear(): void {
    this.tiles.clear();
  }
}

export const utmTileCache = new TiledAffineCache();

export function projectPathThroughUtmTiles(
  epsg: string,
  pts: ReadonlyArray<readonly [number, number]>
): [number, number][] {
  return utmTileCache.applyPath(epsg, pts);
}

export function invalidateAffineCache(): void {
  currentEntry = null;
  utmTileCache.clear();
}
