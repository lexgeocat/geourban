import { distToSegment } from './dist';
export type Pt = [number, number];

export interface LotResult {
  pts: Pt[];
  isRemnant: boolean;
  frontM: number;
  depthM: number;
  areaM2: number;
}

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

export function centroidAverage(pts: Pt[]): Pt {
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
  const ox = pts[0][0];
  const oy = pts[0][1];

  let signedArea2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const x0 = pts[i][0] - ox;
    const y0 = pts[i][1] - oy;
    const next = pts[(i + 1) % n];
    const x1 = next[0] - ox;
    const y1 = next[1] - oy;
    const cross = x0 * y1 - x1 * y0;
    signedArea2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  const { minX, minY, maxX, maxY } = ringBounds(pts);
  const bboxDiag = Math.hypot(maxX - minX, maxY - minY);
  const degenerateEps = Math.max(1e-9, bboxDiag * bboxDiag * 1e-12);

  if (Math.abs(signedArea2) < degenerateEps) {
    return centroidAverage(pts);
  }

  const factor = 1 / (3 * signedArea2);
  return [ox + cx * factor, oy + cy * factor];
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

function ringBounds(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

class MaxHeap<T> {
  private items: T[] = [];
  constructor(private readonly key: (item: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.key(items[parent]) >= this.key(items[i])) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      const n = items.length;
      for (;;) {
        const left = i * 2 + 1;
        const right = i * 2 + 2;
        let largest = i;
        if (left < n && this.key(items[left]) > this.key(items[largest])) largest = left;
        if (right < n && this.key(items[right]) > this.key(items[largest])) largest = right;
        if (largest === i) break;
        [items[i], items[largest]] = [items[largest], items[i]];
        i = largest;
      }
    }
    return top;
  }
}

function poleOfInaccessibility(ring: Pt[], precision: number): PolylabelCell {
  const { minX, minY, maxX, maxY } = ringBounds(ring);
  const width = maxX - minX;
  const height = maxY - minY;
  const cellSize = Math.min(width, height);
  if (cellSize <= 0) return makeCell(minX, minY, 0, ring);

  let h = cellSize / 2;
  const cellQueue = new MaxHeap<PolylabelCell>((c) => c.max);
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      cellQueue.push(makeCell(x + h, y + h, h, ring));
    }
  }

  let best = makeCell(minX + width / 2, minY + height / 2, 0, ring);
  const bboxCell = makeCell(minX, minY, 0, ring);
  if (bboxCell.d > best.d) best = bboxCell;

  let numProbes = cellQueue.size;
  const maxProbes = 20000;

  while (cellQueue.size > 0 && numProbes < maxProbes) {
    const cell = cellQueue.pop()!;

    if (cell.d > best.d) best = cell;
    if (cell.max - best.d <= precision) continue;

    h = cell.h / 2;
    cellQueue.push(makeCell(cell.x - h, cell.y - h, h, ring));
    cellQueue.push(makeCell(cell.x + h, cell.y - h, h, ring));
    cellQueue.push(makeCell(cell.x - h, cell.y + h, h, ring));
    cellQueue.push(makeCell(cell.x + h, cell.y + h, h, ring));
    numProbes += 4;
  }

  return best;
}

