import type VectorSource from 'ol/source/Vector.js';
import type Map from 'ol/Map.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import { useSelectionStore } from '../store/selectionStore';
import { entityGeometryProviders } from '../entityGeometryProviders';
import { strokeRingDouble } from '@map-core/scene/canvasPathUtils';
import Point from 'ol/geom/Point.js';

const GLOW_HUE = '255, 196, 0';

const PULSE_PERIOD_MS = 1400;
const PULSE_MIN = 0.62;
const PULSE_MAX = 1;
const PULSE_RENDER_FPS = 24;
const PULSE_RENDER_FPS_HEAVY = 5;
const PULSE_RENDER_INTERVAL_MS = 1000 / PULSE_RENDER_FPS;
const PULSE_RENDER_INTERVAL_MS_HEAVY = 1000 / PULSE_RENDER_FPS_HEAVY;
const HEAVY_DATASET_THRESHOLD = 20_000;
const STATIC_HIGHLIGHT_THRESHOLD = 150_000;

export class SelectionHighlightPainter {
  private map: Map | null = null;
  private unsubscribe: (() => void) | null = null;
  private rafHandle: number | null = null;
  private lastRenderAt = 0;
  private pulseStart = 0;
  private getFeatureCount: () => number = () => 0;

  private readonly onVisibilityChange = (): void => {
    if (
      document.visibilityState === 'visible' &&
      useSelectionStore.getState().selectedIds.size > 0
    ) {
      this.startPulseLoop();
    } else {
      this.stopPulseLoop();
    }
  };

  attach(map: Map, getFeatureCount: () => number = () => 0): void {
    this.map = map;
    this.getFeatureCount = getFeatureCount;
    this.pulseStart = performance.now();

    this.unsubscribe = useSelectionStore.subscribe((state, prev) => {
      if (state.selectedIds === prev.selectedIds) return;
      this.handleSelectionChange();
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    if (useSelectionStore.getState().selectedIds.size > 0) this.startPulseLoop();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.stopPulseLoop();
    this.map = null;
  }

  private handleSelectionChange(): void {
    this.pulseStart = performance.now();
    if (useSelectionStore.getState().selectedIds.size > 0) {
      this.startPulseLoop();
      this.map?.render();
    } else {
      this.stopPulseLoop();
      this.map?.render();
    }
  }

  private startPulseLoop(): void {
    if (this.rafHandle != null || !this.map) return;
    if (this.getFeatureCount() > STATIC_HIGHLIGHT_THRESHOLD) return;

    const heavy = this.getFeatureCount() > HEAVY_DATASET_THRESHOLD;
    const intervalMs = heavy ? PULSE_RENDER_INTERVAL_MS_HEAVY : PULSE_RENDER_INTERVAL_MS;

    const tick = (now: number) => {
      if (now - this.lastRenderAt >= intervalMs) {
        this.lastRenderAt = now;
        this.map?.render();
      }
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  private stopPulseLoop(): void {
    if (this.rafHandle != null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  private currentPulse(): number {
    if (this.getFeatureCount() > STATIC_HIGHLIGHT_THRESHOLD) return PULSE_MAX;
    const elapsed = performance.now() - this.pulseStart;
    const t = (elapsed % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
    const wave = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
    return PULSE_MIN + (PULSE_MAX - PULSE_MIN) * wave;
  }

  paint(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number],
    resolution: number,
    drawSource: VectorSource
  ): void {
    const selectedIds = useSelectionStore.getState().selectedIds;
    if (selectedIds.size === 0) return;

    const pulse = this.currentPulse();
    const outerColor = `rgba(${GLOW_HUE}, ${(0.35 * pulse).toFixed(3)})`;
    const innerColor = `rgba(${GLOW_HUE}, ${(0.95 * pulse).toFixed(3)})`;
    const outerWidth = 5 + 3 * pulse;

    for (const id of selectedIds) {
      const feat = drawSource.getFeatureById(id);
      const geom = feat?.getGeometry();
      if (geom instanceof Polygon) {
        this.strokeRing(
          ctx,
          (geom.getCoordinates()[0] ?? []) as number[][],
          toPx,
          outerColor,
          innerColor,
          outerWidth
        );
        continue;
      }
      if (geom instanceof LineString) {
        this.strokePath(
          ctx,
          geom.getCoordinates() as number[][],
          toPx,
          outerColor,
          innerColor,
          outerWidth
        );
        continue;
      }
      if (geom instanceof Point) {
        this.strokePointHighlight(
          ctx,
          geom.getCoordinates(),
          toPx,
          outerColor,
          innerColor,
          outerWidth,
          pulse
        );
        continue;
      }

      const streetProvider = entityGeometryProviders.get('street');
      if (streetProvider) {
        const coords = streetProvider(id, resolution);
        if (coords && coords.length >= 2) {
          this.strokePath(ctx, coords, toPx, outerColor, innerColor, outerWidth);
          continue;
        }
      }

      const rbProvider = entityGeometryProviders.get('roundabout');
      if (rbProvider) {
        const ring = rbProvider(id, resolution);
        if (ring && ring.length >= 3) {
          this.strokeRing(ctx, ring, toPx, outerColor, innerColor, outerWidth);
        }
      }
    }
  }

  private strokePath(
    ctx: CanvasRenderingContext2D,
    coords: number[][],
    toPx: (c: number[]) => [number, number],
    outerColor: string,
    innerColor: string,
    outerWidth: number
  ): void {
    if (coords.length < 2) return;
    this.drawPath(ctx, coords, toPx, false, outerColor, innerColor, outerWidth);
  }

  private strokePointHighlight(
    ctx: CanvasRenderingContext2D,
    coord: number[],
    toPx: (c: number[]) => [number, number],
    outerColor: string,
    innerColor: string,
    outerWidth: number,
    pulse: number
  ): void {
    const px = toPx(coord);
    const baseR = 9 + 4 * pulse;
    ctx.save();
    ctx.beginPath();
    ctx.arc(px[0], px[1], baseR + outerWidth / 2, 0, Math.PI * 2);
    ctx.strokeStyle = outerColor;
    ctx.lineWidth = outerWidth;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px[0], px[1], baseR, 0, Math.PI * 2);
    ctx.strokeStyle = innerColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  private strokeRing(
    ctx: CanvasRenderingContext2D,
    ring: number[][],
    toPx: (c: number[]) => [number, number],
    outerColor: string,
    innerColor: string,
    outerWidth: number
  ): void {
    if (ring.length < 3) return;
    this.drawPath(ctx, ring, toPx, true, outerColor, innerColor, outerWidth);
  }

  private drawPath(
    ctx: CanvasRenderingContext2D,
    coords: number[][],
    toPx: (c: number[]) => [number, number],
    closed: boolean,
    outerColor: string,
    innerColor: string,
    outerWidth: number
  ): void {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    strokeRingDouble(
      ctx,
      coords as Array<[number, number]>,
      toPx,
      outerColor,
      outerWidth,
      innerColor,
      2.5,
      closed
    );
    ctx.restore();
  }
}
