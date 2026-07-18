import type Map from 'ol/Map.js';
import type VectorSource from 'ol/source/Vector.js';
import VectorSourceOl from 'ol/source/Vector.js';
import VectorLayer from 'ol/layer/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import { Style, Stroke, Fill, Circle as CircleStyle, Text } from 'ol/style.js';
import type { DrawMode } from '../../store/drawStore';
import { formatMetricLength } from '../../geo/metrics';

export type DimensionPhase = 'start' | 'end' | 'offset';

/**
 * State machine for the manual cota (dimension) tool.
 *
 * Phase 1 (start): user clicks → records origin A.
 * Phase 2 (end):   user clicks → records origin B, enters offset placement.
 * Phase 3 (offset): user moves mouse → preview follows perpendicular offset.
 *                   user clicks → finalizes the cota feature.
 */
export class DimensionInteraction {
  private readonly map: Map;
  private readonly drawSource: VectorSource;
  private readonly onFinalize: (feature: Feature<LineString>) => void;

  private tempLayer: VectorLayer<VectorSourceOl> | null = null;
  private tempSource: VectorSourceOl | null = null;

  private phase: DimensionPhase = 'start';
  private pointA: [number, number] | null = null;
  private pointB: [number, number] | null = null;
  private measuredDist = 0;

  private clickHandler: ((evt: any) => void) | null = null;
  private moveHandler: ((evt: any) => void) | null = null;

  constructor(
    map: Map,
    drawSource: VectorSource,
    onFinalize: (feature: Feature<LineString>) => void,
  ) {
    this.map = map;
    this.drawSource = drawSource;
    this.onFinalize = onFinalize;
  }

  /** Installs the interaction (adds layer + listeners). Returns a cleanup fn. */
  install(): () => void {
    const tempSource = new VectorSourceOl();
    this.tempSource = tempSource;
    const tempLayer = new VectorLayer({
      source: tempSource,
      style: this.previewStyle,
      zIndex: 999,
      properties: { name: 'cota-preview' },
    });
    this.tempLayer = tempLayer;
    this.map.addLayer(tempLayer);

    this.clickHandler = (evt: any) => this.handleClick(evt);
    this.moveHandler = (evt: any) => this.handleMove(evt);
    this.map.addEventListener('click', this.clickHandler);
    this.map.addEventListener('pointermove', this.moveHandler);

    return () => {
      if (this.clickHandler) this.map.removeEventListener('click', this.clickHandler);
      if (this.moveHandler) this.map.removeEventListener('pointermove', this.moveHandler);
      this.map.removeLayer(tempLayer);
      this.tempSource = null;
      this.tempLayer = null;
    };
  }

  private handleClick(evt: any): void {
    const coord = (evt.coordinate ?? evt.coordinate) as [number, number];
    if (!coord) return;

    if (this.phase === 'start') {
      this.pointA = coord;
      this.phase = 'end';
      this.updatePreview();
      return;
    }

    if (this.phase === 'end') {
      this.pointB = coord;
      const dx = coord[0] - this.pointA![0];
      const dy = coord[1] - this.pointA![1];
      this.measuredDist = Math.hypot(dx, dy);
      this.phase = 'offset';
      this.updatePreview();
      return;
    }

    if (this.phase === 'offset') {
      if (!this.pointA || !this.pointB || this.measuredDist < 0.01) return;
      const dx = this.pointB[0] - this.pointA[0];
      const dy = this.pointB[1] - this.pointA[1];
      const segLen = Math.hypot(dx, dy);
      if (segLen < 0.01) return;

      const nx = -dy / segLen;
      const ny = dx / segLen;
      const midX = (this.pointA[0] + this.pointB[0]) / 2;
      const midY = (this.pointA[1] + this.pointB[1]) / 2;
      const offset = (coord[0] - midX) * nx + (coord[1] - midY) * ny;

      const dimStart: [number, number] = [this.pointA[0] + nx * offset, this.pointA[1] + ny * offset];
      const dimEnd: [number, number] = [this.pointB[0] + nx * offset, this.pointB[1] + ny * offset];

      const dimLine = new LineString([dimStart, dimEnd]);
      const feature = new Feature(dimLine);
      feature.set('kind', 'cota');
      feature.set('originStart', this.pointA);
      feature.set('originEnd', this.pointB);
      feature.set('value', this.measuredDist);
      feature.set('unit', 'm');

      this.cleanup();
      this.onFinalize(feature);
    }
  }

