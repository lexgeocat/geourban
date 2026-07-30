import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import { useSelectionStore } from '../../../store/map/selectionStore';
import {
  drawSegmentLabels,
  drawMainMetricLabel,
  drawLotNumberBadge,
  drawLotAreaCaption,
  resolveDimensionOrientation,
  computeLotGroupCounts,
  getApproxScreenArea,
  computeCotaOpacity,
} from '../../styleFactory';
import { formatMetricLength, formatMetricArea, type SegmentMetric } from '../../../geo/metrics';
import { manzanoDisplayColor } from '../../../geo/manzanoColor';
import { measureCached, measureCachedWidth } from '../../textMeasureCache';
import { getFeatureKind, getLotStatus } from '../../../core/objectModel';
import { useLayersStore } from '../../../store/entities/layersRegistryStore';
import { useUiShellStore } from '../../../store/ui/uiShellStore';

interface PlacedBox { x: number; y: number; w: number; h: number; }

const COLLISION_GRID_CELL_PX = 48;

class LabelCollisionGrid {
  private cells = new globalThis.Map<string, PlacedBox[]>();

  private key(cx: number, cy: number): string {
    return cx + ',' + cy;
  }

  private range(box: PlacedBox) {
    return {
      cx0: Math.floor(box.x / COLLISION_GRID_CELL_PX),
      cy0: Math.floor(box.y / COLLISION_GRID_CELL_PX),
      cx1: Math.floor((box.x + box.w) / COLLISION_GRID_CELL_PX),
      cy1: Math.floor((box.y + box.h) / COLLISION_GRID_CELL_PX),
    };
  }

  intersects(box: PlacedBox): boolean {
    const { cx0, cy0, cx1, cy1 } = this.range(box);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const b of bucket) {
          if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) {
            return true;
          }
        }
      }
    }
    return false;
  }

  insert(box: PlacedBox): void {
    const { cx0, cy0, cx1, cy1 } = this.range(box);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = this.key(cx, cy);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(box);
      }
    }
  }

  clear(): void {
    this.cells.clear();
  }
}

/** "Lote 5" → "5", "Remanente 2" → "2" — número compacto para el badge. */
function extractLotNumberText(label: string | undefined): string {
  if (!label) return '?';
  const match = label.match(/(\d+)/);
  return match ? match[1] : label;
}

function isColliding(
  ctx: CanvasRenderingContext2D,
  coord: [number, number],
  text: string,
  grid: LabelCollisionGrid,
  toPx: (c: number[]) => [number, number],
): boolean {
  const px = toPx(coord);
  const m = measureCached(ctx, text);
  const w = Math.abs(m.left) + Math.abs(m.right) + 12;
  const h = Math.abs(m.ascent) + Math.abs(m.descent) + 6;
  const box: PlacedBox = { x: px[0] - w / 2, y: px[1] - h / 2, w, h };
  if (grid.intersects(box)) return true;
  grid.insert(box);
  return false;
}

const LOD_TIER1_FEATURE_THRESHOLD = 350;
const LOD_TIER2_FEATURE_THRESHOLD = 900;

function computeLodTier(visibleCount: number): 0 | 1 | 2 {
  if (visibleCount > LOD_TIER2_FEATURE_THRESHOLD) return 2;
  if (visibleCount > LOD_TIER1_FEATURE_THRESHOLD) return 1;
  return 0;
}

interface ScreenAreaCacheEntry {
  bucket: number;
  version: number;
  area: number;
}

const SCREEN_AREA_CACHE_MAX = 6000;

export class LabelPainter {
  private lotGroupCounts = new globalThis.Map<string, number>();
  private readonly collisionGrid = new LabelCollisionGrid();

  private readonly screenAreaCache = new globalThis.Map<string | number, ScreenAreaCacheEntry>();

  update(features: Array<Feature<Geometry>>, changed: boolean): void {
    if (changed) this.lotGroupCounts = computeLotGroupCounts(features);
    if (this.screenAreaCache.size > SCREEN_AREA_CACHE_MAX) this.screenAreaCache.clear();
  }

  paint(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    zoom: number,
    resolution: number,
    toPx: (c: number[]) => [number, number],
    interacting: boolean,
  ): void {
    if (interacting) return; // antes solo protegía paintFeatureLabels, no paintManualCotaz
    this.paintFeatureLabels(ctx, features, zoom, resolution, toPx);
    this.paintManualCotaz(ctx, features, zoom, toPx);
  }

  /** Mismo criterio de bucket que geo/math/lod.ts, por consistencia. */
  private resolutionBucket(resolution: number): number {
    return Math.round(Math.log(resolution) / Math.log(1.35));
  }

  private getCachedScreenArea(
    feature: Feature<Geometry>,
    geometry: Geometry,
    resolution: number,
  ): number {
    const id = feature.getId();
    if (id == null) return getApproxScreenArea(geometry, resolution);

    const bucket = this.resolutionBucket(resolution);
    const version = (feature.get('metricsUpdatedAt') as number | undefined) ?? 0;
    const hit = this.screenAreaCache.get(id);
    if (hit && hit.bucket === bucket && hit.version === version) return hit.area;

    const area = getApproxScreenArea(geometry, resolution);
    this.screenAreaCache.set(id, { bucket, version, area });
    return area;
  }

