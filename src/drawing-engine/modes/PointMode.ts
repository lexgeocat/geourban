import Draw from 'ol/interaction/Draw.js';
import { primaryAction } from 'ol/events/condition.js';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { runCommand } from '@kernel/command/CommandStack';
import { AddFeatureCommand } from '../commands/AddFeatureCommand';
import { updateFeatureMetrics } from '@georef-engine/metrics';
import { resolveOrCreateLayerForKind } from '@layers-engine/store/layerResolution';
import type { ModeContext } from '@kernel/modes/ModeContext';

export function activatePoint(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'Point',
    condition: primaryAction,
    style: new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: 'rgba(52, 211, 153, 0.35)' }),
        stroke: new Stroke({ color: 'rgba(52, 211, 153, 0.95)', width: 2 }),
      }),
    }),
  });

  draw.on('drawend', (event) => {
    const feature = event.feature as Feature<Geometry>;
    const layerId = resolveOrCreateLayerForKind('punto');

    void (async () => {
      await runCommand(
        new AddFeatureCommand(feature, {
          mode: 'claim',
          label: 'Dibujar punto',
          kind: 'punto',
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
