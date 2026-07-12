import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { StyleFunction } from 'ol/style/Style.js';
import { Fill, Stroke, Style, Text } from 'ol/style.js';
import { formatMetricArea, formatMetricLength, type SegmentMetric } from '../geo/metrics';

// ─── Colores LOTES_SAI (fuente de verdad) ───────────────────────────
const LOTES_SAI_MANZANA_COLOR = '#58a6ff';
const LOTES_SAI_TEXT_BG = 'rgba(13, 17, 23, 0.72)';
const LOTES_SAI_LIVE_BG = 'rgba(13, 17, 23, 0.80)';

// ─── Estilos OL para etiquetas estáticas (Pipeline 2) ────────────────
const CAD_TEXT_FILL = new Fill({ color: '#dffcff' });
const CAD_TEXT_STROKE = new Stroke({ color: 'rgba(0, 0, 0, 0.72)', width: 3 });
const CAD_TEXT_BG = new Fill({ color: 'rgba(8, 13, 22, 0.82)' });
const CAD_SELECTED_BG = new Fill({ color: 'rgba(88, 166, 255, 0.18)' });

function getZoomFromResolution(resolution: number) {
  return Math.log2(156543.03392804097 / resolution);
}

/**
 * Centroide simple de un anillo de puntos (promedio de coordenadas).
 * Idéntico al `centroid()` de LOTES_SAI.
 */
function ringCentroid(points: number[][]): [number, number] {
  let cx = 0, cy = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    cx += points[i][0];
    cy += points[i][1];
  }
  return [cx / n, cy / n];
}

// ─── Etiqueta de texto OL (estática, para measurementLayer) ──────────
function makeTextStyle(
  text: string,
  coordinate: [number, number],
  options?: {
    rotation?: number;
    offsetX?: number;
    offsetY?: number;
    selected?: boolean;
    isManzana?: boolean;
  }
) {
  const isManzana = options?.isManzana ?? true;
  return new Style({
    geometry: new Point(coordinate),
    text: new Text({
      text,
      font: isManzana
        ? '600 11px Courier New'
        : '500 10px Courier New',
      fill: options?.selected
        ? new Fill({ color: '#111827' })
        : isManzana
          ? CAD_TEXT_FILL
          : new Fill({ color: '#ffffff' }),
      stroke: options?.selected ? undefined : CAD_TEXT_STROKE,
      backgroundFill: options?.selected
        ? CAD_SELECTED_BG
        : isManzana
          ? CAD_TEXT_BG
          : undefined,
      padding: isManzana ? [2, 5, 2, 5] : undefined,
      placement: 'point',
      rotation: options?.rotation ?? 0,
      rotateWithView: true,
      offsetX: options?.offsetX ?? 0,
      offsetY: options?.offsetY ?? 0,
    }),
  });
}

function getApproxScreenArea(feature: Feature<Geometry>, resolution: number) {
  const geometry = feature.getGeometry();
  if (!geometry) return 0;
  const extent = geometry.getExtent();
  const widthPx = Math.abs(extent[2] - extent[0]) / resolution;
  const heightPx = Math.abs(extent[3] - extent[1]) / resolution;
  return widthPx * heightPx;
}

const SIDE_OFFSET_PX = 18;

/**
 * Calcula la normal perpendicular hacia AFUERA del polígono usando el
 * método de LOTES_SAI: dot product entre la normal del segmento y el
 * vector desde el centroide hasta el midpoint. Si el dot >= 0, la normal
 * apunta hacia afuera; si no, se invierte.
 *
 * Para lotes se invierte la lógica (hacia adentro).
 */
function computeSegmentNormal(
  midpoint: [number, number],
  angle: number,
  centroid: [number, number] | undefined,
  outward: boolean
): [number, number] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Normales perpendiculares al segmento
  const n1: [number, number] = [-sin, cos];
  const n2: [number, number] = [sin, -cos];

  if (centroid) {
    const vx = centroid[0] - midpoint[0];
    const vy = centroid[1] - midpoint[1];
    const dot = n1[0] * vx + n1[1] * vy;

    // dot >= 0 → n1 apunta hacia el centroide (inward)
    // dot <  0 → n1 apunta hacia afuera
    if (outward) {
      return dot >= 0 ? n2 : n1;
    } else {
      return dot >= 0 ? n1 : n2;
    }
  }

  return outward ? n1 : n1;
}

/**
 * Dibuja acotaciones de segmentos en el canvas, replicando el estilo
 * exacto de LOTES_SAI render.js líneas 203-303.
 *
 * MANZANAS: label hacia AFUERA, fondo oscuro, color manzana (#58a6ff).
 * LOTES:    label hacia ADENTRO (al centroide), texto blanco sin fondo.
 *
 * @param ctx Contexto del canvas.
 * @param points Coordenadas del polígono en el sistema del mundo (EPSG:3857).
 * @param zoom Nivel de zoom actual.
 * @param isManzana Si es una manzana (afecta dirección, colores y fondo).
 * @param resolution Resolución actual del mapa.
 */
