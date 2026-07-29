import type Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { StyleFunction } from 'ol/style/Style.js';
import { Fill, Stroke, Style, Text } from 'ol/style.js';
import type { SegmentMetric } from '../geo/metrics';
import { measureCachedWidth } from './textMeasureCache';
import { getFeatureKind } from '../core/objectModel';

// ─── Colores
const GEOURBAN_MANZANA_COLOR = '#58a6ff';
const GEOURBAN_TEXT_BG = 'rgba(13, 17, 23, 0.72)';
const GEOURBAN_LIVE_BG = 'rgba(13, 17, 23, 0.80)';
const DIM_EXT_COLOR_LOTE = 'rgba(56, 189, 248, 0.30)';
const DIM_LINE_COLOR_LOTE = 'rgba(56, 189, 248, 0.92)';   // celeste suave
const DIM_EXT_COLOR_MZN = 'rgba(255, 183, 121, 0.30)';
const DIM_LINE_COLOR_MZN = 'rgba(255, 183, 121, 0.92)';   // ámbar suave
const DIM_EXT_GAP_PX = 3;
const DIM_TICK_PX = 6;
const DIM_TEXT_HALO_COLOR = 'rgba(13, 17, 23, 0.85)';

export const COTA_APPEAR_ZOOM = 19.6;
const COTA_FULL_ZOOM = 20.1;

export function computeCotaOpacity(zoom: number): number {
  if (zoom <= COTA_APPEAR_ZOOM) return 0;
  if (zoom >= COTA_FULL_ZOOM) return 1;
  return (zoom - COTA_APPEAR_ZOOM) / (COTA_FULL_ZOOM - COTA_APPEAR_ZOOM);
}

// ─── Badge de número de lote (círculo en el centroide) ────────────────
const LOT_BADGE_RADIUS_PX = 9;
const LOT_BADGE_COLOR = 'rgba(56, 189, 248, 0.92)';         // celeste suave — lote normal
const LOT_BADGE_COLOR_REMNANT = 'rgba(245, 187, 89, 0.92)'; // ámbar suave — remanente
const LOT_BADGE_FILL = 'rgba(13, 17, 23, 0.45)';
const LOT_AREA_CAPTION_COLOR = 'rgba(223, 252, 255, 0.92)';

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
  if (getFeatureKind(feature) === 'manzana') return 'outward';
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
  segmentLengths: SegmentMetric[] | undefined,
  centroidWorld: [number, number] | undefined,
  orientation: DimensionOrientation,
  toPixel: (coord: number[]) => [number, number],
  isManzana: boolean = false,
  opacity: number = 1,
  drawLines: boolean = true,
  showBackground: boolean = true,
): void {
  if (!segmentLengths || segmentLengths.length === 0) return;
  if (opacity <= 0.002) return;

  const MIN_SEGMENT_PX = 34;
  const extColor = isManzana ? DIM_EXT_COLOR_MZN : DIM_EXT_COLOR_LOTE;
  const mainColor = isManzana ? DIM_LINE_COLOR_MZN : DIM_LINE_COLOR_LOTE;
  const offsetPx = isManzana ? 17 : 13;
  const fs = isManzana ? 12 : 10.5;
  const cenPx = centroidWorld ? toPixel(centroidWorld) : null;

  ctx.save();
  ctx.globalAlpha *= opacity;

  for (let i = 0; i < segmentLengths.length; i++) {
    const meta = segmentLengths[i];
    if (!meta || !Number.isFinite(meta.lengthM) || meta.lengthM <= 0) continue;
    if (!meta.p0 || !meta.p1) continue;

    const aPx = toPixel(meta.p0);
    const bPx = toPixel(meta.p1);
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

    if (drawLines) {
      drawExtensionLine(ctx, aPx, nx, ny, offsetPx, extColor);
      drawExtensionLine(ctx, bPx, nx, ny, offsetPx, extColor);
    }

    const dimA: [number, number] = [aPx[0] + nx * offsetPx, aPx[1] + ny * offsetPx];
    const dimB: [number, number] = [bPx[0] + nx * offsetPx, bPx[1] + ny * offsetPx];

    if (drawLines) {
      ctx.save();
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(dimA[0], dimA[1]);
      ctx.lineTo(dimB[0], dimB[1]);
      ctx.stroke();
      ctx.restore();

      drawDimTick(ctx, dimA, ang, mainColor);
      drawDimTick(ctx, dimB, ang, mainColor);
    }

    const txC = (dimA[0] + dimB[0]) / 2;
    const tyC = (dimA[1] + dimB[1]) / 2;
    const label = meta.lengthM >= 100 ? meta.lengthM.toFixed(1) + ' m' : meta.lengthM.toFixed(2) + ' m';

    ctx.save();
    ctx.translate(txC, tyC);
    ctx.rotate(ang);
    ctx.font = isManzana ? `600 ${fs}px Courier New` : `500 ${fs}px Courier New`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (showBackground) {
      const tw = measureCachedWidth(ctx, label);
      ctx.fillStyle = GEOURBAN_TEXT_BG;
      ctx.fillRect(-tw / 2 - 3, -fs / 2 - 1.5, tw + 6, fs + 3);
      ctx.fillStyle = mainColor;
      ctx.fillText(label, 0, 0);
    } else {
      ctx.lineWidth = 3;
      ctx.strokeStyle = DIM_TEXT_HALO_COLOR;
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = mainColor;
      ctx.fillText(label, 0, 0);
    }
    ctx.restore();
  }

  ctx.restore();
}