function principalAxisAngle(pts: Pt[]): number {
  const n = pts.length;
  if (n < 2) return 0;
  const ox = pts[0][0];
  const oy = pts[0][1];

  let area2 = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let cxAcc = 0;
  let cyAcc = 0;

  for (let i = 0; i < n; i++) {
    const x0 = pts[i][0] - ox;
    const y0 = pts[i][1] - oy;
    const next = pts[(i + 1) % n];
    const x1 = next[0] - ox;
    const y1 = next[1] - oy;
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cxAcc += (x0 + x1) * cross;
    cyAcc += (y0 + y1) * cross;
    sxx += (x0 * x0 + x0 * x1 + x1 * x1) * cross; // ∫x² dA (×12)
    syy += (y0 * y0 + y0 * y1 + y1 * y1) * cross; // ∫y² dA (×12)
    sxy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * cross; // ∫xy dA (×24)
  }

  const area = area2 / 2;
  if (Math.abs(area) < 1e-9) {
    return principalAxisAngleFromVertices(pts);
  }

  const cx = cxAcc / (6 * area);
  const cy = cyAcc / (6 * area);
  const mxx = sxx / (12 * area) - cx * cx;
  const myy = syy / (12 * area) - cy * cy;
  const mxy = sxy / (24 * area) - cx * cy;
  const trace = mxx + myy;
  const det = mxx * myy - mxy * mxy;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const l1 = trace / 2 + disc;

  let ex: number, ey: number;
  if (Math.abs(mxy) > 1e-10) {
    ex = l1 - myy;
    ey = mxy;
  } else if (mxx >= myy) {
    ex = 1;
    ey = 0;
  } else {
    ex = 0;
    ey = 1;
  }

  const rawLen = Math.hypot(ex, ey);
  const len = rawLen === 0 ? 1 : rawLen;
  return Math.atan2(ey / len, ex / len);
}

function principalAxisAngleFromVertices(pts: Pt[]): number {
  const n = pts.length;
  if (n < 2) return 0;
  let mx = 0,
    my = 0;
  for (const [x, y] of pts) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;

  let cxx = 0,
    cxy = 0,
    cyy = 0;
  for (const [x, y] of pts) {
    const dx = x - mx,
      dy = y - my;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }
  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const l1 = trace / 2 + disc;

  let ex: number, ey: number;
  if (Math.abs(cxy) > 1e-10) {
    ex = l1 - cyy;
    ey = cxy;
  } else if (cxx >= cyy) {
    ex = 1;
    ey = 0;
  } else {
    ex = 0;
    ey = 1;
  }
  const rawLen = Math.hypot(ex, ey);
  const len = rawLen === 0 ? 1 : rawLen;
  return Math.atan2(ey / len, ex / len);
}

function rotatePoint(p: Pt, pivot: Pt, cosA: number, sinA: number): Pt {
  const dx = p[0] - pivot[0];
  const dy = p[1] - pivot[1];
  return [pivot[0] + dx * cosA - dy * sinA, pivot[1] + dx * sinA + dy * cosA];
}

function rotateRing(pts: Pt[], pivot: Pt, angleRad: number): Pt[] {
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  return pts.map((p) => rotatePoint(p, pivot, cosA, sinA));
}

const LABEL_COLLINEAR_EPS = 1e-7;
function cleanRingForLabeling(pts: Pt[]): Pt[] {
  if (pts.length < 3) return pts;
  const { minX, minY, maxX, maxY } = ringBounds(pts);
  const diag = Math.hypot(maxX - minX, maxY - minY);
  const mergeTol = Math.max(1e-6, Math.min(0.03, diag * 1e-4));

  const deduped: Pt[] = [];
  for (const p of pts) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > mergeTol) deduped.push(p);
  }
  if (deduped.length > 1) {
    const f = deduped[0],
      l = deduped[deduped.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= mergeTol) deduped.pop();
  }
  if (deduped.length < 3) return pts;

  const out: Pt[] = [];
  const n = deduped.length;
  for (let i = 0; i < n; i++) {
    const a = deduped[(i - 1 + n) % n];
    const b = deduped[i];
    const c = deduped[(i + 1) % n];
    const abx = b[0] - a[0],
      aby = b[1] - a[1];
    const bcx = c[0] - b[0],
      bcy = c[1] - b[1];
    const lenAB = Math.hypot(abx, aby) || 1e-9;
    const lenBC = Math.hypot(bcx, bcy) || 1e-9;
    const cross = (abx / lenAB) * (bcy / lenBC) - (aby / lenAB) * (bcx / lenBC);
    if (Math.abs(cross) > LABEL_COLLINEAR_EPS) out.push(b);
  }
  return out.length >= 3 ? out : deduped;
}

