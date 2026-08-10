import { useRoundaboutStore } from '../store/roundaboutStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { roundaboutGeometry } from '../geometry/roundaboutEngine';
import { formatMetricLength } from '@georef-engine/metrics';
import { withAlpha } from '@map-core/scene/DrawLayerRenderer';
import type { RoundaboutDrawPreview } from '../interactions/RoundaboutDrawInteraction';
import { getLayerByIdCached, resolveRoundaboutLayer } from '@layers-engine/selectors/layersPainterHelpers';

const FALLBACK_ROUNDABOUT_COLOR = '#f78166';

export class RoundaboutPainter {
  private currentPreview: RoundaboutDrawPreview | null = null;

  setPreview(preview: RoundaboutDrawPreview | null): boolean {
    const prev = this.currentPreview;
    if (prev === preview) return false;
    if (!prev && !preview) return false;
    if (prev && preview && prev.center === preview.center && prev.current === preview.current) {
      return false;
    }
    this.currentPreview = preview;
    return true;
  }

  paint(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number],
    resolution: number
  ): void {
    const { roundabouts } = useRoundaboutStore.getState();
    const registry = useLayersStore.getState();
    const byId = getLayerByIdCached(registry.layers);

    for (const rb of roundabouts) {
      const layer = resolveRoundaboutLayer(rb, registry, byId);
      if (!layer?.visible) continue;

      const color = layer.color ?? FALLBACK_ROUNDABOUT_COLOR;
      const op = layer.opacity ?? 1;

      const geom = roundaboutGeometry(rb, resolution);
      if (geom.island) {
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
          resolution
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

  private strokeRing(
    ctx: CanvasRenderingContext2D,
    ring: Array<[number, number]>,
    toPx: (c: number[]) => [number, number],
    color: string,
    width: number
  ): void {
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
}
