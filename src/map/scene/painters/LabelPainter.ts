import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import { useSelectionStore } from '../../../store/map/selectionStore';
import {
  drawSegmentLabels,
  drawMainMetricLabel,
  resolveDimensionOrientation,
  computeLotGroupCounts,
  getApproxScreenArea,
} from '../../styleFactory';
import { formatMetricLength, formatMetricArea, type SegmentMetric } from '../../../geo/metrics';
import { MZN_COLORS_STR } from '../DrawLayerRenderer';
import { measureCached, measureCachedWidth } from '../../textMeasureCache';
import { getFeatureKind } from '../../../core/objectModel';

interface PlacedBox { x: number; y: number; w: number; h: number; }

function isColliding(
  ctx: CanvasRenderingContext2D,
  coord: [number, number],
  text: string,
  boxes: PlacedBox[],
  toPx: (c: number[]) => [number, number],
): boolean {
  const px = toPx(coord);
  const m = measureCached(ctx, text);
  const w = Math.abs(m.left) + Math.abs(m.right) + 12;
  const h = Math.abs(m.ascent) + Math.abs(m.descent) + 6;
  const bx = px[0] - w / 2;
  const by = px[1] - h / 2;
  for (const b of boxes) {
    if (bx < b.x + b.w && bx + w > b.x && by < b.y + b.h && by + h > b.y) return true;
  }
  boxes.push({ x: bx, y: by, w, h });
  return false;
}

/** Labels de área/perímetro/segmentos de lotes-manzanos + cotas manuales
 *  (`kind: 'cota'`). Extraído de PostrenderPainter (Fase 5). */
export class LabelPainter {
  private lotGroupCounts = new globalThis.Map<string, number>();

  update(features: Array<Feature<Geometry>>, changed: boolean): void {
    if (changed) this.lotGroupCounts = computeLotGroupCounts(features);
  }

  paint(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    zoom: number,
    resolution: number,
    toPx: (c: number[]) => [number, number],
    interacting: boolean,
  ): void {
    if (!interacting) this.paintFeatureLabels(ctx, features, zoom, resolution, toPx);
    this.paintManualCotaz(ctx, features, zoom, toPx);
  }

  private paintFeatureLabels(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    zoom: number,
    resolution: number,
    toPx: (c: number[]) => [number, number],
  ): void {
    const selectedIds = useSelectionStore.getState().selectedIds;
    const placedBoxes: PlacedBox[] = [];

    for (let fi = 0; fi < features.length; fi++) {
      const feature = features[fi];
      const kind = feature.get('kind') as string | undefined;
      if (kind === 'cota') continue;
      const geometry = feature.getGeometry();
      if (!geometry) continue;

      const isManzana = getFeatureKind(feature) === 'manzana';
      const colorIdx = feature.get('colorIdx') ?? 0;
      const featureId = feature.getId();
      const isSelected = featureId != null && selectedIds.has(featureId as string | number);
      const orientation = resolveDimensionOrientation(feature, this.lotGroupCounts);
      const labelPoint = feature.get('labelPoint') as [number, number] | undefined;

      if (geometry instanceof Polygon) {
        const coordinates = geometry.getCoordinates()[0] ?? [];
        if (coordinates.length < 3) continue;
        const showMainLabel = isSelected || zoom > 15.5 || getApproxScreenArea(geometry, resolution) >= 4200;
        if (showMainLabel && labelPoint) {
          const areaM2 = feature.get('areaM2') as number | undefined;
          if (areaM2 !== undefined) {
            const text = isManzana ? `Mzo. ${colorIdx + 1}` : formatMetricArea(areaM2);
            if (!isColliding(ctx, labelPoint, text, placedBoxes, toPx)) {
              if (isManzana) {
                const mznColor = MZN_COLORS_STR[colorIdx % MZN_COLORS_STR.length];
                drawMainMetricLabel(ctx, labelPoint, toPx, text, true, { extraLine: formatMetricArea(areaM2), color: mznColor });
              } else {
                drawMainMetricLabel(ctx, labelPoint, toPx, text, false);
              }
            }
          }
        }
        drawSegmentLabels(ctx, coordinates, feature.get('segmentLengths') as SegmentMetric[] | undefined, labelPoint, orientation, toPx, isManzana);
      } else if (geometry instanceof LineString) {
        const coordinates = geometry.getCoordinates() ?? [];
        if (coordinates.length < 2) continue;
        const showMainLabel = isSelected || zoom > 15.5;
        if (showMainLabel && labelPoint) {
          const lengthM = feature.get('lengthM') as number | undefined;
          if (lengthM !== undefined) {
            const text = formatMetricLength(lengthM);
            if (!isColliding(ctx, labelPoint, text, placedBoxes, toPx)) {
              drawMainMetricLabel(ctx, labelPoint, toPx, text, false);
            }
          }
        }
        drawSegmentLabels(ctx, coordinates, feature.get('segmentLengths') as SegmentMetric[] | undefined, labelPoint, orientation, toPx, false);
      }
    }
  }

