const MAX_ENTRIES = 2000;

export interface CachedTextMetrics {
  width: number;
  ascent: number;
  descent: number;
  left: number;
  right: number;
}

const cache = new Map<string, CachedTextMetrics>();

function evictIfNeeded(): void {
  if (cache.size > MAX_ENTRIES) cache.clear();
}

export function measureCached(ctx: CanvasRenderingContext2D, text: string): CachedTextMetrics {
  const key = ctx.font + '\u0000' + text;
  const hit = cache.get(key);
  if (hit) return hit;

  const m = ctx.measureText(text);
  const entry: CachedTextMetrics = {
    width: m.width,
    ascent: m.actualBoundingBoxAscent,
    descent: m.actualBoundingBoxDescent,
    left: m.actualBoundingBoxLeft,
    right: m.actualBoundingBoxRight,
  };
  cache.set(key, entry);
  evictIfNeeded();
  return entry;
}