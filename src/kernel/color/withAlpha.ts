/**
 * Hex `#rrggbb` o `#rgb` → `rgba(r, g, b, a)`.
 *
 * Si el input no matchea el formato esperado, devuelve un fallback
 * `rgba(0, 212, 255, a)` (cyan accent de GeoUrban) con el alpha pedido,
 * para que un color malformado no rompa el render en silencio.
 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return `rgba(0, 212, 255, ${alpha})`;
  const hex = m[1];
  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const n = parseInt(normalized, 16);
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}
