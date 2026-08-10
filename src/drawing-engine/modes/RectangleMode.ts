import Draw, { createBox } from 'ol/interaction/Draw.js';
import { primaryAction } from 'ol/events/condition.js';
import { Fill, Stroke, Style } from 'ol/style.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { runCommand } from '../../../commands/core/CommandStack';
import { AddFeatureCommand } from '../../../commands/features/AddFeatureCommand';
import { updateFeatureMetrics } from '../../../geo/metrics';
import { resolveOrCreateLayerForKind } from '../../../store/entities/layerAutoCreate';
import type { ModeContext } from './ModeContext';

export function activateRectangle(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'Circle',
    geometryFunction: createBox(),
    condition: primaryAction,
    style: new Style({
      stroke: new Stroke({ color: 'rgba(0, 212, 255, 0.95)', width: 2, lineDash: [6, 4] }),
      fill: new Fill({ color: 'rgba(0, 212, 255, 0.10)' }),
    }),
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