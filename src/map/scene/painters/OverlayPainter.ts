import type { LassoPreview } from '../LassoSelection';
import type { Pt } from '../../../geo/math/polygonEngine';

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

export class OverlayPainter {
  private currentLassoPreview: LassoPreview = null;
  private currentSubdivisionPreview: Pt[][] | null = null;

  setLassoPreview(preview: LassoPreview): boolean {
    if (lassoPreviewEqual(this.currentLassoPreview, preview)) return false;
    this.currentLassoPreview = preview;
    return true;
  }

  setSubdivisionPreview(rings: Pt[][] | null): void {
    this.currentSubdivisionPreview = rings;
  }

  paint(ctx: CanvasRenderingContext2D, toPx: (c: number[]) => [number, number]): void {
    this.paintLassoPreview(ctx, toPx);
    this.paintSubdivisionPreview(ctx, toPx);
  }

  private paintLassoPreview(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number]
  ): void {
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
        ctx.beginPath();
        const first = toPx(pts[0]);
        ctx.moveTo(first[0], first[1]);
        for (let i = 1; i < pts.length; i++) {
          const p = toPx(pts[i]);
          ctx.lineTo(p[0], p[1]);
        }
        if (preview.current) {
          const cur = toPx(preview.current);
          ctx.lineTo(cur[0], cur[1]);
        } else {
          ctx.lineTo(first[0], first[1]);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  private paintSubdivisionPreview(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number]
  ): void {
    const rings = this.currentSubdivisionPreview;
    if (!rings || rings.length === 0) return;
    ctx.save();
    ctx.setLineDash([6, 4]);
    for (const ring of rings) {
      if (ring.length < 3) continue;
      ctx.beginPath();
      const first = toPx(ring[0]);
      ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < ring.length; i++) {
        const p = toPx(ring[i]);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
}