export function drawLotNumberBadge(
  ctx: CanvasRenderingContext2D,
  labelPointWorld: [number, number],
  toPixel: (coord: number[]) => [number, number],
  numberText: string,
  isRemnant: boolean,
  opacity: number = 1,
): void {
  if (opacity <= 0.002) return;
  const px = toPixel(labelPointWorld);
  const color = isRemnant ? LOT_BADGE_COLOR_REMNANT : LOT_BADGE_COLOR;

  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.beginPath();
  ctx.arc(px[0], px[1], LOT_BADGE_RADIUS_PX, 0, Math.PI * 2);
  ctx.fillStyle = LOT_BADGE_FILL;
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = color;
  ctx.stroke();

  ctx.font = '700 10px Courier New';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(numberText, px[0], px[1] + 0.5);
  ctx.restore();
}

/** Superficie del lote, debajo del badge — halo en vez de caja de fondo. */
export function drawLotAreaCaption(
  ctx: CanvasRenderingContext2D,
  labelPointWorld: [number, number],
  toPixel: (coord: number[]) => [number, number],
  areaText: string,
  opacity: number = 1,
): void {
  if (opacity <= 0.002) return;
  const px = toPixel(labelPointWorld);
  const fs = 10;
  const y = px[1] + LOT_BADGE_RADIUS_PX + fs * 0.95;

  ctx.save();
  ctx.globalAlpha *= opacity;
  ctx.font = `500 ${fs}px Courier New`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = DIM_TEXT_HALO_COLOR;
  ctx.strokeText(areaText, px[0], y);
  ctx.fillStyle = LOT_AREA_CAPTION_COLOR;
  ctx.fillText(areaText, px[0], y);
  ctx.restore();
}

export function drawMainMetricLabel(
  ctx: CanvasRenderingContext2D,
  labelPointWorld: [number, number],
  toPixel: (coord: number[]) => [number, number],
  text: string,
  isManzana: boolean,
  options?: { extraLine?: string; color?: string; mainOpacity?: number; extraLineOpacity?: number },
): void {
  const mainOpacity = options?.mainOpacity ?? 1;
  const extraLineOpacity = options?.extraLineOpacity ?? 1;
  const hasExtra = !!options?.extraLine && extraLineOpacity > 0.002;
  if (mainOpacity <= 0.002 && !hasExtra) return;

  const px = toPixel(labelPointWorld);
  const fs = isManzana ? 13 : 11.5;
  const mainColor = options?.color ?? (isManzana ? GEOURBAN_MANZANA_COLOR : '#dffcff');

  if (mainOpacity > 0.002) {
    ctx.save();
    ctx.globalAlpha *= mainOpacity;
    ctx.font = `700 ${fs}px Courier New`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = measureCachedWidth(ctx, text);
    ctx.fillStyle = GEOURBAN_TEXT_BG;
    ctx.fillRect(px[0] - tw / 2 - 4, px[1] - fs / 2 - 2, tw + 8, fs + 4);
    ctx.fillStyle = mainColor + 'ee';
    ctx.fillText(text, px[0], px[1]);
    ctx.restore();
  }

  if (hasExtra) {
    ctx.save();
    ctx.globalAlpha *= extraLineOpacity;
    const fs2 = fs * 0.8;
    ctx.font = `500 ${fs2}px Courier New`;
    const tw2 = measureCachedWidth(ctx, options!.extraLine!);
    const y2 = px[1] + fs * 0.5 + fs2 * 0.6 + 2;
    ctx.fillStyle = GEOURBAN_TEXT_BG;
    ctx.fillRect(px[0] - tw2 / 2 - 3, y2 - fs2 / 2 - 1.5, tw2 + 6, fs2 + 3);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.fillText(options!.extraLine!, px[0], y2);
    ctx.restore();
  }
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
  const fillColor = isLastSegment ? '#ffa657ee' : GEOURBAN_MANZANA_COLOR + 'ee';

  return new Style({
    geometry: new Point(coordinate),
    text: new Text({
      text,
      font: '600 10px Courier New',
      fill: new Fill({ color: fillColor }),
      stroke: new Stroke({ color: 'rgba(0, 0, 0, 0.72)', width: 3 }),
      backgroundFill: new Fill({ color: GEOURBAN_LIVE_BG }),
      padding: [2, 5, 2, 5],
      rotation,
      rotateWithView: true,
    }),
  });
}