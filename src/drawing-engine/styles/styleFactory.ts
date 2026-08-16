import Point from 'ol/geom/Point.js';
import { Fill, Stroke, Style, Text } from 'ol/style.js';
import { CAD_BG_DEEPEST_RGB } from '@kernel/theme/colors';

const GEOURBAN_MANZANA_COLOR = '#58a6ff';
const GEOURBAN_LIVE_BG = `rgba(${CAD_BG_DEEPEST_RGB}, 0.80)`;

export function createLiveDrawingLabelStyle(
  text: string,
  coordinate: [number, number],
  rotation: number,
  _isPolygon: boolean = true,
  isLastSegment: boolean = false
): Style {
  const fillColor = isLastSegment ? '#ffa657ee' : GEOURBAN_MANZANA_COLOR + 'ee';

  return new Style({
    geometry: new Point(coordinate),
    text: new Text({
      text,
      font: '600 10px Courier New',
      fill: new Fill({ color: fillColor }),
      stroke: new Stroke({ color: 'rgba(0, 0, 0, 0.72)', width: 3 }),
      backgroundFill: new Fill({ color: GEOURBAN_LIVE_BG }),
      padding: [2, 5, 2, 5],
      rotation,
      rotateWithView: true,
    }),
  });
}
