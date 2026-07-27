import Draw from 'ol/interaction/Draw.js';
import { Stroke, Style } from 'ol/style.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useDrawStore } from '../../../store/map/drawStore';
import { runCommand } from '../../../commands/core/CommandStack';
import { AddFeatureCommand } from '../../../commands/features/AddFeatureCommand';
import { updateFeatureMetrics } from '../../../geo/metrics';
import { pickLayerForKind } from '../../../store/ui/layerPickerStore';
import type { ModeContext } from './ModeContext';

export function activateLine(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'LineString',
    style: new Style({
      stroke: new Stroke({ color: 'rgba(0, 212, 255, 0.95)', width: 2, lineDash: [6, 4], lineCap: 'round' }),
    }),
  });
  draw.on('drawend', (event) => {
    const feature = event.feature as Feature<Geometry>;
    void (async () => {
      const layerId = await pickLayerForKind('linea');
      await runCommand(new AddFeatureCommand(feature, { mode: 'claim', label: 'Dibujar línea', kind: 'linea', layerId }));
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