  private handleMove(evt: any): void {
    if (this.phase !== 'offset' || !this.pointA || !this.pointB) return;
    const coord = (evt.coordinate ?? evt.coordinate) as [number, number];
    if (!coord) return;
    this.drawPreview(coord);
  }

  private updatePreview(): void {
    const src = this.tempSource;
    if (!src) return;
    src.clear();

    if (this.pointA && this.phase === 'end') {
      src.addFeature(new Feature(new Point(this.pointA)));
    }
    if (this.pointA && this.pointB) {
      src.addFeature(new Feature(new LineString([this.pointA, this.pointB])));
    }
  }

  private drawPreview(mouseCoord: [number, number]): void {
    const src = this.tempSource;
    if (!src || !this.pointA || !this.pointB) return;
    src.clear();

    const dx = this.pointB[0] - this.pointA[0];
    const dy = this.pointB[1] - this.pointA[1];
    const segLen = Math.hypot(dx, dy);
    if (segLen < 0.01) return;

    const nx = -dy / segLen;
    const ny = dx / segLen;
    const midX = (this.pointA[0] + this.pointB[0]) / 2;
    const midY = (this.pointA[1] + this.pointB[1]) / 2;
    const offset = (mouseCoord[0] - midX) * nx + (mouseCoord[1] - midY) * ny;

    const dimStart: [number, number] = [this.pointA[0] + nx * offset, this.pointA[1] + ny * offset];
    const dimEnd: [number, number] = [this.pointB[0] + nx * offset, this.pointB[1] + ny * offset];

    // Extension lines (from origins → dimension line)
    const extA = new Feature(new LineString([this.pointA, dimStart]));
    extA.setStyle(new Style({ stroke: new Stroke({ color: 'rgba(0, 180, 255, 0.6)', width: 1, lineDash: [4, 3] }) }));
    src.addFeature(extA);
    const extB = new Feature(new LineString([this.pointB, dimEnd]));
    extB.setStyle(new Style({ stroke: new Stroke({ color: 'rgba(0, 180, 255, 0.6)', width: 1, lineDash: [4, 3] }) }));
    src.addFeature(extB);

    // Dimension line
    const dimFeat = new Feature(new LineString([dimStart, dimEnd]));
    const dimStyle = new Style({
      stroke: new Stroke({ color: 'rgba(0, 180, 255, 0.95)', width: 2 }),
      text: new Text({
        text: formatMetricLength(this.measuredDist),
        font: 'bold 12px Courier New',
        fill: new Fill({ color: 'rgba(0, 180, 255, 0.95)' }),
        stroke: new Stroke({ color: '#0d1117', width: 3 }),
        textAlign: 'center',
        textBaseline: 'bottom',
        offsetY: -6,
      }),
    });
    dimFeat.setStyle(dimStyle);
    src.addFeature(dimFeat);

    // Origin points
    src.addFeature(new Feature(new Point(this.pointA)));
    src.addFeature(new Feature(new Point(this.pointB)));
  }

  private cleanup(): void {
    if (this.tempSource) this.tempSource.clear();
    if (this.clickHandler) this.map.removeEventListener('click', this.clickHandler);
    if (this.moveHandler) this.map.removeEventListener('pointermove', this.moveHandler);
    this.clickHandler = null;
    this.moveHandler = null;
    this.phase = 'start';
    this.pointA = null;
    this.pointB = null;
  }

  private readonly previewStyle = new Style({
    image: new CircleStyle({
      radius: 5,
      fill: new Fill({ color: 'rgba(0, 180, 255, 0.35)' }),
      stroke: new Stroke({ color: 'rgba(0, 180, 255, 0.95)', width: 1.5 }),
    }),
    stroke: new Stroke({
      color: 'rgba(0, 180, 255, 0.95)',
      width: 2,
      lineDash: [6, 4],
      lineCap: 'round',
    }),
  });
}
