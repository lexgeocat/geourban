import { useRoundaboutStore, type Roundabout } from '../../../store/entities/roundaboutStore';
import { useLayersStore } from '../../../store/entities/layersRegistryStore';
import { roundaboutGeometry } from '../../../geo/roundabout/roundaboutEngine';
import { formatMetricLength } from '../../../geo/metrics';
import { withAlpha } from '../DrawLayerRenderer';
import type { RoundaboutDrawPreview } from '../RoundaboutDrawInteraction';
import type { Layer } from '../../../core/objectModel';

const FALLBACK_ROUNDABOUT_COLOR = '#f78166';

function resolveRoundaboutLayer(rb: Roundabout, registry: ReturnType<typeof useLayersStore.getState>): Layer | undefined {
  if (rb.layerId) {
    const layer = registry.getById(rb.layerId);
    if (layer) return layer;
  }
  return registry.getLayerForKind('calle');
}

export class RoundaboutPainter {
  private currentPreview: RoundaboutDrawPreview | null = null;

  setPreview(preview: RoundaboutDrawPreview | null): void {
    this.currentPreview = preview;
  }

  paint(ctx: CanvasRenderingContext2D, toPx: (c: number[]) => [number, number], resolution: number): void {
    const { roundabouts } = useRoundaboutStore.getState();
    const registry = useLayersStore.getState();

    for (const rb of roundabouts) {
      const layer = resolveRoundaboutLayer(rb, registry);
      if (!layer?.visible) continue;

      const color = layer.color ?? FALLBACK_ROUNDABOUT_COLOR;
      const fillColor = layer.fillColor ?? color;
      const op = layer.opacity ?? 1;

      const geom = roundaboutGeometry(rb, resolution);
      this.fillRing(ctx, geom.roadOuter, toPx, withAlpha(fillColor, 0.10 * op));
      this.strokeRing(ctx, geom.sideOuter, toPx, withAlpha(color, 0.55 * op), 1.5);
      this.strokeRing(ctx, geom.roadOuter, toPx, withAlpha(color, 0.75 * op), 2);
      if (geom.island) {
        this.fillRing(ctx, geom.island, toPx, 'rgba(63, 185, 80, 0.18)');
        this.strokeRing(ctx, geom.island, toPx, 'rgba(63, 185, 80, 0.6)', 1.25);
      }
      ctx.save();
      ctx.setLineDash([6, 5]);
      this.strokeRing(ctx, geom.centerAxis, toPx, withAlpha(color, 0.45 * op), 1);
      ctx.restore();

      const labelOp = (layer.showLabel ? 1 : 0) * op;
      if (labelOp > 0.002) {
        const [lx, ly] = toPx(rb.center);
        ctx.save();
        ctx.globalAlpha *= labelOp;
        ctx.font = 'bold 11px Courier New';
        ctx.fillStyle = withAlpha(color, 0.9);
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