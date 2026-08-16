import Draw from 'ol/interaction/Draw.js';
import { primaryAction } from 'ol/events/condition.js';
import { Fill, Stroke, Style } from 'ol/style.js';
import CircleGeom from 'ol/geom/Circle.js';
import PolygonGeom from 'ol/geom/Polygon.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { runCommand } from '@kernel/command/CommandStack';
import { AddFeatureCommand } from '../commands/AddFeatureCommand';
import { updateFeatureMetrics, projectPathToMetricPlane } from '@georef-engine/metrics';
import { resolveOrCreateLayerForKind } from '@layers-engine/store/layerResolution';
import { resolutionAwareSegments } from '@kernel/geometry/lod';
import { createLiveDrawingLabelStyle } from '../styles/styleFactory';
import type { ModeContext } from '@kernel/modes/ModeContext';

function circleToPolygon(center: number[], radius: number, resolution: number): PolygonGeom {
  const segs = resolutionAwareSegments(radius, resolution, 1.2);
  const ring: number[][] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i * 2 * Math.PI) / segs;
    ring.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius]);
  }
  return new PolygonGeom([ring]);
}

export function activateCircle(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'Circle',
    condition: primaryAction,
    style: (feature) => {
      const shapeStyle = new Style({
        stroke: new Stroke({ color: 'rgba(167, 139, 250, 0.95)', width: 2, lineDash: [6, 4] }),
        fill: new Fill({ color: 'rgba(167, 139, 250, 0.10)' }),
      });
      const geom = feature.getGeometry();
      if (!(geom instanceof CircleGeom)) return [shapeStyle];
      const center = geom.getCenter();
      const radiusMapUnits = geom.getRadius();
      if (!(radiusMapUnits > 0)) return [shapeStyle];
      const edgePoint: [number, number] = [center[0] + radiusMapUnits, center[1]];
      const [centerM, edgeM] = projectPathToMetricPlane([center as [number, number], edgePoint]);
      const radiusM =
        centerM && edgeM ? Math.hypot(edgeM[0] - centerM[0], edgeM[1] - centerM[1]) : 0;
      if (radiusM < 0.1) return [shapeStyle];
      const labelText = radiusM >= 100 ? radiusM.toFixed(1) + ' m' : radiusM.toFixed(2) + ' m';
      const labelStyle = createLiveDrawingLabelStyle(`R ${labelText}`, edgePoint, 0, false, true);
      return [shapeStyle, labelStyle];
    },
  });

  draw.on('drawend', (event) => {
    const feature = event.feature as Feature<Geometry>;
    const geom = feature.getGeometry();
    if (geom instanceof CircleGeom) {
      const resolution = map.getView().getResolution() ?? 1;
      feature.setGeometry(circleToPolygon(geom.getCenter(), geom.getRadius(), resolution));
    }
    const layerId = resolveOrCreateLayerForKind('circulo');

    void (async () => {
      await runCommand(
        new AddFeatureCommand(feature, {
          mode: 'claim',
          label: 'Dibujar círculo',
          kind: 'circulo',
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
