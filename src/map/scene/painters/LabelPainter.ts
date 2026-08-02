import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { Extent } from 'ol/extent.js';
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
import { recordLabelCacheHit, recordLabelCacheMiss } from '../../../store/debug/debugCounters';
import { manzanoDisplayColor } from '../../../geo/manzanoColor';
import { measureCached } from '../../textMeasureCache';
import { getFeatureKind, getLotStatus } from '../../../core/objectModel';
import { useLayersStore } from '../../../store/entities/layersRegistryStore';

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

  // ─── Caché de ops (Fase 4.3) ────────────────────────────────────────────
  // El pase de etiquetas (colisiones + decisiones) es O(n) y corre en cada
  // postrender aunque el viewport y los datos no hayan cambiado (el pulse
  // de selección redibuja a 24fps, streetPainter llama map.render(), etc.).
  // Gateamos la reconstrucción con una firma: si nada cambió, re-ejecutamos
  // las ops de dibujo ya decididas (solo canvas, sin medir ni colisionar).
  private dataVersion = 0;
  private lastKey: string | null = null;
  private cachedOps: Array<(ctx: CanvasRenderingContext2D, toPx: (c: number[]) => [number, number]) => void> = [];

  private recordOp(
    op: (ctx: CanvasRenderingContext2D, toPx: (c: number[]) => [number, number]) => void,
  ): void {
    this.cachedOps.push(op);
  }

  /** Hash de la selección: tamaño + primeros ids (la selección de edición es
   *  chica; para selecciones masivas el tamaño + ventana cubren el cambio). */
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

// src/map/scene/painters/LabelPainter.ts
// Reemplazar el método `layersKey` existente por este:

  /**
   * Firma de capas relevante para el caché de ops (Fase 4.3).
   * IMPORTANTE: debe incluir TODO campo de `Layer` que `paintFeatureLabels`
   * lea directamente de `featureLayer` — hoy son `visible`, `showLabel` y
   * `showCota`. Si en el futuro se lee algún campo nuevo de la capa acá
   * (p.ej. opacity para labels), hay que sumarlo también a esta firma o
   * el toggle correspondiente quedará "pisado" por un cache hit stale,
   * igual que pasaba antes con showLabel/showCota (bug corregido acá).
   */
  private layersKey(): string {
    let sig = '';
    for (const layer of useLayersStore.getState().layers) {
      sig +=
        layer.id +
        (layer.visible ? '1' : '0') +
        (layer.showLabel ? '1' : '0') +
        (layer.showCota ? '1' : '0') +
        '|';
    }
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
  ): void {
    if (interacting) return;
    const key = this.computeCacheKey(features, zoom, resolution, extent);
    if (key !== 'no-extent' && key === this.lastKey) {
      recordLabelCacheHit();
      for (const op of this.cachedOps) op(ctx, toPx);
      return;
    }
    recordLabelCacheMiss();
    this.lastKey = key;
    this.cachedOps = [];
    this.paintFeatureLabels(ctx, features, zoom, resolution, toPx);
    for (const op of this.cachedOps) op(ctx, toPx);
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
    const lodTier = computeLodTier(features.length);
    const registry = useLayersStore.getState();

    for (let fi = 0; fi < features.length; fi++) {
      const feature = features[fi];
      const rawKind = feature.get('kind') as string | undefined;
      if (rawKind === 'cota') continue;
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

      const labelOp = (featureLayer?.showLabel ?? false) ? 1 : 0;
      const cotaOp = (featureLayer?.showCota ?? false ? 1 : 0) * zoomFade;

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
        if (coordinates.length < 2) continue;
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
}