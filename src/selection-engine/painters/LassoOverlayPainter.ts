import type { LassoPreview } from '../interactions/LassoSelection';
import { traceRing } from '@map-core/scene/canvasPathUtils';

function lassoPreviewEqual(a: LassoPreview, b: LassoPreview): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.mode !== b.mode) return false;
  if (a.mode === 'rect' && b.mode === 'rect') {
    return a.start === b.start && a.current === b.current;
  }
  if (a.mode === 'lasso' && b.mode === 'lasso') {
    return a.points === b.points && a.current === b.current;
  }
  return false;
}

export class LassoOverlayPainter {
  private currentLassoPreview: LassoPreview = null;

  setLassoPreview(preview: LassoPreview): boolean {
    if (lassoPreviewEqual(this.currentLassoPreview, preview)) return false;
    this.currentLassoPreview = preview;
    return true;
  }

  paint(ctx: CanvasRenderingContext2D, toPx: (c: number[]) => [number, number]): void {
    const preview = this.currentLassoPreview;
    if (!preview) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.95)';
    ctx.fillStyle = 'rgba(0, 212, 255, 0.10)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);

    if (preview.mode === 'rect') {
      const a = toPx(preview.start);
      const b = toPx(preview.current);
      const x = Math.min(a[0], b[0]);
      const y = Math.min(a[1], b[1]);
      const w = Math.abs(b[0] - a[0]);
      const h = Math.abs(b[1] - a[1]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    } else if (preview.mode === 'lasso') {
      const pts = preview.points;
      if (pts.length > 0) {
        const ring: Array<[number, number]> = pts as Array<[number, number]>;
        const closing: Array<[number, number]> = preview.current
          ? [preview.current as [number, number]]
          : [ring[0]];
        traceRing(ctx, [...ring, ...closing], toPx, true);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
}
