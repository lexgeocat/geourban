import Draw, { createBox } from 'ol/interaction/Draw.js';
import { primaryAction } from 'ol/events/condition.js';
import { Fill, Stroke, Style } from 'ol/style.js';
import Polygon from 'ol/geom/Polygon.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { runCommand } from '@kernel/command/CommandStack';
import { AddFeatureCommand } from '../commands/AddFeatureCommand';
import { updateFeatureMetrics } from '@georef-engine/metrics';
import { buildSegmentLiveLabels } from '../styles/liveDimensions';
import { resolveOrCreateLayerForKind } from '@layers-engine/store/layerResolution';
import { SKETCH_POLY_COLOR } from '../styles/sketchVisualization';
import type { ModeContext } from '@kernel/modes/ModeContext';

export function activateRectangle(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'Circle',
    geometryFunction: createBox(),
    condition: primaryAction,
    style: (feature) => {
      const shapeStyle = new Style({
        stroke: new Stroke({ color: SKETCH_POLY_COLOR, width: 2, lineDash: [6, 4] }),
        fill: new Fill({ color: 'rgba(0, 212, 255, 0.10)' }),
      });
      const geom = feature.getGeometry();
      const ring = geom instanceof Polygon ? (geom.getCoordinates()[0] ?? []) : [];
      const segmentLabels = buildSegmentLiveLabels(map, ring);
      return [shapeStyle, ...segmentLabels];
    },
  });
  draw.on('drawend', (event) => {
    const feature = event.feature as Feature<Geometry>;
    feature.set('shapeType', 'rectangle', true); // habilita el resize inteligente en modo edición
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
