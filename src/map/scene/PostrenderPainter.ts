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

/**
 * Encapsula todo el post-render Canvas2D del mapa:
 *  - Cotas y labels de features
 *  - Dibujo de calles (cuerpo, bordes, eje, etiqueta) y fillets
 *  - Guías visuales de snap (línea punteada, escuadra, segmento resaltado)
 *
 * El painter mantiene un cache de fillets y lotGroups para no recalcular
 * en cada frame — solo cuando features/calles cambian.
 */
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
    this.paintStreets(ctx, zoom, resolution, toPx);
    this.paintSnapGuides(ctx, resolution, toPx);
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
    for (let fi = 0; fi < features.length; fi++) {
      const feature = features[fi];
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
            if (isManzana) {
              const mznColor = MZN_COLORS_STR[colorIdx % MZN_COLORS_STR.length];
              drawMainMetricLabel(ctx, labelPoint, toPx, `Mzo. ${colorIdx + 1}`, true, {
                extraLine: formatMetricArea(areaM2),
                color: mznColor,
              });
            } else {
              drawMainMetricLabel(ctx, labelPoint, toPx, formatMetricArea(areaM2), false);
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
            drawMainMetricLabel(ctx, labelPoint, toPx, formatMetricLength(lengthM), false);
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
      const sPx = toPx(s.start);
      const ePx = toPx(s.end);
      const dx = ePx[0] - sPx[0], dy = ePx[1] - sPx[1];
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const nx = -dy / len, ny = dx / len;
      const halfPx = (s.widthM / 2) / resolution;

      // Cuerpo de calle
      ctx.save();
      ctx.fillStyle = 'rgba(247, 129, 102, 0.08)';
      ctx.beginPath();
      ctx.moveTo(sPx[0] + nx * halfPx, sPx[1] + ny * halfPx);
      ctx.lineTo(ePx[0] + nx * halfPx, ePx[1] + ny * halfPx);
      ctx.lineTo(ePx[0] - nx * halfPx, ePx[1] - ny * halfPx);
      ctx.lineTo(sPx[0] - nx * halfPx, sPx[1] - ny * halfPx);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Bordes sólidos
      ctx.save();
      ctx.strokeStyle = 'rgba(247, 129, 102, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      for (const side of [1, -1]) {
        const ox = nx * halfPx * side;
        const oy = ny * halfPx * side;
        ctx.beginPath();
        ctx.moveTo(sPx[0] + ox, sPx[1] + oy);
        ctx.lineTo(ePx[0] + ox, ePx[1] + oy);
        ctx.stroke();
      }
      ctx.restore();

      // Eje central punteado
      ctx.save();
      ctx.strokeStyle = 'rgba(247, 129, 102, 0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(sPx[0], sPx[1]);
      ctx.lineTo(ePx[0], ePx[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Etiqueta de calle
      if (zoom > 12) {
        const midPx: [number, number] = [(sPx[0] + ePx[0]) / 2, (sPx[1] + ePx[1]) / 2];
        let ang = Math.atan2(dy, dx);
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
