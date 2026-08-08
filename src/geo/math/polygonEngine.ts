// ─── Tipos exportados ───────────────────────────────────────────────
export type Pt = [number, number];

export interface LotResult {
  pts: Pt[];
  isRemnant: boolean;
  frontM: number;
  depthM: number;
  areaM2: number;
}

// ─── Primitivas geométricas ─────────────────────────────────────────

export function polyArea(pts: Pt[]): number {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) / 2;
}

/** Centroide de un polígono */
export function centroid(pts: Pt[]): Pt {
  let cx = 0,
    cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  return [cx / pts.length, cy / pts.length];
}

export function polygonCentroid(pts: Pt[]): Pt {
  const n = pts.length;
  if (n === 0) return [0, 0];
  if (n === 1) return [pts[0][0], pts[0][1]];

  let signedArea2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    signedArea2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  if (Math.abs(signedArea2) < 1e-9) {
    return centroid(pts); // polígono degenerado: fallback al promedio simple
  }

  const factor = 1 / (3 * signedArea2);
  return [cx * factor, cy * factor];
}

export function ringPerimeter(pts: Pt[]): number {
  let per = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    per += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return per;
}

export function pathLength(pts: Pt[]): number {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return total;
}

/** Punto-en-polígono (ray casting) — exportado para subdivisionAlgorithms.ts */
export function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0],
      yi = poly[i][1];
    const xj = poly[j][0],
      yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function segmentIntersectsPoly(a: Pt, b: Pt, poly: Pt[]): boolean {
  if (pointInPoly(a[0], a[1], poly) || pointInPoly(b[0], b[1], poly)) return true;

  const abx = b[0] - a[0];
  const aby = b[1] - a[1];

  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0],
      yi = poly[i][1];
    const xj = poly[j][0],
      yj = poly[j][1];
    const dx = xj - xi;
    const dy = yj - yi;
    const denom = abx * dy - aby * dx;
    if (denom === 0) continue; // paralelos
    const qx = a[0] - xi;
    const qy = a[1] - yi;
    const t = -(qx * dy - qy * dx) / denom;
    const u = -(qx * aby - qy * abx) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
  }
  return false;
}
