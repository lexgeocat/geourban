import type { Pt } from '@kernel/geometry/polygonEngine';
import { traceRing } from '@map-core/scene/canvasPathUtils';

export class SubdivisionPreviewPainter {
  private currentSubdivisionPreview: Pt[][] | null = null;

  setSubdivisionPreview(rings: Pt[][] | null): void {
    this.currentSubdivisionPreview = rings;
  }

  paint(ctx: CanvasRenderingContext2D, toPx: (c: number[]) => [number, number]): void {
    const rings = this.currentSubdivisionPreview;
    if (!rings || rings.length === 0) return;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)';
    ctx.lineWidth = 1.5;
    for (const ring of rings) {
      if (ring.length < 3) continue;
      traceRing(ctx, ring, toPx, true);
      ctx.fill();
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }
}
