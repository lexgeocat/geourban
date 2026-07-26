export interface ArcParams {
  /** Centro del arco (map units). */
  center: [number, number];
  /** Radio (map units). */
  radius: number;
  /** Ángulo inicial en radianes. */
  startAngle: number;
  /** Ángulo final en radianes. */
  endAngle: number;
  /** Sentido del arco: `true` = counter-clockwise. */
  counterClockwise: boolean;
}

/** Circunferencia que pasa por 3 puntos (inicio, fin, punto-en-arco).
 *  Devuelve centro y radio, o null si los 3 puntos son colineales. */
export function circleFrom3Points(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
): { center: [number, number]; radius: number } | null {
  const ax = p1[0], ay = p1[1];
  const bx = p2[0], by = p2[1];
  const cx = p3[0], cy = p3[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const radius = Math.hypot(ax - ux, ay - uy);
  return { center: [ux, uy], radius };
}

/** Puntos muestreados sobre un arco (para renderizar en canvas/LineString). */
export function sampleArc(
  params: ArcParams,
  segments = 32,
): [number, number][] {
  const { center, radius, startAngle, endAngle, counterClockwise } = params;
  const points: [number, number][] = [];
  let start = startAngle;
  let end = endAngle;
  if (counterClockwise) {
    if (end <= start) end += Math.PI * 2;
  } else {
    if (start <= end) start += Math.PI * 2;
  }
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = start + (end - start) * t;
    points.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius]);
  }
  return points;
}

/** Convierte un arco 3-puntos (inicio, fin, punto-en-arco) en `ArcParams`. */
export function arcFrom3Points(
  start: [number, number],
  end: [number, number],
  midPoint: [number, number],
): ArcParams | null {
  const circle = circleFrom3Points(start, end, midPoint);
  if (!circle) return null;
  const { center, radius } = circle;
  const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const a1 = Math.atan2(end[1] - center[1], end[0] - center[0]);
  // Decidir sentido: si el punto medio cae en el sector CCW entre a0 y a1,
  // el arco es CCW; si no, CW.
  const am = Math.atan2(midPoint[1] - center[1], midPoint[0] - center[0]);
  const ccw = isAngleInSweep(am, a0, a1, true);
  return { center, radius, startAngle: a0, endAngle: a1, counterClockwise: ccw };
}

function normalizeAngle(a: number): number {
  return ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
}

function isAngleInSweep(ang: number, start: number, end: number, ccw: boolean): boolean {
  const s = normalizeAngle(start);
  const e = normalizeAngle(end);
  const a = normalizeAngle(ang);
  if (ccw) {
    if (e <= s) {
      return a >= s || a <= e;
    }
    return a >= s && a <= e;
  } else {
    if (s <= e) {
      return a >= e || a <= s;
    }
    return a >= e && a <= s;
  }
}
