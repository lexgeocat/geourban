import Draw from 'ol/interaction/Draw.js';
import { primaryAction } from 'ol/events/condition.js';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style.js';
import LineString from 'ol/geom/LineString.js';
import MultiPoint from 'ol/geom/MultiPoint.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useDrawStore } from '@map-core/store/drawStore';
import { runCommand } from '@kernel/command/CommandStack';
import { AddFeatureCommand } from '../commands/AddFeatureCommand';
import { updateFeatureMetrics } from '@georef-engine/metrics';
import { requireLayerForKind } from '@layers-engine/store/layerPickerStore';
import { buildSegmentLiveLabels } from '../styles/liveDimensions';
import type { ModeContext } from '@kernel/modes/ModeContext';

export function activatePolyline(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'LineString',
    condition: primaryAction,
    style: (feature) => {
      const geom = feature.getGeometry();
      const sketchCoords = geom instanceof LineString ? geom.getCoordinates() : [];

      const confirmedCoords = sketchCoords.length > 1 ? sketchCoords.slice(0, -1) : [];
      const vertexStyle =
        confirmedCoords.length > 0
          ? new Style({
              geometry: new MultiPoint(confirmedCoords as number[][]),
              image: new CircleStyle({
                radius: 5,
                fill: new Fill({ color: 'rgba(255, 214, 10, 0.25)' }),
                stroke: new Stroke({ color: 'rgba(255, 214, 10, 0.95)', width: 1.5 }),
              }),
            })
          : null;

      const lineStyle = new Style({
        stroke: new Stroke({
          color: 'rgba(255, 214, 10, 0.95)',
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