function isLeft(a: Pt, b: Pt, p: Pt): number {
  return (b[0] - a[0]) * (p[1] - a[1]) - (p[0] - a[0]) * (b[1] - a[1]);
}

function isInsideNonzero(p: Pt, ring: Pt[]): boolean {
  let wn = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    if (a[1] <= p[1]) {
      if (b[1] > p[1] && isLeft(a, b, p) > 0) wn++;
    } else if (b[1] <= p[1] && isLeft(a, b, p) < 0) {
      wn--;
    }
  }
  return wn !== 0;
}

function minDistanceToBoundary(p: Pt, ring: Pt[]): number {
  let best = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const d = distToSegment(p, ring[i], ring[(i + 1) % n]);
    if (d < best) best = d;
  }
  return best;
}

function minRequiredClearance(ring: Pt[], scale = 1): number {
  const { minX, minY, maxX, maxY } = ringBounds(ring);
  const sizeRef = Math.max(maxX - minX, maxY - minY);
  if (sizeRef <= 0) return 0;
  const maxClearanceInputUnits = 0.4 / scale;
  return Math.min(maxClearanceInputUnits, sizeRef * 0.04);
}

export function polygonLabelPoint(ringIn: Pt[], scale = 1): Pt {
  if (ringIn.length < 3) return ringIn[0] ?? [0, 0];
  const first = ringIn[0],
    last = ringIn[ringIn.length - 1];
  const closed = Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9;
  const rawPts = closed ? ringIn.slice(0, -1) : ringIn;
  if (rawPts.length < 3) return centroidAverage(rawPts.length ? rawPts : ringIn);

  const pts = cleanRingForLabeling(rawPts);
  if (pts.length < 3) return centroidAverage(rawPts);

  const { minX, minY, maxX, maxY } = ringBounds(pts);
  const sizeRef = Math.max(maxX - minX, maxY - minY);
  if (sizeRef <= 0) return pts[0];

  const clearance = minRequiredClearance(pts, scale);
  const precision = Math.max(sizeRef / 1000, 1e-4);

  const centroid = polygonCentroid(pts);
  const centroidDist = isInsideNonzero(centroid, pts)
    ? minDistanceToBoundary(centroid, pts)
    : -Infinity;
  const pivot = centroid;
  const angle = principalAxisAngle(pts);
  const rotatedPts = rotateRing(pts, pivot, -angle);
  const cellAligned = poleOfInaccessibility(rotatedPts, precision);
  const poleAligned = rotatePoint(
    [cellAligned.x, cellAligned.y],
    pivot,
    Math.cos(angle),
    Math.sin(angle)
  );
  const cellAxisAligned = poleOfInaccessibility(pts, precision);

  const useAligned = cellAligned.d >= cellAxisAligned.d;
  const pole = useAligned ? poleAligned : ([cellAxisAligned.x, cellAxisAligned.y] as Pt);
  const poleDist = useAligned ? cellAligned.d : cellAxisAligned.d;

  const useCentroid = centroidDist >= poleDist;
  const bestPt = useCentroid ? centroid : pole;
  const bestDist = useCentroid ? centroidDist : poleDist;

  if (bestDist >= clearance) return bestPt;
  if (bestDist > -Infinity) return bestPt;
  return centroidAverage(pts);
}

export function polygonCentroidLabelPoint(ringIn: Pt[]): Pt {
  if (ringIn.length < 3) return ringIn[0] ?? [0, 0];
  const first = ringIn[0],
    last = ringIn[ringIn.length - 1];
  const closed = Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9;
  const pts = closed ? ringIn.slice(0, -1) : ringIn;
  if (pts.length < 3) return centroidAverage(pts.length ? pts : ringIn);

  const centroid = polygonCentroid(pts);
  if (isInsideNonzero(centroid, pts)) return centroid;

  return polygonLabelPoint(ringIn);
}
