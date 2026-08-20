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
import { updateFeatureMetrics } from '@georef-engine/metrics';
import { buildSegmentLiveLabels } from '../styles/liveDimensions';
import { resolveOrCreateLayerForKind } from '@layers-engine/store/layerResolution';
import { SKETCH_POLY_COLOR, SKETCH_POLY_FILL } from '../styles/sketchVisualization';
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
                fill: new Fill({ color: SKETCH_POLY_FILL }),
                stroke: new Stroke({ color: SKETCH_POLY_COLOR, width: 1.5 }),
              }),
            })
          : null;

      const lineStyle = new Style({
        stroke: new Stroke({
          color: SKETCH_POLY_COLOR,
          width: 2,
          lineDash: [6, 4],
          lineCap: 'round',
        }),
      });

      const segmentLabels = buildSegmentLiveLabels(map, sketchCoords);

      return [lineStyle, vertexStyle, ...segmentLabels].filter((s): s is Style => s !== null);
    },
  });

  draw.on('drawend', (event) => {
    const feature = event.feature as Feature<Geometry>;
    const layerId = resolveOrCreateLayerForKind('perimetro');

    void (async () => {
      await runCommand(
        new AddFeatureCommand(feature, {
          mode: 'claim',
          label: 'Dibujar perímetro',
          kind: 'perimetro',
          layerId,
        })
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
