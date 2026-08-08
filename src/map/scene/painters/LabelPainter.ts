import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { Extent } from 'ol/extent.js';
import type VectorSource from 'ol/source/Vector.js';
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
  GEOURBAN_MANZANA_COLOR,
} from '../../styleFactory';
import { formatMetricLength, formatMetricArea, type SegmentMetric } from '../../../geo/metrics';
import { measureCached } from '../../textMeasureCache';
import { getFeatureKind, getLotStatus } from '../../../core/objectModel';
import { useLayersStore } from '../../../store/entities/layersRegistryStore';
import type { Layer } from '../../../core/objectModel';

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

const HARD_VISIBLE_CAP = 15_000;

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

  private dataVersion = 0;
  private lastKey: string | null = null;
  private cachedOps: Array<(ctx: CanvasRenderingContext2D, toPx: (c: number[]) => [number, number]) => void> = [];
  private layersKeyCache: { layers: Layer[]; key: string } | null = null;

  private recordOp(
    op: (ctx: CanvasRenderingContext2D, toPx: (c: number[]) => [number, number]) => void,
  ): void {
    this.cachedOps.push(op);
  }

  private selectionKey(): number {
    const ids = useSelectionStore.getState().selectedIds;
    let h = ids.size;
    let i = 0;
    for (const id of ids) {
      if (i >= 512) break;
      const s = String(id);
      for (let j = 0; j < s.length; j++) h = (Math.imul(h, 31) + s.charCodeAt(j)) | 0;
      i++;
    }
    return h;
  }

  private layersKey(): string {
    const layers = useLayersStore.getState().layers;
    if (this.layersKeyCache && this.layersKeyCache.layers === layers) {
      return this.layersKeyCache.key;
    }
    let sig = '';
    for (const layer of layers) {
      sig +=
        layer.id +
        (layer.visible ? '1' : '0') +
        (layer.showLabel ? '1' : '0') +
        (layer.showCota ? '1' : '0') +
        '|';
    }
    this.layersKeyCache = { layers, key: sig };
    return sig;
  }

  private computeCacheKey(
    features: Array<Feature<Geometry>>,
    zoom: number,
    resolution: number,
    extent: Extent | null,
  ): string {
    if (!extent) return 'no-extent';
    const q = Math.max(resolution * 2, 1e-9);
    const [minX, minY, maxX, maxY] = extent;
    const e = `${Math.round(minX / q)},${Math.round(minY / q)},${Math.round(maxX / q)},${Math.round(maxY / q)}`;
    return `${e}|${zoom.toFixed(4)}|${features.length}|${this.dataVersion}|${this.selectionKey()}|${this.layersKey()}`;
  }

  update(features: Array<Feature<Geometry>>, changed: boolean): void {
    if (changed) {
      this.lotGroupCounts = computeLotGroupCounts(features);
      this.dataVersion++;
    }
    if (this.screenAreaCache.size > SCREEN_AREA_CACHE_MAX) this.screenAreaCache.clear();
  }

  paint(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    zoom: number,
    resolution: number,
    toPx: (c: number[]) => [number, number],
    interacting: boolean,
    extent: Extent | null,
    drawSource: VectorSource,
  ): void {
    if (interacting) return;
    const key = this.computeCacheKey(features, zoom, resolution, extent);
    if (key !== 'no-extent' && key === this.lastKey) {
      for (const op of this.cachedOps) op(ctx, toPx);
      return;
    }
    this.lastKey = key;
    this.cachedOps = [];
    this.paintFeatureLabels(ctx, features, zoom, resolution, toPx, drawSource);
    for (const op of this.cachedOps) op(ctx, toPx);
  }

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
    drawSource: VectorSource,
  ): void {
    const selectedIds = useSelectionStore.getState().selectedIds;
    this.collisionGrid.clear();
    const zoomFade = computeCotaOpacity(zoom);
    const registry = useLayersStore.getState();

    if (features.length > HARD_VISIBLE_CAP) {
      if (selectedIds.size === 0) return;
      for (const id of selectedIds) {
        const feature = drawSource.getFeatureById(id) as Feature<Geometry> | null;
        if (!feature) continue;
        this.paintOneFeature(ctx, feature, true, zoom, resolution, zoomFade, 2, registry, toPx);
      }
      return;
    }

    const lodTier = computeLodTier(features.length);
    for (let fi = 0; fi < features.length; fi++) {
      const feature = features[fi];
      const featureId = feature.getId();
      const isSelected = featureId != null && selectedIds.has(featureId as string | number);
      this.paintOneFeature(ctx, feature, isSelected, zoom, resolution, zoomFade, lodTier, registry, toPx);
    }
  }

  private paintOneFeature(
    ctx: CanvasRenderingContext2D,
    feature: Feature<Geometry>,
    isSelected: boolean,
    zoom: number,
    resolution: number,
    zoomFade: number,
    lodTier: 0 | 1 | 2,
    registry: ReturnType<typeof useLayersStore.getState>,
    toPx: (c: number[]) => [number, number],
  ): void {
    const rawKind = feature.get('kind') as string | undefined;
    if (rawKind === 'cota') return;
    const geometry = feature.getGeometry();
    if (!geometry) return;

    const layerId = feature.get('layerId') as string | undefined;
    const featureLayer = layerId ? registry.getById(layerId) : undefined;
    if (featureLayer && !featureLayer.visible) return;

    const featureKind = getFeatureKind(feature);
    const isManzana = featureKind === 'manzana';
    if (isManzana && getLotStatus(feature) === 'subdivided') return;
    const isLote = featureKind === 'lote';
    const colorIdx = feature.get('colorIdx') ?? 0;

    const allowSegmentCotas = lodTier === 0 || isSelected;
    const allowLabels = lodTier < 2 || isSelected;

    const labelOp = (featureLayer?.showLabel ?? false) ? 1 : 0;
    const cotaOp = (featureLayer?.showCota ?? false ? 1 : 0) * zoomFade;

    const orientation = resolveDimensionOrientation(feature, this.lotGroupCounts);
    const labelPoint = feature.get('labelPoint') as [number, number] | undefined;

    if (geometry instanceof Polygon) {
      const coordinates = geometry.getCoordinates()[0] ?? [];
      if (coordinates.length < 3) return;

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
            const mznColor = featureLayer?.color ?? GEOURBAN_MANZANA_COLOR;
            this.recordOp((c, px) =>
              drawMainMetricLabel(c, labelPoint, px, text, true, {
                extraLine: areaText ?? undefined,
                color: mznColor,
                mainOpacity: showTitle ? labelOp : 0,
                extraLineOpacity: showArea ? cotaOp : 0,
              }),
            );
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
              this.recordOp((c, px) => drawLotNumberBadge(c, labelPoint, px, numberText, isRemnant, labelOp));
            }
            if (showCaption) {
              this.recordOp((c, px) => drawLotAreaCaption(c, labelPoint, px, areaText!, cotaOp));
            }
          }
        }
      } else if (labelPoint && areaText && cotaOp > 0.002 && allowLabels) {
        if (!isColliding(ctx, labelPoint, areaText, this.collisionGrid, toPx)) {
          this.recordOp((c, px) => drawMainMetricLabel(c, labelPoint, px, areaText, false, { mainOpacity: cotaOp }));
        }
      }

      if (allowSegmentCotas) {
        this.recordOp((c, px) =>
          drawSegmentLabels(
            c,
            feature.get('segmentLengths') as SegmentMetric[] | undefined,
            labelPoint,
            orientation,
            px,
            isManzana,
            cotaOp,
            !isLote,
            !isLote,
          ),
        );
      }
    } else if (geometry instanceof LineString) {
      const coordinates = geometry.getCoordinates() ?? [];
      if (coordinates.length < 2) return;
      const showMainLabel = (isSelected || zoom > 15.5) && cotaOp > 0.002 && allowLabels;
      if (showMainLabel && labelPoint) {
        const lengthM = feature.get('lengthM') as number | undefined;
        if (lengthM !== undefined) {
          const text = formatMetricLength(lengthM);
          if (!isColliding(ctx, labelPoint, text, this.collisionGrid, toPx)) {
            this.recordOp((c, px) => drawMainMetricLabel(c, labelPoint, px, text, false, { mainOpacity: cotaOp }));
          }
        }
      }
      if (allowSegmentCotas) {
        this.recordOp((c, px) =>
          drawSegmentLabels(
            c,
            feature.get('segmentLengths') as SegmentMetric[] | undefined,
            labelPoint,
            orientation,
            px,
            false,
            cotaOp,
          ),
        );
      }
    }
  }
}