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

export function polySignedArea(pts: Pt[]): number {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return a / 2;
}

export function polyArea(pts: Pt[]): number {
  return Math.abs(polySignedArea(pts));
}

/**
 * Centroide ingenuo (promedio de vértices). Útil solo cuando el polígono
 * es degenerado o como aproximación barata donde la precisión geométrica
 * no importa (snapshots de UI, etiquetas).
 */
export function centroidAverage(pts: Pt[]): Pt {
  let cx = 0,
    cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  return [cx / pts.length, cy / pts.length];
}

/** Centroide area-weighted (fórmula del polígono). Es el "centro real". */
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
    return centroidAverage(pts); // polígono degenerado: fallback al promedio simple
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

/**
 * Devuelve el ring cerrado (con primer punto repetido al final) si no lo
 * estaba ya. Se usa al armar geometrías OL/GeoJSON a partir de rings abiertos.
 */
export function closeRing(pts: Pt[]): Pt[] {
  if (!pts.length) return pts;
  const f = pts[0];
  const l = pts[pts.length - 1];
  if (Math.abs(f[0] - l[0]) > 1e-9 || Math.abs(f[1] - l[1]) > 1e-9) {
    return [...pts, [f[0], f[1]]];
  }
  return pts;
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

interface PolylabelCell {
  x: number;
  y: number;
  h: number;
  d: number;
  max: number;
}

function segDistSq(px: number, py: number, a: Pt, b: Pt): number {
  let x = a[0],
    y = a[1];
  let dx = b[0] - x,
    dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}

function cellDistance(x: number, y: number, ring: Pt[]): number {
  let inside = false;
  let minDistSq = Infinity;
  const len = ring.length;
  for (let i = 0, j = len - 1; i < len; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) {
      inside = !inside;
    }
    minDistSq = Math.min(minDistSq, segDistSq(x, y, a, b));
  }
  return (inside ? 1 : -1) * Math.sqrt(minDistSq);
}

function makeCell(x: number, y: number, h: number, ring: Pt[]): PolylabelCell {
  const d = cellDistance(x, y, ring);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
}

function polylabel(ring: Pt[], precision = 0.1): Pt {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const cellSize = Math.min(width, height);
  if (cellSize <= 0) return [minX, minY];

  let h = cellSize / 2;
  const cellQueue: PolylabelCell[] = [];
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      cellQueue.push(makeCell(x + h, y + h, h, ring));
    }
  }

  let best = makeCell(minX + width / 2, minY + height / 2, 0, ring);
  const bboxCell = makeCell(minX, minY, 0, ring);
  if (bboxCell.d > best.d) best = bboxCell;

  let numProbes = cellQueue.length;
  const maxProbes = 3000;

  while (cellQueue.length > 0 && numProbes < maxProbes) {
    let bestIdx = 0;
    for (let i = 1; i < cellQueue.length; i++) {
      if (cellQueue[i].max > cellQueue[bestIdx].max) bestIdx = i;
    }
    const cell = cellQueue.splice(bestIdx, 1)[0];

    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= precision) continue;

    h = cell.h / 2;
    cellQueue.push(makeCell(cell.x - h, cell.y - h, h, ring));
    cellQueue.push(makeCell(cell.x + h, cell.y - h, h, ring));
    cellQueue.push(makeCell(cell.x - h, cell.y + h, h, ring));
    cellQueue.push(makeCell(cell.x + h, cell.y + h, h, ring));
    numProbes += 4;
  }

  return [best.x, best.y];
}

export function polygonLabelPoint(ringIn: Pt[]): Pt {
  if (ringIn.length < 3) return ringIn[0] ?? [0, 0];
  const first = ringIn[0],
    last = ringIn[ringIn.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1];
  const pts = closed ? ringIn.slice(0, -1) : ringIn;
  if (pts.length < 3) return centroidAverage(pts.length ? pts : ringIn);

  // Regla dura: la etiqueta va SIEMPRE en el centroide geométrico real
  // (area-weighted). Es la ubicación esperada en el caso normal —
  // rectángulos, polígonos convexos, la gran mayoría de lotes/manzanos.
  const centroid = polygonCentroid(pts);
  if (pointInPoly(centroid[0], centroid[1], pts)) {
    return centroid;
  }

  // Excepción, y SOLO esta: el centroide cayó fuera del polígono
  // (formas cóncavas — en L, en U, remanentes con muescas, siluetas
  // muy angostas). Ahí usamos el "polo de inaccesibilidad" — el punto
  // interior más alejado de los bordes — como el mejor sustituto
  // posible, para nunca dejar la etiqueta flotando fuera de la figura.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const sizeRef = Math.max(maxX - minX, maxY - minY);
  if (sizeRef <= 0) return pts[0];

  return polylabel(pts, Math.max(sizeRef / 200, 1e-4));
}
