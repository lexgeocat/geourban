import type { Pt } from '../geo/polygonEngine';
import type { Street } from '../store/streetStore';

/**
 * Convierte una calle con waypoints en segmentos rectos para clipping.
 * Cada segmento mantiene el widthM de la calle original.
 */
export function getStreetSegments(street: Street): Array<{ start: Pt; end: Pt; widthM: number }> {
  if (street.waypoints && street.waypoints.length > 0) {
    const points: Pt[] = [street.start, ...street.waypoints, street.end];
    const segments: Array<{ start: Pt; end: Pt; widthM: number }> = [];
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({ start: points[i], end: points[i + 1], widthM: street.widthM });
    }
    return segments;
  }
  return [{ start: street.start, end: street.end, widthM: street.widthM }];
}

/**
 * Convierte una calle (incluyendo waypoints) en una LineString de OpenLayers para renderizado.
 */
export function streetToCoordinates(street: Street): Pt[] {
  if (street.waypoints && street.waypoints.length > 0) {
    return [street.start, ...street.waypoints, street.end];
  }
  return [street.start, street.end];
}