  private paintManualCotaz(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    zoom: number,
    toPx: (c: number[]) => [number, number],
  ): void {
    if (zoom < 12) return;
    const selectedIds = useSelectionStore.getState().selectedIds;

    for (let fi = 0; fi < features.length; fi++) {
      const feature = features[fi];
      if (feature.get('kind') !== 'cota') continue;
      const geom = feature.getGeometry();
      if (!(geom instanceof LineString)) continue;

      const originStart = feature.get('originStart') as [number, number] | undefined;
      const originEnd = feature.get('originEnd') as [number, number] | undefined;
      const value = feature.get('value') as number | undefined;
      if (!originStart || !originEnd || value == null) continue;

      const featureId = feature.getId();
      const isSelected = featureId != null && selectedIds.has(featureId as string | number);

      const dimCoords = geom.getCoordinates();
      if (dimCoords.length < 2) continue;
      const dimStart = dimCoords[0] as [number, number];
      const dimEnd = dimCoords[dimCoords.length - 1] as [number, number];

      const dsPx = toPx(dimStart);
      const dePx = toPx(dimEnd);
      const osPx = toPx(originStart);
      const oePx = toPx(originEnd);

      ctx.save();
      ctx.strokeStyle = isSelected ? 'rgba(0, 200, 255, 0.85)' : 'rgba(0, 180, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(osPx[0], osPx[1]);
      ctx.lineTo(dsPx[0], dsPx[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(oePx[0], oePx[1]);
      ctx.lineTo(dePx[0], dePx[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = isSelected ? 'rgba(0, 200, 255, 0.95)' : 'rgba(0, 180, 255, 0.75)';
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(dsPx[0], dsPx[1]);
      ctx.lineTo(dePx[0], dePx[1]);
      ctx.stroke();
      ctx.restore();

      const tdx = dePx[0] - dsPx[0], tdy = dePx[1] - dsPx[1];
      const tlen = Math.hypot(tdx, tdy);
      if (tlen > 1) {
        const tux = tdx / tlen, tuy = tdy / tlen;
        const tickSize = 6;
        ctx.save();
        ctx.strokeStyle = isSelected ? 'rgba(0, 200, 255, 0.95)' : 'rgba(0, 180, 255, 0.75)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(dsPx[0] + (tux - tuy) * tickSize, dsPx[1] + (tuy + tux) * tickSize);
        ctx.lineTo(dsPx[0] - (tux - tuy) * tickSize, dsPx[1] - (tuy + tux) * tickSize);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(dePx[0] - (tux + tuy) * tickSize, dePx[1] - (tuy - tux) * tickSize);
        ctx.lineTo(dePx[0] + (tux + tuy) * tickSize, dePx[1] + (tuy - tux) * tickSize);
        ctx.stroke();
        ctx.restore();
      }

      if (zoom > 13) {
        const midPx: [number, number] = [(dsPx[0] + dePx[0]) / 2, (dsPx[1] + dePx[1]) / 2];
        let ang = Math.atan2(tdy, tdx);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        const fs = Math.max(9, Math.min(13, 10 * zoom / 18));
        const text = formatMetricLength(value);
        ctx.save();
        ctx.translate(midPx[0], midPx[1]);
        ctx.rotate(ang);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = `bold ${fs}px Courier New`;
        const tw = measureCachedWidth(ctx, text);
        ctx.fillStyle = 'rgba(13, 17, 23, 0.72)';
        ctx.fillRect(-tw / 2 - 4, -fs - 4, tw + 8, fs + 6);
        ctx.fillStyle = isSelected ? '#00ccff' : '#00b4ff';
        ctx.fillText(text, 0, -4);
        ctx.restore();
      }
    }
  }
}