export function drawSegmentLabels(
  ctx: CanvasRenderingContext2D,
  points: number[][],
  zoom: number,
  isManzana: boolean = false,
  resolution: number = 1
) {
  const MPP = resolution / 156543.03392804097;
  const MIN_SEGMENT_LENGTH_M = 0.5;
  const MIN_SEGMENT_PX = 28;

  // Centroide del polígono (método LOTES_SAI)
  const cen = ringCentroid(points);

  for (let i = 0; i < points.length; i++) {
    const pA = points[i];
    const pB = points[(i + 1) % points.length];
    const dx = pB[0] - pA[0];
    const dy = pB[1] - pA[1];
    const lenM = Math.hypot(dx, dy) * MPP;
    const lenPx = Math.hypot(dx, dy) / resolution;

    if (lenM < MIN_SEGMENT_LENGTH_M || lenPx < MIN_SEGMENT_PX) continue;

    const midX = (pA[0] + pB[0]) / 2;
    const midY = (pA[1] + pB[1]) / 2;
    let ang = Math.atan2(dy, dx);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;

    // Normal perpendicular del segmento
    const segLen = Math.hypot(dx, dy) || 1;
    const nxSeg = -dy / segLen;
    const nySeg = dx / segLen;

    // Dot product con centroide → decide dirección (LOTES_SAI exacto)
    const dotOut = (midX - cen[0]) * nxSeg + (midY - cen[1]) * nySeg;

    let dirX: number, dirY: number, offsetPx: number, fs: number;

    if (isManzana) {
      // MANZANA: hacia afuera, fondo oscuro, color manzana
      dirX = dotOut >= 0 ? nxSeg : -nxSeg;
      dirY = dotOut >= 0 ? nySeg : -nySeg;
      offsetPx = Math.max(10, 13 * zoom);
      fs = Math.max(10, Math.min(15, 11 * zoom));
    } else {
      // LOTE: hacia adentro (al centroide), texto blanco sin fondo
      dirX = dotOut >= 0 ? -nxSeg : nxSeg;
      dirY = dotOut >= 0 ? -nySeg : nySeg;
      offsetPx = Math.max(7, 9 * zoom);
      fs = Math.max(9, Math.min(13, 10 * zoom));
    }

    const txC = midX + dirX * offsetPx;
    const tyC = midY + dirY * offsetPx;

    const label = lenM >= 100 ? lenM.toFixed(1) + ' m' : lenM.toFixed(2) + ' m';

    ctx.save();
    ctx.translate(txC, tyC);
    ctx.rotate(ang);
    ctx.font = isManzana ? `600 ${fs}px Courier New` : `500 ${fs}px Courier New`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (isManzana) {
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = LOTES_SAI_TEXT_BG;
      ctx.fillRect(-tw / 2 - 2, -fs / 2 - 1, tw + 4, fs + 2);
      ctx.fillStyle = LOTES_SAI_MANZANA_COLOR + 'ee';
    } else {
      ctx.fillStyle = '#ffffff';
    }
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
}

/**
 * Calcula estilos de segmentos para la measurementLayer (OL StyleFunction).
 * Replica la lógica de LOTES_SAI: manzanas outward+bg, lotes inward+sin bg.
 */
function getSegmentStyles(
  segments: SegmentMetric[],
  labelPoint: [number, number] | undefined,
  geometry: Geometry | null,
  zoom: number,
  selected: boolean,
  isManzana: boolean
) {
  if (!selected && zoom < 19) return [];

  return segments.map((segment) => {
    const angle = segment.angleRad;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const outward = isManzana;
    const [nx, ny] = computeSegmentNormal(segment.midpoint, angle, labelPoint, outward);

    const offsetX = (nx * cos + ny * sin) * SIDE_OFFSET_PX;
    const offsetY = (nx * -sin + ny * cos) * SIDE_OFFSET_PX;

    return makeTextStyle(formatMetricLength(segment.lengthM), segment.midpoint, {
      rotation: angle,
      offsetX,
      offsetY,
      selected,
      isManzana,
    });
  });
}

export function createMeasurementStyle(): StyleFunction {
  return (rawFeature, resolution) => {
    const feature = rawFeature as Feature<Geometry>;
    const zoom = getZoomFromResolution(resolution);
    const selected = feature.get('selected') === true;
    const labelPoint = feature.get('labelPoint') as [number, number] | undefined;
    const segmentLengths = (feature.get('segmentLengths') as SegmentMetric[] | undefined) ?? [];
    const isManzana = feature.get('type') === 'manzana';
    const styles: Style[] = [];

    if (!labelPoint) return styles;

    const screenArea = getApproxScreenArea(feature, resolution);
    const canShowMainLabel = selected || zoom >= 17 || screenArea >= 5200;

    if (canShowMainLabel) {
      const areaM2 = feature.get('areaM2') as number | undefined;
      const lengthM = feature.get('lengthM') as number | undefined;
      const mainText = areaM2 !== undefined
        ? formatMetricArea(areaM2)
        : lengthM !== undefined
          ? formatMetricLength(lengthM)
          : '';

      if (mainText) {
        styles.push(makeTextStyle(mainText, labelPoint, { selected, isManzana }));
      }
    }

    styles.push(
      ...getSegmentStyles(
        segmentLengths,
        labelPoint,
        feature.getGeometry(),
        zoom,
        selected,
        isManzana
      )
    );
    return styles;
  };
}

/**
 * Estilos para labels en vivo durante el dibujo (rubber-band).
 * Replica exactamente LOTES_SAI render.js líneas 799-868.
 *
 * @param isPolygon Si el sketch es un polígono (true) o línea (false).
 * @param isLastSegment Si es el último segmento (el que va al cursor).
 *                       LOTES_SAI lo pinta naranja (#ffa657).
 */
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
