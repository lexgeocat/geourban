import Draw from 'ol/interaction/Draw.js';
import { primaryAction } from 'ol/events/condition.js';
import { Stroke, Style } from 'ol/style.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useDrawStore } from '@map-core/store/drawStore';
import { runCommand } from '@kernel/command/CommandStack';
import { AddFeatureCommand } from '../commands/AddFeatureCommand';
import { updateFeatureMetrics } from '@georef-engine/metrics';
import { requireLayerForKind } from '@layers-engine/store/layerPickerStore';
import type { ModeContext } from '@kernel/modes/ModeContext';

export function activatePolyline(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'LineString',
    condition: primaryAction,
    style: new Style({
      stroke: new Stroke({
        color: 'rgba(255, 214, 10, 0.95)',
        width: 2,
        lineDash: [6, 4],
        lineCap: 'round',
      }),
    }),
  });
  draw.on('drawend', (event) => {
    const feature = event.feature as Feature<Geometry>;
    void (async () => {
      const layerId = await requireLayerForKind('polilinea');
      if (!layerId) {
        src.removeFeature(feature);
        src.changed();
        return;
      }
      await runCommand(
        new AddFeatureCommand(feature, {
          mode: 'claim',
          label: 'Dibujar polilínea',
          kind: 'polilinea',
          layerId,
        })
      );
      useDrawStore.getState().setLastDrawnLineId(feature.getId() as string);
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
