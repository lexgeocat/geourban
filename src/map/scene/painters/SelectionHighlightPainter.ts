import type VectorSource from 'ol/source/Vector.js';
import type Map from 'ol/Map.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import { useStreetStore, type Street } from '../../../store/entities/streetStore';
import { useRoundaboutStore } from '../../../store/entities/roundaboutStore';
import { useSelectionStore } from '../../../store/map/selectionStore';
import { roundaboutGeometry } from '../../../geo/roundabout/roundaboutEngine';

/** Color base de foco — distinto del cyan de dibujo para que se note claro cuál está seleccionado. */
const GLOW_HUE = '255, 196, 0';

/** Duración de un ciclo completo de "respiración" del glow (ms). */
const PULSE_PERIOD_MS = 1400;
/** Rango de intensidad del glow durante el pulso (0-1). Nunca baja del mínimo para que siempre se vea nítido. */
const PULSE_MIN = 0.62;
const PULSE_MAX = 1;
/** Techo de refresco propio del pulso — no necesita 60fps para verse fluido; así se ahorra CPU/GPU. */
const PULSE_RENDER_FPS = 24;
const PULSE_RENDER_INTERVAL_MS = 1000 / PULSE_RENDER_FPS;

function streetCoords(s: Street): Array<[number, number]> {
  const c: Array<[number, number]> = [s.start];
  if (s.waypoints) c.push(...s.waypoints);
  c.push(s.end);
  return c;
}

export class SelectionHighlightPainter {
  private map: Map | null = null;
  private unsubscribe: (() => void) | null = null;
  private rafHandle: number | null = null;
  private lastRenderAt = 0;
  private pulseStart = 0;

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && useSelectionStore.getState().selectedIds.size > 0) {
      this.startPulseLoop();
    } else {
      this.stopPulseLoop();
    }
  };

  /** Conectar al mapa vivo. Idempotente-friendly: llamar una vez por instancia. */
  attach(map: Map): void {
    this.map = map;
    this.pulseStart = performance.now();

    this.unsubscribe = useSelectionStore.subscribe((state, prev) => {
      if (state.selectedIds === prev.selectedIds) return;
      this.handleSelectionChange();
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }

    // Si al montar ya había selección viva (HMR / remount), arrancamos el loop.
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
      this.map?.render(); // reacción inmediata, no esperar al próximo tick del loop
    } else {
      this.stopPulseLoop();
      this.map?.render(); // último render: borra el highlight que hubiera quedado pintado
    }
  }

  private startPulseLoop(): void {
    if (this.rafHandle != null || !this.map) return;
    const tick = (now: number) => {
      if (now - this.lastRenderAt >= PULSE_RENDER_INTERVAL_MS) {
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

  /** Intensidad actual del glow (0..1), como onda suave (coseno, sin saltos). */
  private currentPulse(): number {
    const elapsed = performance.now() - this.pulseStart;
    const t = (elapsed % PULSE_PERIOD_MS) / PULSE_PERIOD_MS;
    const wave = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
    return PULSE_MIN + (PULSE_MAX - PULSE_MIN) * wave;
  }

  paint(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number],
    resolution: number,
    drawSource: VectorSource,
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
        this.strokeRing(ctx, (geom.getCoordinates()[0] ?? []) as number[][], toPx, outerColor, innerColor, outerWidth);
        continue;
      }
      if (geom instanceof LineString) {
        this.strokePath(ctx, geom.getCoordinates() as number[][], toPx, outerColor, innerColor, outerWidth);
        continue;
      }

      const street = useStreetStore.getState().streets.find((s) => s.id === id);
      if (street) {
        this.strokePath(ctx, streetCoords(street), toPx, outerColor, innerColor, outerWidth);
        continue;
      }

      const rb = useRoundaboutStore.getState().roundabouts.find((r) => r.id === id);
      if (rb) {
        const geomRb = roundaboutGeometry(rb, resolution);
        this.strokeRing(ctx, geomRb.sideOuter as number[][], toPx, outerColor, innerColor, outerWidth);
      }
    }
  }

  private strokePath(
    ctx: CanvasRenderingContext2D,
    coords: number[][],
    toPx: (c: number[]) => [number, number],
    outerColor: string,
    innerColor: string,
    outerWidth: number,
  ): void {
    if (coords.length < 2) return;
    this.drawPath(ctx, coords, toPx, false, outerColor, innerColor, outerWidth);
  }

  private strokeRing(
    ctx: CanvasRenderingContext2D,
    ring: number[][],
    toPx: (c: number[]) => [number, number],
    outerColor: string,
    innerColor: string,
    outerWidth: number,
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
    outerWidth: number,
  ): void {
    const trace = () => {
      const first = toPx(coords[0]);
      ctx.beginPath();
      ctx.moveTo(first[0], first[1]);
      for (let i = 1; i < coords.length; i++) {
        const p = toPx(coords[i]);
        ctx.lineTo(p[0], p[1]);
      }
      if (closed) ctx.closePath();
    };

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Halo exterior (glow, pulsante) + trazo interior nítido — foco GIS "vivo".
    ctx.strokeStyle = outerColor;
    ctx.lineWidth = outerWidth;
    trace();
    ctx.stroke();

    ctx.strokeStyle = innerColor;
    ctx.lineWidth = 2.5;
    trace();
    ctx.stroke();
    ctx.restore();
  }
}