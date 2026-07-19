import type { Pt } from '../geo/polygonEngine';
import type { Street } from '../store/streetStore';

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
 * Igual que getStreetSegments, pero con el ancho TOTAL de la vía (calzada +
 * vereda a cada lado). Es el que hay que usar para recortar manzanos: el
 * límite real de un manzano es el borde exterior de la vereda, no el
 * cordón de calzada (ver streetEngine.computeStreetFillets — mismo
 * criterio para el radio de las esquinas).
 */
export function getStreetOuterSegments(street: Street): Array<{ start: Pt; end: Pt; widthM: number }> {
  const outerWidth = street.widthM + 2 * Math.max(0, street.sideWidthM ?? 0);
  if (street.waypoints && street.waypoints.length > 0) {
    const points: Pt[] = [street.start, ...street.waypoints, street.end];
    const segments: Array<{ start: Pt; end: Pt; widthM: number }> = [];
    for (let i = 0; i < points.length - 1; i++) {
      segments.push({ start: points[i], end: points[i + 1], widthM: outerWidth });
    }
    return segments;
  }
  return [{ start: street.start, end: street.end, widthM: outerWidth }];
}

export function streetToCoordinates(street: Street): Pt[] {
  if (street.waypoints && street.waypoints.length > 0) {
    return [street.start, ...street.waypoints, street.end];
  }
  return [street.start, street.end];
}