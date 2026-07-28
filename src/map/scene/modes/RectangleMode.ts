import Draw, { createBox } from 'ol/interaction/Draw.js';
import { Fill, Stroke, Style } from 'ol/style.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useDrawStore } from '../../../store/map/drawStore';
import { runCommand } from '../../../commands/core/CommandStack';
import { AddFeatureCommand } from '../../../commands/features/AddFeatureCommand';
import { updateFeatureMetrics } from '../../../geo/metrics';
import { requireLayerForKind } from '../../../store/ui/layerPickerStore';
import { resolveOrCreateLayerForKind } from '../../../store/entities/layerAutoCreate';
import type { ModeContext } from './ModeContext';

export function activateRectangle(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'Circle',
    geometryFunction: createBox(),
    style: new Style({
      stroke: new Stroke({ color: 'rgba(0, 212, 255, 0.95)', width: 2, lineDash: [6, 4] }),
      fill: new Fill({ color: 'rgba(0, 212, 255, 0.10)' }),
    }),
  });
  draw.on('drawend', (event) => {
     const feature = event.feature as Feature<Geometry>;
     const areaKind = useDrawStore.getState().areaKind;

     // Mismo criterio que PolygonMode: rectángulo en modo "lote" = perímetro.
     if (areaKind === 'lote') {
       const layerId = resolveOrCreateLayerForKind('perimetro');
       void (async () => {
         await runCommand(
           new AddFeatureCommand(feature, { mode: 'claim', label: 'Dibujar perímetro', kind: 'perimetro', layerId }),
         );
         updateFeatureMetrics(feature);
         ctx.refreshLayers();
       })();
       return;
     }

     void (async () => {
      const layerId = await requireLayerForKind(areaKind);
      if (!layerId) {
        src.removeFeature(feature);
        src.changed();
        return;
      }
       await runCommand(new AddFeatureCommand(feature, { mode: 'claim', label: 'Dibujar rectángulo', kind: areaKind, layerId }));
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