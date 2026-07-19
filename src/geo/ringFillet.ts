import type { Pt } from './polygonEngine';
import { getFilletRadiusForAngle } from './streetEngine';

function normalize(dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

function ringSignedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function closeRing(pts: Pt[]): Pt[] {
  if (!pts.length) return pts;
  const f = pts[0], l = pts[pts.length - 1];
  if (Math.abs(f[0] - l[0]) > 1e-9 || Math.abs(f[1] - l[1]) > 1e-9) return [...pts, [f[0], f[1]]];
  return pts;
}

function cornerFilletArc(prev: Pt, cur: Pt, next: Pt, r: number): Pt[] | null {
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

  let a0 = Math.atan2(ta[1] - center[1], ta[0] - center[0]);
  let a1 = Math.atan2(tb[1] - center[1], tb[0] - center[0]);
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

/**
 * Redondea los vértices REFLEX (cóncavos) de un anillo — que en un manzano
 * resultante de "parcela − unión(red vial)" son exactamente las esquinas
 * donde una o más calles cortaron la parcela. A diferencia de
 * computeStreetFillets/subtractFilletWedge, esto no necesita saber qué
 * calles se tocan entre sí: opera sobre la geometría final, así que 2, 3
 * o N vías confluyendo en un mismo punto se resuelven igual.
 */
export function roundRingReflex(ringIn: Pt[], extraM = 0): Pt[] {
  let pts = ringIn.slice();
  if (pts.length > 1) {
    const f = pts[0], l = pts[pts.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) pts.pop();
  }
  const n = pts.length;
  if (n < 3) return closeRing(pts);

  const ccw = ringSignedArea(pts) >= 0;
  const out: Pt[] = [];

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const d1x = cur[0] - prev[0], d1y = cur[1] - prev[1];
    const d2x = next[0] - cur[0], d2y = next[1] - cur[1];
    const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
    if (l1 < 1e-9 || l2 < 1e-9) { out.push(cur); continue; }

    const cross = (d1x / l1) * (d2y / l2) - (d1y / l1) * (d2x / l2);
    const reflex = ccw ? cross < -1e-6 : cross > 1e-6;
    if (!reflex) { out.push(cur); continue; }

    const a = normalize(prev[0] - cur[0], prev[1] - cur[1]);
    const b = normalize(next[0] - cur[0], next[1] - cur[1]);
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));
    const angleDeg = (Math.acos(dot) * 180) / Math.PI;
    const r = getFilletRadiusForAngle(angleDeg) + extraM;

    const arc = cornerFilletArc(prev, cur, next, r);
    if (!arc) { out.push(cur); continue; }
    out.push(...arc);
  }

  return closeRing(out);
}
