import type Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { StyleFunction } from 'ol/style/Style.js';
import { Fill, Stroke, Style, Text } from 'ol/style.js';
import type { SegmentMetric } from '../geo/metrics';

// ─── Colores
const LOTES_SAI_MANZANA_COLOR = '#58a6ff';
const LOTES_SAI_TEXT_BG = 'rgba(13, 17, 23, 0.72)';
const LOTES_SAI_LIVE_BG = 'rgba(13, 17, 23, 0.80)';

// ─── Cotas (dimension lines) — estilo CAD profesional ────────────────
const DIM_LINE_COLOR_LOTE = 'rgba(226, 232, 240, 0.55)';
const DIM_LINE_COLOR_MZN = 'rgba(88, 166, 255, 0.60)';
const DIM_EXT_GAP_PX = 3;  // separación entre el vértice real y el inicio de la línea de extensión
const DIM_TICK_PX = 5;     // tamaño de las marcas terminales (ticks a 45°, estilo CAD)

/** Área aproximada en pantalla (px²) del bbox de una geometría. */
export function getApproxScreenArea(geometry: Geometry | null | undefined, resolution: number): number {
  if (!geometry) return 0;
  const extent = geometry.getExtent();
  const widthPx = Math.abs(extent[2] - extent[0]) / resolution;
  const heightPx = Math.abs(extent[3] - extent[1]) / resolution;
  return widthPx * heightPx;
}

// ─── Orientación de cotas (interna/externa) ──────────────────────────

export type DimensionOrientation = 'inward' | 'outward';

export function resolveDimensionOrientation(
  feature: Feature<Geometry>,
  lotGroupCounts: Map<string, number>,
): DimensionOrientation {
  if (feature.get('type') === 'manzana') return 'outward';
  const groupId = feature.get('lotGroupId') as string | undefined;
  if (groupId && (lotGroupCounts.get(groupId) ?? 0) >= 2) return 'inward';
  return 'outward';
}

/** Cuenta cuántos features comparten cada `lotGroupId` (hermanos de la misma subdivisión). */
export function computeLotGroupCounts(features: Feature<Geometry>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of features) {
    const gid = f.get('lotGroupId') as string | undefined;
    if (!gid) continue;
    counts.set(gid, (counts.get(gid) ?? 0) + 1);
  }
  return counts;
}

// ─── Primitivas de dibujo CAD ─────────────────────────────────────────

function drawExtensionLine(
  ctx: CanvasRenderingContext2D,
  vertexPx: [number, number],
  dirX: number,
  dirY: number,
  offsetPx: number,
  color: string,
) {
  const startX = vertexPx[0] + dirX * DIM_EXT_GAP_PX;
  const startY = vertexPx[1] + dirY * DIM_EXT_GAP_PX;
  const endX = vertexPx[0] + dirX * offsetPx;
  const endY = vertexPx[1] + dirY * offsetPx;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.restore();
}

function drawDimTick(
  ctx: CanvasRenderingContext2D,
  atPx: [number, number],
  angle: number,
  color: string,
) {
  const half = DIM_TICK_PX / 2;
  ctx.save();
  ctx.translate(atPx[0], atPx[1]);
  ctx.rotate(angle + Math.PI / 4);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.moveTo(-half, 0);
  ctx.lineTo(half, 0);
  ctx.stroke();
  ctx.restore();
}

