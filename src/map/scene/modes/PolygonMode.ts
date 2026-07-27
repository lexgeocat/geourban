import Draw from 'ol/interaction/Draw.js';
import { toLonLat } from 'ol/proj.js';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import MultiPoint from 'ol/geom/MultiPoint.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useDrawStore } from '../../../store/map/drawStore';
import { runCommand } from '../../../commands/core/CommandStack';
import { AddFeatureCommand } from '../../../commands/features/AddFeatureCommand';
import { updateFeatureMetrics } from '../../../geo/metrics';
import { createLiveDrawingLabelStyle } from '../../styleFactory';
import { pickLayerForKind } from '../../../store/ui/layerPickerStore';
import type { ModeContext } from './ModeContext';

export function activatePolygon(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'Polygon',
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
                fill: new Fill({ color: 'rgba(0, 212, 255, 0.25)' }),
                stroke: new Stroke({ color: 'rgba(0, 212, 255, 0.95)', width: 1.5 }),
              }),
            })
          : null;

      const lineStyle = new Style({
        stroke: new Stroke({ color: 'rgba(0, 212, 255, 0.95)', width: 2, lineDash: [6, 4], lineCap: 'round' }),
      });

      const segmentLabels: Style[] = [];
      const skRes = map.getView().getResolution() ?? 1;
      const PX_OFF = 14;
      const totalSegments = sketchCoords.length >= 2 ? sketchCoords.length - 1 : 0;
      if (sketchCoords.length >= 2) {
        for (let i = 0; i < sketchCoords.length - 1; i++) {
          const a = sketchCoords[i];
          const b = sketchCoords[i + 1];
          if (!a || !b) continue;
          const sdx = b[0] - a[0];
          const sdy = b[1] - a[1];
          const segLen = Math.hypot(sdx, sdy);
          if (segLen < 0.3) continue;
          const aLL = toLonLat(a);
          const bLL = toLonLat(b);
          const R = 6371000;
          const dLat = ((bLL[1] - aLL[1]) * Math.PI) / 180;
          const dLon = ((bLL[0] - aLL[0]) * Math.PI) / 180;
          const lat1 = (aLL[1] * Math.PI) / 180;
          const lat2 = (bLL[1] * Math.PI) / 180;
          const sinDLat2 = Math.sin(dLat / 2);
          const sinDLon2 = Math.sin(dLon / 2);
          const h = sinDLat2 * sinDLat2 + sinDLon2 * sinDLon2 * Math.cos(lat1) * Math.cos(lat2);
          const liveLen = 2 * R * Math.asin(Math.sqrt(Math.min(h, 1)));
          if (liveLen < 0.3) continue;
          const midX = (a[0] + b[0]) / 2;
          const midY = (a[1] + b[1]) / 2;
          const angle = Math.atan2(sdy, sdx);
          let textAngle = angle;
          if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) textAngle += Math.PI;
          const perpLen = PX_OFF * skRes;
          const perpNx = -sdy / segLen;
          const perpNy = sdx / segLen;
          const labelX = midX + perpNx * perpLen;
          const labelY = midY + perpNy * perpLen;

          const isLastSegment = i === totalSegments - 1;
          const label = liveLen >= 100 ? liveLen.toFixed(1) + ' m' : liveLen.toFixed(2) + ' m';

          segmentLabels.push(createLiveDrawingLabelStyle(label, [labelX, labelY], textAngle, true, isLastSegment));
        }
      }

      return [lineStyle, vertexStyle, ...segmentLabels].filter((s): s is Style => s !== null);
    },
  });

  draw.on('drawend', (event) => {
    const feature = event.feature as Feature<Geometry>;
    const areaKind = useDrawStore.getState().areaKind;
    void (async () => {
      const layerId = await pickLayerForKind(areaKind);
      await runCommand(new AddFeatureCommand(feature, { mode: 'claim', label: 'Dibujar polígono', kind: areaKind, layerId }));
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