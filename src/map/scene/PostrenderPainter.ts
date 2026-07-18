import type Map from 'ol/Map.js';
import type VectorSource from 'ol/source/Vector.js';
import type VectorLayer from 'ol/layer/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import { useStreetStore } from '../../store/streetStore';
import { useSelectionStore } from '../../store/selectionStore';
import { computeStreetFillets, filletArcPoints, type StreetFillet } from '../../geo/streetEngine';
import {
  drawSegmentLabels,
  drawMainMetricLabel,
  resolveDimensionOrientation,
  computeLotGroupCounts,
  getApproxScreenArea,
} from '../styleFactory';
import { formatMetricArea, formatMetricLength, type SegmentMetric } from '../../geo/metrics';
import { MZN_COLORS_STR } from './DrawLayerRenderer';
import type { SnapGuideVisual } from '../advancedSnap';

// Función para calcular el zoom a partir de la resolución
function getZoomFromResolution(resolution: number): number {
  return Math.log2(156543.03392804097 / resolution);
}

function streetsHash(streets: Array<{ id: string; start: [number, number]; end: [number, number]; widthM: number }>): string {
  return streets.map((s) => `${s.id}:${s.start[0]},${s.start[1]}-${s.end[0]},${s.end[1]}:${s.widthM}`).join('|');
}

interface PlacedBox { x: number; y: number; w: number; h: number; }

function isColliding(
  ctx: CanvasRenderingContext2D,
  coord: [number, number],
  text: string,
  boxes: PlacedBox[],
  toPx: (c: number[]) => [number, number],
): boolean {
  const px = toPx(coord);
  const m = ctx.measureText(text);
  const w = Math.abs(m.actualBoundingBoxLeft) + Math.abs(m.actualBoundingBoxRight) + 12;
  const h = Math.abs(m.actualBoundingBoxAscent) + Math.abs(m.actualBoundingBoxDescent) + 6;
  const bx = px[0] - w / 2;
  const by = px[1] - h / 2;
  for (const b of boxes) {
    if (bx < b.x + b.w && bx + w > b.x && by < b.y + b.h && by + h > b.y) return true;
  }
  boxes.push({ x: bx, y: by, w, h });
  return false;
}

export class PostrenderPainter {
  private cache = {
    lastZoom: -1,
    lastFeatureCount: -1,
    lastStreetHash: '',
    cachedFillets: [] as StreetFillet[],
    lotGroupCounts: new globalThis.Map<string, number>(),
    dirty: true,
  };

  private readonly map: Map;
  private readonly drawSource: VectorSource;
  private readonly postrenderLayer: VectorLayer<VectorSource>;
  private readonly listener: (event: any) => void;

  constructor(opts: {
    map: Map;
    drawSource: VectorSource;
    postrenderLayer: VectorLayer<VectorSource>;
  }) {
    this.map = opts.map;
    this.drawSource = opts.drawSource;
    this.postrenderLayer = opts.postrenderLayer;

    // Marcar dirty cuando cambian features
    const onFeatureChange = () => { this.cache.dirty = true; };
    this.drawSource.on('addfeature', onFeatureChange);
    this.drawSource.on('removefeature', onFeatureChange);
    this.drawSource.on('change', onFeatureChange);

    this.listener = (event: any) => this.handle(event);
    this.postrenderLayer.on('postrender', this.listener);
  }

  /** Llamar para invalidar el cache cuando cambia el set de features. */
  invalidate(): void {
    this.cache.dirty = true;
  }

  private handle(event: any): void {
    const ctx = event.context as CanvasRenderingContext2D | undefined;
    if (!ctx) return;

    const resolution = this.map.getView().getResolution() ?? 1;
    const zoom = getZoomFromResolution(resolution);
    const features = this.drawSource.getFeatures() ?? [];

    this.updateCache(features, zoom);

    const toPx = (coord: number[]): [number, number] => {
      const px = this.map.getPixelFromCoordinate(coord as [number, number]);
      return px ? [px[0], px[1]] : [0, 0];
    };

    this.paintFeatureLabels(ctx, features, zoom, resolution, toPx);
    this.paintManualCotaz(ctx, features, zoom, resolution, toPx);
    this.paintStreets(ctx, zoom, resolution, toPx);
    this.paintSnapGuides(ctx, resolution, toPx);
    this.paintLassoPreview(ctx, toPx);
  }

