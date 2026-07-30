import type VectorSource from 'ol/source/Vector.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import { useStreetStore, type Street } from '../../../store/entities/streetStore';
import { useRoundaboutStore } from '../../../store/entities/roundaboutStore';
import { useSelectionStore } from '../../../store/map/selectionStore';
import { roundaboutGeometry } from '../../../geo/roundabout/roundaboutEngine';

/** Color de foco — distinto del cyan de dibujo para que se note claro cuál está seleccionado. */
const GLOW_OUTER = 'rgba(255, 196, 0, 0.35)';
const GLOW_INNER = 'rgba(255, 196, 0, 0.95)';

function streetCoords(s: Street): Array<[number, number]> {
  const c: Array<[number, number]> = [s.start];
  if (s.waypoints) c.push(...s.waypoints);
  c.push(s.end);
  return c;
}

/**
 * Pinta el resaltado de selección para manzanos/lotes/perímetro/línea
 * (leyendo drawSource) y para calles/rotondas (leyendo sus stores en vivo,
 * NO objetos Feature "fantasma" que puedan quedar desactualizados).
 *
 * Fuente de verdad única: useSelectionStore.selectedIds. Funciona igual
 * sea cual sea el origen de la selección — click en el mapa (HitTestSelect)
 * o click en una fila de un panel (ManzanoCard / StreetPanel / RoundaboutPanel).
 */
export class SelectionHighlightPainter {
  paint(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number],
    resolution: number,
    drawSource: VectorSource,
  ): void {
    const selectedIds = useSelectionStore.getState().selectedIds;
    if (selectedIds.size === 0) return;

    for (const id of selectedIds) {
      const feat = drawSource.getFeatureById(id);
      const geom = feat?.getGeometry();
      if (geom instanceof Polygon) {
        this.strokeRing(ctx, (geom.getCoordinates()[0] ?? []) as number[][], toPx);
        continue;
      }
      if (geom instanceof LineString) {
        this.strokePath(ctx, geom.getCoordinates() as number[][], toPx);
        continue;
      }

      const street = useStreetStore.getState().streets.find((s) => s.id === id);
      if (street) {
        this.strokePath(ctx, streetCoords(street), toPx);
        continue;
      }

      const rb = useRoundaboutStore.getState().roundabouts.find((r) => r.id === id);
      if (rb) {
        const geomRb = roundaboutGeometry(rb, resolution);
        this.strokeRing(ctx, geomRb.sideOuter as number[][], toPx);
      }
    }
  }

  private strokePath(ctx: CanvasRenderingContext2D, coords: number[][], toPx: (c: number[]) => [number, number]): void {
    if (coords.length < 2) return;
    this.drawPath(ctx, coords, toPx, false);
  }

  private strokeRing(ctx: CanvasRenderingContext2D, ring: number[][], toPx: (c: number[]) => [number, number]): void {
    if (ring.length < 3) return;
    this.drawPath(ctx, ring, toPx, true);
  }

  private drawPath(
    ctx: CanvasRenderingContext2D,
    coords: number[][],
    toPx: (c: number[]) => [number, number],
    closed: boolean,
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
    // Halo exterior (glow) + trazo interior nítido — look "foco GIS".
    ctx.strokeStyle = GLOW_OUTER;
    ctx.lineWidth = 7;
    trace();
    ctx.stroke();

    ctx.strokeStyle = GLOW_INNER;
    ctx.lineWidth = 2.5;
    trace();
    ctx.stroke();
    ctx.restore();
  }
}