import Draw from 'ol/interaction/Draw.js';
import { primaryAction } from 'ol/events/condition.js';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import MultiPoint from 'ol/geom/MultiPoint.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { runCommand } from '@kernel/command/CommandStack';
import { AddFeatureCommand } from '../commands/AddFeatureCommand';
import { updateFeatureMetrics, projectPathToMetricPlane } from '@georef-engine/metrics';
import { createLiveDrawingLabelStyle } from '../styles/styleFactory';
import { resolveOrCreateLayerForKind } from '@layers-engine/store/layerResolution';
import type { ModeContext } from '@kernel/modes/ModeContext';

export function activatePolygon(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'Polygon',
    condition: primaryAction,
    style: (feature) => {
      const geom = feature.getGeometry();
      const sketchCoords =
        geom instanceof LineString
          ? geom.getCoordinates()
          : geom instanceof Polygon
            ? (geom.getCoordinates()[0] ?? [])
            : [];

      const confirmedCoords = sketchCoords.length > 1 ? sketchCoords.slice(0, -1) : [];
      const vertexStyle =
        confirmedCoords.length > 0
          ? new Style({
              geometry: new MultiPoint(confirmedCoords as number[][]),
              image: new CircleStyle({
                radius: 5,
                fill: new Fill({ color: 'rgba(0, 212, 255, 0.25)' }),
                stroke: new Stroke({ color: 'rgba(0, 212, 255, 0.95)', width: 1.5 }),
              }),
            })
          : null;

      const lineStyle = new Style({
        stroke: new Stroke({ color: 'rgba(0, 212, 255, 0.95)', width: 2, lineDash: [6, 4], lineCap: 'round' }),
      });

      const segmentLabels: Style[] = [];
      const skRes = map.getView().getResolution() ?? 1;
      const PX_OFF = 14;
      const totalSegments = sketchCoords.length >= 2 ? sketchCoords.length - 1 : 0;
      if (sketchCoords.length >= 2) {
        for (let i = 0; i < sketchCoords.length - 1; i++) {
          const a = sketchCoords[i];
          const b = sketchCoords[i + 1];
          if (!a || !b) continue;
          const sdx = b[0] - a[0];
          const sdy = b[1] - a[1];
          const segLen = Math.hypot(sdx, sdy);
          if (segLen < 0.3) continue;
          const [aM, bM] = projectPathToMetricPlane([a, b] as Array<[number, number]>);
          const liveLen = aM && bM ? Math.hypot(bM[0] - aM[0], bM[1] - aM[1]) : 0;
          if (liveLen < 0.3) continue;
          const midX = (a[0] + b[0]) / 2;
          const midY = (a[1] + b[1]) / 2;
          const angle = Math.atan2(sdy, sdx);
          let textAngle = angle;
          if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
          const perpLen = PX_OFF * skRes;
          const perpNx = -sdy / segLen;
          const perpNy = sdx / segLen;
          const labelX = midX + perpNx * perpLen;
          const labelY = midY + perpNy * perpLen;

          const isLastSegment = i === totalSegments - 1;
          const label = liveLen >= 100 ? liveLen.toFixed(1) + ' m' : liveLen.toFixed(2) + ' m';

          segmentLabels.push(createLiveDrawingLabelStyle(label, [labelX, labelY], textAngle, true, isLastSegment));
        }
      }

      return [lineStyle, vertexStyle, ...segmentLabels].filter((s): s is Style => s !== null);
    },
  });

  draw.on('drawend', (event) => {
    const feature = event.feature as Feature<Geometry>;
    const layerId = resolveOrCreateLayerForKind('perimetro');

    void (async () => {
      await runCommand(
        new AddFeatureCommand(feature, { mode: 'claim', label: 'Dibujar perímetro', kind: 'perimetro', layerId }),
      );
      updateFeatureMetrics(feature);
      ctx.refreshLayers();
    })();
  });
  ctx.activeDrawRef.current = draw;
  map.addInteraction(draw);
  ctx.addCleanup(() => {
    map.removeInteraction(draw);
    if (ctx.activeDrawRef.current === draw) ctx.activeDrawRef.current = null;
  });
}