import type { Pt } from './math/polygonEngine';
import { polyArea } from './math/polygonEngine';

export interface SanitizeRingOptions {
  dedupeEpsilon?: number;
  collinearAngleEpsilon?: number;
  minArea?: number;
}

const DEFAULT_DEDUPE_EPS = 1e-4;
const DEFAULT_COLLINEAR_ANGLE_EPS = 1e-4; // ~0.0057° — solo colinealidad casi perfecta
const DEFAULT_MIN_AREA = 1e-6;
const MAX_CLEANUP_ITERATIONS_SLACK = 8;

function closeRing(ring: Pt[]): Pt[] {
  if (ring.length === 0) return ring;
  const f = ring[0], l = ring[ring.length - 1];
  if (Math.abs(f[0] - l[0]) > 1e-12 || Math.abs(f[1] - l[1]) > 1e-12) {
    return [...ring, [f[0], f[1]]];
  }
  return ring;
}

function dedupeConsecutive(ring: Pt[], eps: number): { ring: Pt[]; removed: number } {
  if (ring.length === 0) return { ring, removed: 0 };
  const out: Pt[] = [ring[0]];
  let removed = 0;
  for (let i = 1; i < ring.length; i++) {
    const prev = out[out.length - 1];
    const cur = ring[i];
    if (Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) < eps) {
      removed++;
      continue;
    }
    out.push(cur);
  }
  return { ring: out, removed };
}

function removeCollinear(ring: Pt[], angleEps: number, closureEps: number): { ring: Pt[]; removed: number } {
  const isClosed = ring.length > 1 &&
    Math.abs(ring[0][0] - ring[ring.length - 1][0]) < closureEps &&
    Math.abs(ring[0][1] - ring[ring.length - 1][1]) < closureEps;
  let pts = isClosed ? ring.slice(0, -1) : ring.slice();

  if (pts.length < 3) return { ring: pts, removed: 0 };

  let removed = 0;
  let changed = true;
  let guard = 0;
  const guardMax = pts.length + MAX_CLEANUP_ITERATIONS_SLACK;

  while (changed && pts.length > 3 && guard < guardMax) {
    changed = false;
    guard++;
    for (let i = 0; i < pts.length; i++) {
      const n = pts.length;
      const a = pts[(i - 1 + n) % n];
      const b = pts[i];
      const c = pts[(i + 1) % n];
      const abx = b[0] - a[0], aby = b[1] - a[1];
      const bcx = c[0] - b[0], bcy = c[1] - b[1];
      const lenAB = Math.hypot(abx, aby);
      const lenBC = Math.hypot(bcx, bcy);
      if (lenAB < 1e-12 || lenBC < 1e-12) {
        pts = pts.slice(0, i).concat(pts.slice(i + 1));
        removed++;
        changed = true;
        break;
      }
      const cross = (abx / lenAB) * (bcy / lenBC) - (aby / lenAB) * (bcx / lenBC);
      const dot = (abx / lenAB) * (bcx / lenBC) + (aby / lenAB) * (bcy / lenBC);
      const angle = Math.atan2(Math.abs(cross), dot);
      if (angle < angleEps) {
        pts = pts.slice(0, i).concat(pts.slice(i + 1));
        removed++;
        changed = true;
        break;
      }
    }
  }
  return { ring: pts, removed };
}

export function sanitizeRing(ringIn: Pt[] | null | undefined, opts: SanitizeRingOptions = {}): Pt[] | null {
  if (!ringIn || ringIn.length < 3) return null;

  const dedupeEps = opts.dedupeEpsilon ?? DEFAULT_DEDUPE_EPS;
  const angleEps = opts.collinearAngleEpsilon ?? DEFAULT_COLLINEAR_ANGLE_EPS;
  const minArea = opts.minArea ?? DEFAULT_MIN_AREA;

  let pts = ringIn.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 3) {
    return null;
  }

  const dedup = dedupeConsecutive(pts, dedupeEps);
  pts = dedup.ring;

  if (pts.length < 3) {
    return null;
  }

  const decollinear = removeCollinear(pts, angleEps, dedupeEps);
  pts = decollinear.ring;

  if (pts.length < 3) {
    return null;
  }

  const area = polyArea(pts);
  if (!Number.isFinite(area) || area <= minArea) {
    return null;
  }

  return closeRing(pts);
}

export function sanitizeRings(rings: Array<Pt[] | null | undefined>, opts: SanitizeRingOptions = {}): Pt[][] {
  const out: Pt[][] = [];
  for (const r of rings) {
    const s = sanitizeRing(r, opts);
    if (s) out.push(s);
  }
  return out;
}