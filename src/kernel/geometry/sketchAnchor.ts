import type Draw from 'ol/interaction/Draw.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';

function sketchRing(draw: Draw): number[][] {
  const overlaySrc = draw.getOverlay().getSource();
  const sketch = overlaySrc?.getFeatures()[0];
  const sketchGeom = sketch?.getGeometry();
  if (!sketchGeom) return [];
  if (sketchGeom instanceof Polygon) return sketchGeom.getCoordinates()[0] ?? [];
  if (sketchGeom instanceof LineString) return sketchGeom.getCoordinates();
  return [];
}

export function getDrawSketchAnchor(draw: Draw): number[] | undefined {
  const ring = sketchRing(draw);
  return ring.length >= 2 ? (ring[ring.length - 2] as number[]) : undefined;
}

export function getDrawSketchCurrentPoint(draw: Draw): number[] | undefined {
  const ring = sketchRing(draw);
  return ring.length >= 1 ? (ring[ring.length - 1] as number[]) : undefined;
}