  private paintFeatureLabels(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    zoom: number,
    resolution: number,
    toPx: (c: number[]) => [number, number],
  ): void {
    const selectedIds = useSelectionStore.getState().selectedIds;
    this.collisionGrid.clear();
    const zoomFade = computeCotaOpacity(zoom);
    const cotaMaster = useUiShellStore.getState().measurementsVisible ? 1 : 0;
    const lodTier = computeLodTier(features.length);

    const registry = useLayersStore.getState();

    for (let fi = 0; fi < features.length; fi++) {
      const feature = features[fi];
      const kind = feature.get('kind') as string | undefined;
      if (kind === 'cota') continue;
      const geometry = feature.getGeometry();
      if (!geometry) continue;

      const layerId = feature.get('layerId') as string | undefined;
      const featureLayer = layerId ? registry.getById(layerId) : undefined;
      if (featureLayer && !featureLayer.visible) continue;

      const featureKind = getFeatureKind(feature);
      const isManzana = featureKind === 'manzana';
      if (isManzana && getLotStatus(feature) === 'subdivided') continue;
      const isLote = featureKind === 'lote';
      const colorIdx = feature.get('colorIdx') ?? 0;
      const featureId = feature.getId();
      const isSelected = featureId != null && selectedIds.has(featureId as string | number);

      const allowSegmentCotas = lodTier === 0 || isSelected;
      const allowLabels = lodTier < 2 || isSelected;

      const labelOp = (featureLayer?.showLabel ?? true) ? 1 : 0;
      const cotaOp = (featureLayer?.showCota ?? true ? 1 : 0) * zoomFade * cotaMaster;

      const orientation = resolveDimensionOrientation(feature, this.lotGroupCounts);
      const labelPoint = feature.get('labelPoint') as [number, number] | undefined;

      if (geometry instanceof Polygon) {
        const coordinates = geometry.getCoordinates()[0] ?? [];
        if (coordinates.length < 3) continue;

        const areaM2 = feature.get('areaM2') as number | undefined;
        const areaText = areaM2 !== undefined ? formatMetricArea(areaM2) : null;
        const screenArea = this.getCachedScreenArea(feature, geometry, resolution);

        if (isManzana) {
          const baseShow = isSelected || zoom > 15.5 || screenArea >= 4200;
          const showTitle = baseShow && labelOp > 0.002 && allowLabels;
          const showArea = areaText != null && cotaOp > 0.002 && allowLabels;
          if ((showTitle || showArea) && labelPoint) {
            const text = `Mzo. ${colorIdx + 1}`;
            if (!isColliding(ctx, labelPoint, text, this.collisionGrid, toPx)) {
              const mznColor = manzanoDisplayColor(colorIdx);
              drawMainMetricLabel(ctx, labelPoint, toPx, text, true, {
                extraLine: areaText ?? undefined,
                color: mznColor,
                mainOpacity: showTitle ? labelOp : 0,
                extraLineOpacity: showArea ? cotaOp : 0,
              });
            }
          }
        } else if (isLote) {
          const baseShow = isSelected || zoom > 15.5 || screenArea >= 4200;
          const showBadge = baseShow && labelOp > 0.002 && allowLabels;
          const showCaption = areaText != null && cotaOp > 0.002 && allowLabels;
          if ((showBadge || showCaption) && labelPoint) {
            const collisionText = areaText ?? '?';
            if (!isColliding(ctx, labelPoint, collisionText, this.collisionGrid, toPx)) {
              if (showBadge) {
                const numberText = extractLotNumberText(feature.get('label') as string | undefined);
                const isRemnant = !!feature.get('isRemnant');
                drawLotNumberBadge(ctx, labelPoint, toPx, numberText, isRemnant, labelOp);
              }
              if (showCaption) {
                drawLotAreaCaption(ctx, labelPoint, toPx, areaText!, cotaOp);
              }
            }
          }
        } else if (labelPoint && areaText && cotaOp > 0.002 && allowLabels) {
          if (!isColliding(ctx, labelPoint, areaText, this.collisionGrid, toPx)) {
            drawMainMetricLabel(ctx, labelPoint, toPx, areaText, false, { mainOpacity: cotaOp });
          }
        }

        if (allowSegmentCotas) {
          drawSegmentLabels(
            ctx,
            feature.get('segmentLengths') as SegmentMetric[] | undefined,
            labelPoint,
            orientation,
            toPx,
            isManzana,
            cotaOp,
            !isLote,
            !isLote,
          );
        }
      } else if (geometry instanceof LineString) {
        const coordinates = geometry.getCoordinates() ?? [];
        if (coordinates.length < 2) continue;
        const showMainLabel = (isSelected || zoom > 15.5) && cotaOp > 0.002 && allowLabels;
        if (showMainLabel && labelPoint) {
          const lengthM = feature.get('lengthM') as number | undefined;
          if (lengthM !== undefined) {
            const text = formatMetricLength(lengthM);
            if (!isColliding(ctx, labelPoint, text, this.collisionGrid, toPx)) {
              drawMainMetricLabel(ctx, labelPoint, toPx, text, false, { mainOpacity: cotaOp });
            }
          }
        }
        if (allowSegmentCotas) {
          drawSegmentLabels(
            ctx,
            feature.get('segmentLengths') as SegmentMetric[] | undefined,
            labelPoint,
            orientation,
            toPx,
            false,
            cotaOp,
          );
        }
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
    const cotaMaster = useUiShellStore.getState().measurementsVisible ? 1 : 0;
    const cotaOp = cotaMaster;
    if (cotaOp <= 0.002) return;
    const selectedIds = useSelectionStore.getState().selectedIds;
    const registry = useLayersStore.getState();

    for (let fi = 0; fi < features.length; fi++) {
      const feature = features[fi];
      if (feature.get('kind') !== 'cota') continue;

      const layerId = feature.get('layerId') as string | undefined;
      const featureLayer = layerId ? registry.getById(layerId) : undefined;
      if (featureLayer && !featureLayer.visible) continue; // ← agregado

      ctx.save();
      ctx.globalAlpha *= cotaOp;
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
    ctx.restore();
    }
  }
}