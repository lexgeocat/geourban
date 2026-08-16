type Ring = Array<[number, number]>;
type ToPx = (coord: [number, number]) => [number, number];

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
export function strokePolyline(
  ctx: CanvasRenderingContext2D,
  ring: Ring,
  toPx: ToPx,
  color: string,
  lineWidth: number
): void {
  strokeRing(ctx, ring, toPx, color, lineWidth, false);
}
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
