import { useRoundaboutStore } from '../../../store/entities/roundaboutStore';
import { roundaboutGeometry } from '../../../geo/roundabout/roundaboutEngine';
import { formatMetricLength } from '../../../geo/metrics';
import type { RoundaboutDrawPreview } from '../RoundaboutDrawInteraction';

/** Rotondas confirmadas + preview en vivo del trazado de 2 clics.
 *  Extraído de PostrenderPainter (Fase 5). */
export class RoundaboutPainter {
  private currentPreview: RoundaboutDrawPreview | null = null;

  setPreview(preview: RoundaboutDrawPreview | null): void {
    this.currentPreview = preview;
  }

  paint(ctx: CanvasRenderingContext2D, toPx: (c: number[]) => [number, number], resolution: number): void {
    const { roundabouts, visible } = useRoundaboutStore.getState();
    if (visible) {
      for (const rb of roundabouts) {
        const geom = roundaboutGeometry(rb, resolution);
        this.fillRing(ctx, geom.roadOuter, toPx, 'rgba(247, 129, 102, 0.10)');
        this.strokeRing(ctx, geom.sideOuter, toPx, 'rgba(247, 129, 102, 0.55)', 1.5);
        this.strokeRing(ctx, geom.roadOuter, toPx, 'rgba(247, 129, 102, 0.75)', 2);
        if (geom.island) {
          this.fillRing(ctx, geom.island, toPx, 'rgba(63, 185, 80, 0.18)');
          this.strokeRing(ctx, geom.island, toPx, 'rgba(63, 185, 80, 0.6)', 1.25);
        }
        ctx.save();
        ctx.setLineDash([6, 5]);
        this.strokeRing(ctx, geom.centerAxis, toPx, 'rgba(247, 129, 102, 0.45)', 1);
        ctx.restore();
        const [lx, ly] = toPx(rb.center);
        ctx.save();
        ctx.font = 'bold 11px Courier New';
        ctx.fillStyle = 'rgba(247, 129, 102, 0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${rb.name} · R${rb.radiusM.toFixed(1)}m`, lx, ly);
        ctx.restore();
      }
    }
    if (this.currentPreview) {
      const { center, current } = this.currentPreview;
      const radius = Math.hypot(current[0] - center[0], current[1] - center[1]);
      if (radius > 0.1) {
        const defaults = useRoundaboutStore.getState();
        const previewGeom = roundaboutGeometry(
          {
            center: center as [number, number],
            radiusM: radius,
            sides: defaults.defaultSides,
            rotation: 0,
            roadWidthM: defaults.defaultRoadWidthM,
            sidewalkWidthM: defaults.defaultSidewalkWidthM,
          },
          resolution,
        );
        ctx.save();
        ctx.setLineDash([6, 4]);
        this.strokeRing(ctx, previewGeom.sideOuter, toPx, 'rgba(0, 212, 255, 0.85)', 1.5);
        ctx.restore();

        const curPx = toPx(current);
        ctx.save();
        ctx.font = 'bold 11px Courier New';
        ctx.fillStyle = 'rgba(0, 212, 255, 0.95)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`R ${formatMetricLength(radius)}`, curPx[0] + 10, curPx[1]);
        ctx.restore();
      }
      const centerPx = toPx(center);
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerPx[0], centerPx[1], 4, 0, Math.PI * 2);
      ctx.fillStyle = '#0e9f6e';
      ctx.fill();
      ctx.restore();
    }
  }

  private strokeRing(ctx: CanvasRenderingContext2D, ring: Array<[number, number]>, toPx: (c: number[]) => [number, number], color: string, width: number): void {
    if (ring.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    const first = toPx(ring[0]);
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < ring.length; i++) {
      const p = toPx(ring[i]);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  private fillRing(ctx: CanvasRenderingContext2D, ring: Array<[number, number]>, toPx: (c: number[]) => [number, number], color: string): void {
    if (ring.length < 3) return;
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    const first = toPx(ring[0]);
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < ring.length; i++) {
      const p = toPx(ring[i]);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}