  private updateCache(features: Array<Feature<Geometry>>, _zoom: number): void {
    const currentFeatureCount = features.length;
    const streets = useStreetStore.getState().streets;
    const currentStreetHash = streetsHash(streets);
    const featuresChanged = currentFeatureCount !== this.cache.lastFeatureCount;
    const streetsChanged = currentStreetHash !== this.cache.lastStreetHash;

    if (streetsChanged || this.cache.dirty) {
      this.cache.cachedFillets = computeStreetFillets(streets);
      this.cache.lastStreetHash = currentStreetHash;
    }
    if (featuresChanged || this.cache.dirty) {
      this.cache.lotGroupCounts = computeLotGroupCounts(features as Feature<Geometry>[]);
    }
    this.cache.lastFeatureCount = currentFeatureCount;
    this.cache.dirty = false;
  }

  private paintFeatureLabels(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    zoom: number,
    resolution: number,
    toPx: (c: number[]) => [number, number],
  ): void {
    const selectedIds = useSelectionStore.getState().selectedIds;
    const placedBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];

    for (let fi = 0; fi < features.length; fi++) {
      const feature = features[fi];
      const kind = feature.get('kind') as string | undefined;
      if (kind === 'cota') continue; // rendered by paintManualCotaz
      const geometry = feature.getGeometry();
      if (!geometry) continue;

      const isManzana = feature.get('type') === 'manzana';
      const colorIdx = feature.get('colorIdx') ?? 0;
      const featureId = feature.getId();
      const isSelected = featureId != null && selectedIds.has(featureId as string | number);
      const orientation = resolveDimensionOrientation(
        feature as Feature<Geometry>,
        this.cache.lotGroupCounts,
      );
      const labelPoint = feature.get('labelPoint') as [number, number] | undefined;

      if (geometry instanceof Polygon) {
        const coordinates = geometry.getCoordinates()[0] ?? [];
        if (coordinates.length < 3) continue;
        const showMainLabel =
          isSelected || zoom > 15.5 || getApproxScreenArea(geometry, resolution) >= 4200;
        if (showMainLabel && labelPoint) {
          const areaM2 = feature.get('areaM2') as number | undefined;
          if (areaM2 !== undefined) {
            const text = isManzana
              ? `Mzo. ${colorIdx + 1}`
              : formatMetricArea(areaM2);
            if (!isColliding(ctx, labelPoint, text, placedBoxes, toPx)) {
              if (isManzana) {
                const mznColor = MZN_COLORS_STR[colorIdx % MZN_COLORS_STR.length];
                drawMainMetricLabel(ctx, labelPoint, toPx, text, true, {
                  extraLine: formatMetricArea(areaM2),
                  color: mznColor,
                });
              } else {
                drawMainMetricLabel(ctx, labelPoint, toPx, text, false);
              }
            }
          }
        }
        drawSegmentLabels(
          ctx,
          coordinates,
          feature.get('segmentLengths') as SegmentMetric[] | undefined,
          labelPoint,
          orientation,
          toPx,
          isManzana,
        );
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
        drawSegmentLabels(
          ctx,
          coordinates,
          feature.get('segmentLengths') as SegmentMetric[] | undefined,
          labelPoint,
          orientation,
          toPx,
          false,
        );
      }
    }
  }

  private paintManualCotaz(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    zoom: number,
    _resolution: number,
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

      // Extension lines (dashed, from origins to dimension line)
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

      // Dimension line
      ctx.save();
      ctx.strokeStyle = isSelected ? 'rgba(0, 200, 255, 0.95)' : 'rgba(0, 180, 255, 0.75)';
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(dsPx[0], dsPx[1]);
      ctx.lineTo(dePx[0], dePx[1]);
      ctx.stroke();
      ctx.restore();

      // Ticks (45-degree marks at each end)
      const tdx = dePx[0] - dsPx[0], tdy = dePx[1] - dsPx[1];
      const tlen = Math.hypot(tdx, tdy);
      if (tlen > 1) {
        const tux = tdx / tlen, tuy = tdy / tlen;
        const tickSize = 6;
        ctx.save();
        ctx.strokeStyle = isSelected ? 'rgba(0, 200, 255, 0.95)' : 'rgba(0, 180, 255, 0.75)';
        ctx.lineWidth = 1.5;
        // Tick at start
        ctx.beginPath();
        ctx.moveTo(dsPx[0] + (tux - tuy) * tickSize, dsPx[1] + (tuy + tux) * tickSize);
        ctx.lineTo(dsPx[0] - (tux - tuy) * tickSize, dsPx[1] - (tuy + tux) * tickSize);
        ctx.stroke();
        // Tick at end
        ctx.beginPath();
        ctx.moveTo(dePx[0] - (tux + tuy) * tickSize, dePx[1] - (tuy - tux) * tickSize);
        ctx.lineTo(dePx[0] + (tux + tuy) * tickSize, dePx[1] + (tuy - tux) * tickSize);
        ctx.stroke();
        ctx.restore();
      }

      // Value text centered above the dimension line
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
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(13, 17, 23, 0.72)';
        ctx.fillRect(-tw / 2 - 4, -fs - 4, tw + 8, fs + 6);
        ctx.fillStyle = isSelected ? '#00ccff' : '#00b4ff';
        ctx.fillText(text, 0, -4);
        ctx.restore();
      }
    }
  }

  private paintStreets(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    resolution: number,
    toPx: (c: number[]) => [number, number],
  ): void {
    const streets = useStreetStore.getState().streets;
    const streetVisible = useStreetStore.getState().visible;
    if (!streetVisible || streets.length === 0) return;
    const fillets = this.cache.cachedFillets;

    for (let si = 0; si < streets.length; si++) {
      const s = streets[si];
      // Build full coordinate chain: start + waypoints + end
      const allCoords: Array<[number, number]> = [s.start];
      if (s.waypoints) {
        for (const wp of s.waypoints) allCoords.push(wp);
      }
      allCoords.push(s.end);

      const allPx = allCoords.map((c) => toPx(c));
      const halfPx = (s.widthM / 2) / resolution;

      // Compute perpendicular offsets at each vertex
      const normals: Array<[number, number]> = [];
      for (let i = 0; i < allPx.length; i++) {
        const prev = allPx[Math.max(0, i - 1)];
        const next = allPx[Math.min(allPx.length - 1, i + 1)];
        const dx = next[0] - prev[0], dy = next[1] - prev[1];
        const len = Math.hypot(dx, dy);
        if (len < 0.1) {
          normals.push(normals[i - 1] ?? [0, 1]);
        } else {
          normals.push([-dy / len, dx / len]);
        }
      }

      // ── Cuerpo de calle (polygon strip) ──
      ctx.save();
      ctx.fillStyle = 'rgba(247, 129, 102, 0.08)';
      ctx.beginPath();
      for (let i = 0; i < allPx.length; i++) {
        const nx = normals[i][0] * halfPx, ny = normals[i][1] * halfPx;
        if (i === 0) ctx.moveTo(allPx[i][0] + nx, allPx[i][1] + ny);
        else ctx.lineTo(allPx[i][0] + nx, allPx[i][1] + ny);
      }
      for (let i = allPx.length - 1; i >= 0; i--) {
        const nx = normals[i][0] * halfPx, ny = normals[i][1] * halfPx;
        ctx.lineTo(allPx[i][0] - nx, allPx[i][1] - ny);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // ── Bordes sólidos ──
      ctx.save();
      ctx.strokeStyle = 'rgba(247, 129, 102, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      for (const side of [1, -1]) {
        ctx.beginPath();
        for (let i = 0; i < allPx.length; i++) {
          const nx = normals[i][0] * halfPx * side, ny = normals[i][1] * halfPx * side;
          if (i === 0) ctx.moveTo(allPx[i][0] + nx, allPx[i][1] + ny);
          else ctx.lineTo(allPx[i][0] + nx, allPx[i][1] + ny);
        }
        ctx.stroke();
      }
      ctx.restore();

      // ── Eje central punteado ──
      ctx.save();
      ctx.strokeStyle = 'rgba(247, 129, 102, 0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      for (let i = 0; i < allPx.length; i++) {
        if (i === 0) ctx.moveTo(allPx[i][0], allPx[i][1]);
        else ctx.lineTo(allPx[i][0], allPx[i][1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Etiqueta de calle
      if (zoom > 12) {
        // Use the middle segment's midpoint and angle
        const midIdx = Math.floor(allPx.length / 2);
        const midA = allPx[Math.max(0, midIdx - 1)];
        const midB = allPx[Math.min(allPx.length - 1, midIdx)];
        const midPx: [number, number] = [(midA[0] + midB[0]) / 2, (midA[1] + midB[1]) / 2];
        const ldx = midB[0] - midA[0], ldy = midB[1] - midA[1];
        let ang = Math.atan2(ldy, ldx);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        const fs1 = Math.max(9, Math.min(13, 10 * zoom / 18));
        const fs2 = Math.max(8, Math.min(11, 9 * zoom / 18));
        ctx.save();
        ctx.translate(midPx[0], midPx[1]);
        ctx.rotate(ang);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${fs1}px Courier New`;
        ctx.fillStyle = 'rgba(247, 129, 102, 0.85)';
        ctx.fillText(`--- ${s.name} (Ancho de Vía ${s.widthM.toFixed(2)}m) ---`, 0, -fs1 * 0.8);
        ctx.font = `${fs2}px Courier New`;
        ctx.fillStyle = 'rgba(247, 129, 102, 0.55)';
        ctx.fillText('E   J   E    D   E     V   Í   A', 0, fs2 * 0.8);
        ctx.restore();
      }
    }

    // Fillets
    ctx.save();
    ctx.strokeStyle = 'rgba(247, 129, 102, 0.65)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const fillet of fillets) {
      const arcPts = filletArcPoints(fillet, 16);
      if (arcPts.length < 2) continue;
      const firstPx = toPx(arcPts[0]);
      ctx.beginPath();
      ctx.moveTo(firstPx[0], firstPx[1]);
      for (let i = 1; i < arcPts.length; i++) {
        const px = toPx(arcPts[i]);
        ctx.lineTo(px[0], px[1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private paintSnapGuides(
    ctx: CanvasRenderingContext2D,
    resolution: number,
    _toPx: (c: number[]) => [number, number],
  ): void {
    // El guide lo inyecta el SnapEngine vía paintSnapGuide().
    if (!this.currentGuide) return;
    this.paintGuide(ctx, this.currentGuide, resolution);
  }

  /* ─── Lasso / Rect selection preview (Fase 4) ─── */
  private currentLassoPreview: import('./LassoSelection').LassoPreview = null;

  setLassoPreview(preview: import('./LassoSelection').LassoPreview): void {
    this.currentLassoPreview = preview;
    this.postrenderLayer.changed();
  }

  private paintLassoPreview(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number],
  ): void {
    const preview = this.currentLassoPreview;
    if (!preview) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.95)';
    ctx.fillStyle = 'rgba(0, 212, 255, 0.10)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);

    if (preview.mode === 'rect') {
      const a = toPx(preview.start);
      const b = toPx(preview.current);
      const x = Math.min(a[0], b[0]);
      const y = Math.min(a[1], b[1]);
      const w = Math.abs(b[0] - a[0]);
      const h = Math.abs(b[1] - a[1]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    } else if (preview.mode === 'lasso') {
      const pts = preview.points;
      if (pts.length > 0) {
        ctx.beginPath();
        const first = toPx(pts[0]);
        ctx.moveTo(first[0], first[1]);
        for (let i = 1; i < pts.length; i++) {
          const p = toPx(pts[i]);
          ctx.lineTo(p[0], p[1]);
        }
        // Cerramos visualmente con la posición actual del cursor
        if (preview.current) {
          const cur = toPx(preview.current);
          ctx.lineTo(cur[0], cur[1]);
        } else {
          ctx.lineTo(first[0], first[1]);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  private currentGuide: SnapGuideVisual | null = null;

  /** Llamado por el snap engine cuando cambia la guía. */
  setSnapGuide(guide: SnapGuideVisual | null): void {
    this.currentGuide = guide;
    this.postrenderLayer.changed();
  }

  private paintGuide(
    ctx: CanvasRenderingContext2D,
    guide: SnapGuideVisual,
    resolution: number,
  ): void {
    if (guide.highlightSegment) {
      const [ga, gb] = guide.highlightSegment;
      const gaPx = this.map.getPixelFromCoordinate(ga);
      const gbPx = this.map.getPixelFromCoordinate(gb);
      if (gaPx && gbPx) {
        ctx.save();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(gaPx[0], gaPx[1]);
        ctx.lineTo(gbPx[0], gbPx[1]);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (guide.dashedLine) {
      const [da, db] = guide.dashedLine;
      const daPx = this.map.getPixelFromCoordinate(da);
      const dbPx = this.map.getPixelFromCoordinate(db);
      if (daPx && dbPx) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.85)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(daPx[0], daPx[1]);
        ctx.lineTo(dbPx[0], dbPx[1]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
    if (guide.rightAngleSquare) {
      const { point, size } = guide.rightAngleSquare;
      const centerPx = this.map.getPixelFromCoordinate(point);
      if (centerPx) {
        const sizePx = Math.max(6, size / resolution);
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(centerPx[0] - sizePx / 2, centerPx[1] - sizePx / 2, sizePx, sizePx);
        ctx.restore();
      }
    }
    if (guide.distanceLabel) {
      const { point, text } = guide.distanceLabel;
      const px = this.map.getPixelFromCoordinate(point);
      if (px) {
        ctx.save();
        ctx.font = '10px Courier New';
        ctx.fillStyle = 'rgba(0, 212, 255, 0.9)';
        ctx.textAlign = 'center';
        ctx.fillText(text, px[0], px[1] - 6);
        ctx.restore();
      }
    }
  }

  dispose(): void {
    this.postrenderLayer.un('postrender', this.listener);
  }
}
