/**
 * Caché de `ctx.measureText` por clave `(fuente, texto)`.
 *
 * PostrenderPainter y styleFactory llaman measureText para cada etiqueta
 * de área/longitud en CADA frame de render (pan, zoom, incluso frames
 * intermedios de una animación), aunque el texto no haya cambiado — ver
 * diagnóstico H4. Cachear por (font, text) convierte la mayoría de esas
 * llamadas en un lookup de Map en vez de una medición nativa de texto.
 *
 * Invalidación: no hace falta invalidar a mano — la clave ya incluye el
 * texto exacto, así que un valor que cambia (ej. una cota en vivo
 * mientras se arrastra un vértice) simplemente genera una clave nueva y
 * no pisa la anterior. Para evitar crecimiento sin límite en ese caso
 * extremo, el caché se vacía por completo si supera MAX_ENTRIES — más
 * simple que un LRU real, y de todas formas sigue ahorrando trabajo
 * dentro de un mismo frame (un label se mide más de una vez: ancho para
 * el fondo + colisión).
 */

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

export function measureCachedWidth(ctx: CanvasRenderingContext2D, text: string): number {
  return measureCached(ctx, text).width;
}

/** Solo para tests/depuración. */
export function _clearTextMeasureCacheForTests(): void {
  cache.clear();
}