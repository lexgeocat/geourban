import Draw from 'ol/interaction/Draw.js';
import { primaryAction } from 'ol/events/condition.js';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style.js';
import Point from 'ol/geom/Point.js';
import { transform } from 'ol/proj.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { runCommand } from '@kernel/command/CommandStack';
import { AddFeatureCommand } from '../commands/AddFeatureCommand';
import { updateFeatureMetrics } from '@georef-engine/metrics';
import { resolveOrCreateLayerForKind } from '@layers-engine/store/layerResolution';
import { useProjectCrsStore } from '@georef-engine/store/projectCrsStore';
import { ensureUtmZoneRegistered } from '@georef-engine/crs/utmZones';
import { createLiveDrawingLabelStyle } from '../styles/styleFactory';
import type { ModeContext } from '@kernel/modes/ModeContext';

function formatPointCoordLabel(coord: number[]): string {
  const crs = useProjectCrsStore.getState();
  if (crs.mode === 'utm') {
    const epsg = ensureUtmZoneRegistered(crs.utmZone, crs.utmHemisphere);
    const [x, y] = transform(coord, 'EPSG:3857', epsg) as [number, number];
    return `X ${x.toFixed(2)} · Y ${y.toFixed(2)}`;
  }
  const [lon, lat] = transform(coord, 'EPSG:3857', 'EPSG:4326') as [number, number];
  return `${lon.toFixed(5)}, ${lat.toFixed(5)}`;
}

export function activatePoint(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'Point',
    condition: primaryAction,
    style: (feature) => {
      const pointStyle = new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: 'rgba(52, 211, 153, 0.35)' }),
          stroke: new Stroke({ color: 'rgba(52, 211, 153, 0.95)', width: 2 }),
        }),
      });
      const geom = feature.getGeometry();
      if (!(geom instanceof Point)) return [pointStyle];
      const coord = geom.getCoordinates();
      const resolution = map.getView().getResolution() ?? 1;
      const labelCoord: [number, number] = [coord[0], coord[1] + 16 * resolution];
      const labelStyle = createLiveDrawingLabelStyle(
        formatPointCoordLabel(coord),
        labelCoord,
        0,
        false,
        true
      );
      return [pointStyle, labelStyle];
    },
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
