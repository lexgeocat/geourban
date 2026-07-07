import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { StyleFunction } from 'ol/style/Style.js';
import { Fill, Stroke, Style, Text } from 'ol/style.js';
import { formatMetricArea, formatMetricLength, type SegmentMetric } from '../geo/metrics';

const CAD_TEXT_FILL = new Fill({ color: '#dffcff' });
const CAD_TEXT_STROKE = new Stroke({ color: 'rgba(0, 0, 0, 0.72)', width: 3 });
const CAD_TEXT_BG = new Fill({ color: 'rgba(8, 13, 22, 0.82)' });
const CAD_SELECTED_BG = new Fill({ color: 'rgba(245, 158, 11, 0.88)' });

function getZoomFromResolution(resolution: number) {
  return Math.log2(156543.03392804097 / resolution);
}

function makeTextStyle(text: string, coordinate: [number, number], options?: {
  rotation?: number;
  offsetY?: number;
  selected?: boolean;
}) {
  return new Style({
    geometry: new Point(coordinate),
    text: new Text({
      text,
      font: '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fill: options?.selected ? new Fill({ color: '#111827' }) : CAD_TEXT_FILL,
      stroke: options?.selected ? undefined : CAD_TEXT_STROKE,
      backgroundFill: options?.selected ? CAD_SELECTED_BG : CAD_TEXT_BG,
      padding: [2, 5, 2, 5],
      placement: 'point',
      rotation: options?.rotation ?? 0,
      rotateWithView: true,
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

function getSegmentStyles(segments: SegmentMetric[], zoom: number, selected: boolean) {
  if (!selected && zoom < 19) return [];

  return segments.map((segment) =>
    makeTextStyle(formatMetricLength(segment.lengthM), segment.midpoint, {
      rotation: segment.angleRad,
      offsetY: -12,
      selected,
    })
  );
}

export function createMeasurementStyle(): StyleFunction {
  return (rawFeature, resolution) => {
    const feature = rawFeature as Feature<Geometry>;
    const zoom = getZoomFromResolution(resolution);
    const selected = feature.get('selected') === true;
    const labelPoint = feature.get('labelPoint') as [number, number] | undefined;
    const segmentLengths = (feature.get('segmentLengths') as SegmentMetric[] | undefined) ?? [];
    const styles: Style[] = [];

    if (!labelPoint) return styles;

    const screenArea = getApproxScreenArea(feature, resolution);
    const canShowMainLabel = selected || zoom >= 17 || screenArea >= 5200;
    const canShowDetail = selected || zoom >= 18;

    if (canShowMainLabel) {
      const areaM2 = feature.get('areaM2') as number | undefined;
      const perimeterM = feature.get('perimeterM') as number | undefined;
      const lengthM = feature.get('lengthM') as number | undefined;
      const mainText = areaM2
        ? canShowDetail && perimeterM
          ? `${formatMetricArea(areaM2)} / P ${formatMetricLength(perimeterM)}`
          : formatMetricArea(areaM2)
        : formatMetricLength(lengthM);

      if (mainText) styles.push(makeTextStyle(mainText, labelPoint, { selected }));
    }

    styles.push(...getSegmentStyles(segmentLengths, zoom, selected));
    return styles;
  };
}