export function drawSegmentLabels(
  ctx: CanvasRenderingContext2D,
  points: number[][],
  segmentLengths: SegmentMetric[] | undefined,
  centroidWorld: [number, number] | undefined,
  orientation: DimensionOrientation,
  toPixel: (coord: number[]) => [number, number],
  isManzana: boolean = false,
): void {
  if (!segmentLengths || segmentLengths.length === 0) return;
  // Si no coincide 1 a 1 con los lados del anillo, no arriesgar cotas mal ubicadas.
  if (segmentLengths.length !== points.length - 1) return;

  const MIN_SEGMENT_PX = 34;
  const color = isManzana ? DIM_LINE_COLOR_MZN : DIM_LINE_COLOR_LOTE;
  const offsetPx = isManzana ? 17 : 13;
  const fs = isManzana ? 12 : 10.5;
  const cenPx = centroidWorld ? toPixel(centroidWorld) : null;

  for (let i = 0; i < segmentLengths.length; i++) {
    const meta = segmentLengths[i];
    if (!meta || !Number.isFinite(meta.lengthM) || meta.lengthM <= 0) continue;

    const aPx = toPixel(points[i]);
    const bPx = toPixel(points[i + 1]);
    const dxPx = bPx[0] - aPx[0];
    const dyPx = bPx[1] - aPx[1];
    const lenPx = Math.hypot(dxPx, dyPx);
    if (lenPx < MIN_SEGMENT_PX) continue;

    let ang = Math.atan2(dyPx, dxPx);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;

    let nx = -dyPx / lenPx;
    let ny = dxPx / lenPx;

    if (cenPx) {
      const midPx: [number, number] = [(aPx[0] + bPx[0]) / 2, (aPx[1] + bPx[1]) / 2];
      const pointsAway = (midPx[0] - cenPx[0]) * nx + (midPx[1] - cenPx[1]) * ny >= 0;
      const wantOutward = orientation === 'outward';
      if (pointsAway !== wantOutward) {
        nx = -nx;
        ny = -ny;
      }
    }

    drawExtensionLine(ctx, aPx, nx, ny, offsetPx, color);
    drawExtensionLine(ctx, bPx, nx, ny, offsetPx, color);

    const dimA: [number, number] = [aPx[0] + nx * offsetPx, aPx[1] + ny * offsetPx];
    const dimB: [number, number] = [bPx[0] + nx * offsetPx, bPx[1] + ny * offsetPx];

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dimA[0], dimA[1]);
    ctx.lineTo(dimB[0], dimB[1]);
    ctx.stroke();
    ctx.restore();

    drawDimTick(ctx, dimA, ang, color);
    drawDimTick(ctx, dimB, ang, color);

    const txC = (dimA[0] + dimB[0]) / 2;
    const tyC = (dimA[1] + dimB[1]) / 2;
    const label = meta.lengthM >= 100 ? meta.lengthM.toFixed(1) + ' m' : meta.lengthM.toFixed(2) + ' m';

    ctx.save();
    ctx.translate(txC, tyC);
    ctx.rotate(ang);
    ctx.font = isManzana ? `600 ${fs}px Courier New` : `500 ${fs}px Courier New`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = LOTES_SAI_TEXT_BG;
    ctx.fillRect(-tw / 2 - 3, -fs / 2 - 1.5, tw + 6, fs + 3);
    ctx.fillStyle = isManzana ? LOTES_SAI_MANZANA_COLOR + 'ee' : '#e2e8f0ee';
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
}

export function drawMainMetricLabel(
  ctx: CanvasRenderingContext2D,
  labelPointWorld: [number, number],
  toPixel: (coord: number[]) => [number, number],
  text: string,
  isManzana: boolean,
  options?: { extraLine?: string; color?: string },
): void {
  const px = toPixel(labelPointWorld);
  const fs = isManzana ? 13 : 11.5;
  const mainColor = options?.color ?? (isManzana ? LOTES_SAI_MANZANA_COLOR : '#dffcff');

  ctx.save();
  ctx.font = `700 ${fs}px Courier New`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = LOTES_SAI_TEXT_BG;
  ctx.fillRect(px[0] - tw / 2 - 4, px[1] - fs / 2 - 2, tw + 8, fs + 4);
  ctx.fillStyle = mainColor + 'ee';
  ctx.fillText(text, px[0], px[1]);

  if (options?.extraLine) {
    const fs2 = fs * 0.8;
    ctx.font = `500 ${fs2}px Courier New`;
    const tw2 = ctx.measureText(options.extraLine).width;
    const y2 = px[1] + fs * 0.5 + fs2 * 0.6 + 2;
    ctx.fillStyle = LOTES_SAI_TEXT_BG;
    ctx.fillRect(px[0] - tw2 / 2 - 3, y2 - fs2 / 2 - 1.5, tw2 + 6, fs2 + 3);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.fillText(options.extraLine, px[0], y2);
  }
  ctx.restore();
}

export function createMeasurementStyle(): StyleFunction {
  const hitStyle = new Style({
    fill: new Fill({ color: 'rgba(0, 0, 0, 0.001)' }),
    stroke: new Stroke({ color: 'rgba(0, 0, 0, 0.001)', width: 6 }),
  });
  return () => hitStyle;
}

export function createLiveDrawingLabelStyle(
  text: string,
  coordinate: [number, number],
  rotation: number,
  _isPolygon: boolean = true,
  isLastSegment: boolean = false
): Style {
  const fillColor = isLastSegment ? '#ffa657ee' : LOTES_SAI_MANZANA_COLOR + 'ee';

  return new Style({
    geometry: new Point(coordinate),
    text: new Text({
      text,
      font: '600 10px Courier New',
      fill: new Fill({ color: fillColor }),
      stroke: new Stroke({ color: 'rgba(0, 0, 0, 0.72)', width: 3 }),
      backgroundFill: new Fill({ color: LOTES_SAI_LIVE_BG }),
      padding: [2, 5, 2, 5],
      rotation,
      rotateWithView: true,
    }),
  });
}