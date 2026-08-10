/**
 * Helpers compartidos para pintar geometrías en Canvas 2D.
 *
 * Antes estos patrones (beginPath/moveTo/lineTo/closePath/fill|stroke) estaban
 * repetidos literalmente en SelectionHighlightPainter, LassoOverlayPainter,
 * SubdivisionPreviewPainter, StreetPainter y RoundaboutPainter. Este módulo
 * los centraliza.
 *
 * Convenciones:
 * - Las coordenadas de entrada se proyectan a píxeles con `toPx` antes de pintar.
 * - `traceRing` no hace stroke ni fill: solo traza el path. Útil para combinar
 *   varios rings en un único fill (ej. fill 'evenodd' para Polygon con holes).
 * - `strokeRing` / `fillRing` aplican stroke o fill respectivamente.
 */

type Ring = Array<[number, number]>;
type ToPx = (coord: [number, number]) => [number, number];

/**
 * Traza un anillo cerrado en el contexto: beginPath, moveTo, lineTo, closePath.
 * Deja el path listo para que el caller haga fill/stroke (o ambos).
 *
 * @param closed si true, agrega closePath (anillo topológicamente cerrado).
 *               Pasar false para polilíneas abiertas (líneas de calle sin cerrar).
 */
export function traceRing(
  ctx: CanvasRenderingContext2D,
  ring: Ring,
  toPx: ToPx,
  closed: boolean
): void {
  if (ring.length === 0) return;
  ctx.beginPath();
  const first = toPx(ring[0]);
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < ring.length; i++) {
    const p = toPx(ring[i]);
    ctx.lineTo(p[0], p[1]);
  }
  if (closed) ctx.closePath();
}

/**
 * Traza el anillo y aplica stroke con el color/lineWidth dados.
 * Equivale a: set strokeStyle + lineWidth, traceRing(closed=true), stroke().
 */
export function strokeRing(
  ctx: CanvasRenderingContext2D,
  ring: Ring,
  toPx: ToPx,
  color: string,
  lineWidth: number,
  closed = true
): void {
  if (ring.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  traceRing(ctx, ring, toPx, closed);
  ctx.stroke();
}

/**
 * Traza el anillo y aplica fill con el color dado.
 * Equivale a: set fillStyle, traceRing(closed=true), fill().
 */
export function fillRing(
  ctx: CanvasRenderingContext2D,
  ring: Ring,
  toPx: ToPx,
  color: string,
  closed = true
): void {
  if (ring.length === 0) return;
  ctx.fillStyle = color;
  traceRing(ctx, ring, toPx, closed);
  ctx.fill();
}

/**
 * Traza una polilínea abierta (sin closePath) y aplica stroke.
 * Útil para líneas de calle que son inherentemente abiertas.
 */
export function strokePolyline(
  ctx: CanvasRenderingContext2D,
  ring: Ring,
  toPx: ToPx,
  color: string,
  lineWidth: number
): void {
  strokeRing(ctx, ring, toPx, color, lineWidth, false);
}

/**
 * Traza el path del anillo UNA vez y aplica dos strokes (outer + inner).
 * Útil para el efecto "halo" de selección: outer más ancho, inner más fino.
 *
 * Asume que el caller ya configuró lineJoin/lineCap si los necesita (lo hace
 * el SelectionHighlightPainter).
 */
export function strokeRingDouble(
  ctx: CanvasRenderingContext2D,
  ring: Ring,
  toPx: ToPx,
  outerColor: string,
  outerWidth: number,
  innerColor: string,
  innerWidth: number,
  closed = true
): void {
  if (ring.length === 0) return;
  traceRing(ctx, ring, toPx, closed);
  ctx.strokeStyle = outerColor;
  ctx.lineWidth = outerWidth;
  ctx.stroke();
  ctx.strokeStyle = innerColor;
  ctx.lineWidth = innerWidth;
  ctx.stroke();
}
