import type { Pt } from '@kernel/geometry/polygonEngine';
import { polySignedArea, closeRing } from '@kernel/geometry/polygonEngine';
import { distToSegment } from '@kernel/geometry/dist';
import { getFilletRadiusForAngle } from './streetEngine';
import { normalize } from './vectorMath';

export type CornerMode = 'fillet' | 'chamfer' | 'none';

export function pointOnRing(p: Pt, ring: Pt[], tol = 0.05): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    if (distToSegment(p, ring[i], ring[(i + 1) % n]) < tol) return true;
  }
  return false;
}

interface CornerTangents {
  ta: Pt;
  tb: Pt;
  center: Pt;
  reff: number;
  a0: number;
  a1: number;
}

function computeCornerTangents(prev: Pt, cur: Pt, next: Pt, r: number): CornerTangents | null {
  if (r <= 0) return null;
  const a = normalize(prev[0] - cur[0], prev[1] - cur[1]);
  const b = normalize(next[0] - cur[0], next[1] - cur[1]);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));
  const ang = Math.acos(dot);
  if (ang < 1e-3 || ang > Math.PI - 1e-3) return null;

  const lenA = Math.hypot(prev[0] - cur[0], prev[1] - cur[1]);
  const lenB = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
  let t = r / Math.tan(ang / 2);
  t = Math.min(t, 0.49 * lenA, 0.49 * lenB);
  const reff = t * Math.tan(ang / 2);
  if (reff < 1e-4) return null;

  const ta: Pt = [cur[0] + a[0] * t, cur[1] + a[1] * t];
  const tb: Pt = [cur[0] + b[0] * t, cur[1] + b[1] * t];
  const bis = normalize(a[0] + b[0], a[1] + b[1]);
  const dCtr = reff / Math.sin(ang / 2);
  const center: Pt = [cur[0] + bis[0] * dCtr, cur[1] + bis[1] * dCtr];

  const a0 = Math.atan2(ta[1] - center[1], ta[0] - center[0]);
  const a1 = Math.atan2(tb[1] - center[1], tb[0] - center[0]);

  return { ta, tb, center, reff, a0, a1 };
}

function cornerFilletArc(prev: Pt, cur: Pt, next: Pt, r: number): Pt[] | null {
  const tg = computeCornerTangents(prev, cur, next, r);
  if (!tg) return null;
  const { ta, tb, center, reff, a0, a1 } = tg;

  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;

  const steps = Math.max(2, Math.ceil(Math.abs(da) / 0.18));
  const pts: Pt[] = [ta];
  for (let k = 1; k < steps; k++) {
    const aa = a0 + (da * k) / steps;
    pts.push([center[0] + Math.cos(aa) * reff, center[1] + Math.sin(aa) * reff]);
  }
  pts.push(tb);
  return pts;
}

function cornerChamferCut(prev: Pt, cur: Pt, next: Pt, r: number): Pt[] | null {
  const tg = computeCornerTangents(prev, cur, next, r);
  if (!tg) return null;
  return [tg.ta, tg.tb];
}

export function roundRingReflex(
  ringIn: Pt[],
  extraM: number | ((pt: Pt) => number) = 0,
  isHole = false,
  mode: CornerMode = 'fillet',
  forceTreat: boolean | ((pt: Pt) => boolean) = false
): Pt[] {
  const pts = ringIn.slice();
  if (pts.length > 1) {
    const f = pts[0],
      l = pts[pts.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) pts.pop();
  }
  const n = pts.length;
  if (n < 3) return closeRing(pts);
  if (mode === 'none') return closeRing(pts);

  const rawCcw = polySignedArea(pts) >= 0;
  const ccw = isHole ? !rawCcw : rawCcw;
  const out: Pt[] = [];

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const d1x = cur[0] - prev[0],
      d1y = cur[1] - prev[1];
    const d2x = next[0] - cur[0],
      d2y = next[1] - cur[1];
    const l1 = Math.hypot(d1x, d1y),
      l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-9 || l2 < 1e-9) {
      out.push(cur);
      continue;
    }

    const cross = (d1x / l1) * (d2y / l2) - (d1y / l1) * (d2x / l2);
    const reflex = ccw ? cross < -1e-6 : cross > 1e-6;
    const forced = typeof forceTreat === 'function' ? forceTreat(cur) : forceTreat;
    if (!reflex && !forced) {
      out.push(cur);
      continue;
    }

    const a = normalize(prev[0] - cur[0], prev[1] - cur[1]);
    const b = normalize(next[0] - cur[0], next[1] - cur[1]);
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));
    const angleDeg = (Math.acos(dot) * 180) / Math.PI;
    const extra = typeof extraM === 'function' ? extraM(cur) : extraM;
    const r = getFilletRadiusForAngle(angleDeg) + extra;

    const corner =
      mode === 'chamfer'
        ? cornerChamferCut(prev, cur, next, r)
        : cornerFilletArc(prev, cur, next, r);
    if (!corner) {
      out.push(cur);
      continue;
    }
    out.push(...corner);
  }

  return closeRing(out);
}
