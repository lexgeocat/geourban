import type { Pt } from '../math/polygonEngine';
import { getFilletRadiusForAngle } from './streetEngine';

export type CornerMode = 'fillet' | 'chamfer' | 'none';

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

interface CornerTangents {
  ta: Pt;
  tb: Pt;
  center: Pt;
  reff: number;
  a0: number;
  a1: number;
}

/** Geometría compartida entre ochave (arco) y chaflán (corte recto): los
 *  2 puntos tangentes sobre cada lado de la esquina son los mismos en
 *  ambos casos — solo cambia cómo se conectan. */
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

/** Chaflán: en vez de arquear entre los 2 puntos tangentes, los une con
 *  una línea recta (corte de esquina clásico de CAD). */
function cornerChamferCut(prev: Pt, cur: Pt, next: Pt, r: number): Pt[] | null {
  const tg = computeCornerTangents(prev, cur, next, r);
  if (!tg) return null;
  return [tg.ta, tg.tb];
}

/**
 * Redondea/chaflana/deja recta (según `mode`) los vértices REFLEX
 * (cóncavos) de un anillo — en un manzano o en la red vial unida, son
 * exactamente las esquinas donde una o más calles se cruzan.
 *
 * `isHole`: true si `ringIn` es un HUECO dentro de un polígono (p.ej. la
 * manzana central rodeada por 4 vías en un cruce "#"). Un hueco tiene,
 * visto desde sí mismo, solo esquinas convexas — pero esas mismas
 * esquinas son cóncavas vistas desde la vía real (que queda del lado de
 * afuera del hueco), así que ahí se invierte el criterio de "reflex".
 *
 * `mode`: 'fillet' (ochave, arco — default), 'chamfer' (corte recto) o
 * 'none' (esquina tal cual del miter, sin tratamiento).
 */
export function roundRingReflex(
  ringIn: Pt[],
  extraM: number | ((pt: Pt) => number) = 0,
  isHole = false,
  mode: CornerMode = 'fillet',
): Pt[] {
  const pts = ringIn.slice();
  if (pts.length > 1) {
    const f = pts[0], l = pts[pts.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-9 && Math.abs(f[1] - l[1]) < 1e-9) pts.pop();
  }
  const n = pts.length;
  if (n < 3) return closeRing(pts);
  if (mode === 'none') return closeRing(pts);

  const rawCcw = ringSignedArea(pts) >= 0;
  const ccw = isHole ? !rawCcw : rawCcw;
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
    const extra = typeof extraM === 'function' ? extraM(cur) : extraM;
    const r = getFilletRadiusForAngle(angleDeg) + extra;

    const corner = mode === 'chamfer'
      ? cornerChamferCut(prev, cur, next, r)
      : cornerFilletArc(prev, cur, next, r);
    if (!corner) { out.push(cur); continue; }
    out.push(...corner);
  }

  return closeRing(out);
}
