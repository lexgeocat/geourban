import type { Pt } from '@kernel/geometry/polygonEngine';

export class SubdivisionPreviewPainter {
  private currentSubdivisionPreview: Pt[][] | null = null;

  setSubdivisionPreview(rings: Pt[][] | null): void {
    this.currentSubdivisionPreview = rings;
  }

  paint(ctx: CanvasRenderingContext2D, toPx: (c: number[]) => [number, number]): void {
    this.paintSubdivisionPreview(ctx, toPx);
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
