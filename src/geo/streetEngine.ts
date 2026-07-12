/**
 * Motor de geometría de calles — port de LOTES_SAI street-fillets.js.
 * Calcula fillets (arcos de empalme) en esquinas de calles y gestiona
 * el recorte de bordes con supresión de solapes.
 */

import type { Street } from '../store/streetStore';

// ─── Tipos ──────────────────────────────────────────────────────────

export interface StreetFillet {
  /** Punto de esquina (intersección de ejes) */
  corner: [number, number];
  /** Punto tangente en calle A */
  tangA: [number, number];
  /** Punto tangente en calle B */
  tangB: [number, number];
  /** Centro del arco */
  arcCenter: [number, number];
  /** Ángulo inicio del arco (rad) */
  angA: number;
  /** Ángulo fin del arco (rad) */
  angB: number;
  /** ¿Arco antihorario? */
  acw: boolean;
  /** Radio del arco en map units */
  radius: number;
  /** Calle A */
  streetA: Street;
  /** Calle B */
  streetB: Street;
}

export interface StreetEdgeSegment {
  /** Puntos del borde [from, to] */
  from: [number, number];
  to: [number, number];
  /** Calle origen */
  street: Street;
  /** Lado: +1 o -1 */
  side: number;
}

// ─── Helpers ────────────────────────────────────────────────────────

function norm(a: [number, number], b: [number, number]): [number, number] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return [0, 0];
  return [-dy / l, dx / l];
}

function normalize(a: [number, number]): [number, number] {
  const l = Math.hypot(a[0], a[1]);
  return l < 1e-9 ? [0, 0] : [a[0] / l, a[1] / l];
}

function add(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] + b[0], a[1] + b[1]];
}

function sub(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] - b[0], a[1] - b[1]];
}

function scale(a: [number, number], s: number): [number, number] {
  return [a[0] * s, a[1] * s];
}

function dot(a: [number, number], b: [number, number]): number {
  return a[0] * b[0] + a[1] * b[1];
}

function lineLineIntersect(
  p1: [number, number], p2: [number, number],
  p3: [number, number], p4: [number, number],
): [number, number] | null {
  const dx1 = p2[0] - p1[0], dy1 = p2[1] - p1[1];
  const dx2 = p4[0] - p3[0], dy2 = p4[1] - p3[1];
  const d = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3[0] - p1[0]) * dy2 - (p3[1] - p1[1]) * dx2) / d;
  return [p1[0] + t * dx1, p1[1] + t * dy1];
}

function onSegment(p: [number, number], s: [number, number], e: [number, number], tol: number): boolean {
  const dir = sub(e, s);
  const len = Math.hypot(dir[0], dir[1]);
  if (len < 1e-9) return false;
  const dirN = normalize(dir);
  const proj = dot(sub(p, s), dirN);
  return proj >= -tol && proj <= len + tol;
}

function inSweep(ang: number, a: number, b: number): boolean {
  const sweep = (((b - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const rel = (((ang - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return rel <= sweep;
}

function getFilletRadiusForAngle(angleDeg: number): number {
  if (angleDeg <= 60) return 2;
  if (angleDeg <= 95) return 3;
  if (angleDeg <= 180) return 4;
  return 6;
}

// ─── computeStreetFillets (LOTES_SAI:83-171) ───────────────────────

export function computeStreetFillets(streets: Street[]): StreetFillet[] {
  const results: StreetFillet[] = [];

  for (let i = 0; i < streets.length; i++) {
    for (let j = i + 1; j < streets.length; j++) {
      const sA = streets[i], sB = streets[j];
      const a0 = sA.start, a1 = sA.end;
      const b0 = sB.start, b1 = sB.end;

      const ip = lineLineIntersect(a0, a1, b0, b1);
      if (!ip) continue;

      const halfA = sA.widthM / 2;
      const halfB = sB.widthM / 2;
      const nA = norm(a0, a1), dA = normalize(sub(a1, a0));
      const nB = norm(b0, b1), dB = normalize(sub(b1, b0));

      for (const sAs of [1, -1]) {
        for (const sBs of [1, -1]) {
          const eA0 = add(a0, scale(nA, sAs * halfA));
          const eA1 = add(a1, scale(nA, sAs * halfA));
          const eB0 = add(b0, scale(nB, sBs * halfB));
          const eB1 = add(b1, scale(nB, sBs * halfB));

          const corner = lineLineIntersect(eA0, eA1, eB0, eB1);
          if (!corner) continue;

          const cRel = sub(corner, ip);
          if (sAs * dot(nA, cRel) <= 0) continue;
          if (sBs * dot(nB, cRel) <= 0) continue;
          if (Math.hypot(cRel[0], cRel[1]) < 1) continue;

          const ipRel = sub(ip, corner);
          const projA = dot(ipRel, dA);
          const projB = dot(ipRel, dB);
          const outA: [number, number] = projA >= 0 ? [-dA[0], -dA[1]] : [dA[0], dA[1]];
          const outB: [number, number] = projB >= 0 ? [-dB[0], -dB[1]] : [dB[0], dB[1]];

          const cosT = Math.max(-1, Math.min(1, dot(outA, outB)));
          const theta = Math.acos(cosT);
          if (theta < 0.05 || theta > Math.PI - 0.05) continue;

          const cornerAngleDeg = (theta * 180) / Math.PI;
          const filletM = getFilletRadiusForAngle(cornerAngleDeg);
          const tol = halfA + halfB + filletM;
          if (!onSegment(ip, a0, a1, tol)) continue;
          if (!onSegment(ip, b0, b1, tol)) continue;
          if (Math.hypot(cRel[0], cRel[1]) > tol * 3) continue;

          const t = filletM / Math.tan(theta / 2);
          if (t <= 0 || !isFinite(t)) continue;

          const tangA = add(corner, scale(outA, t));
          const tangB = add(corner, scale(outB, t));

          const bisRaw: [number, number] = [outA[0] + outB[0], outA[1] + outB[1]];
          const bisLen = Math.hypot(bisRaw[0], bisRaw[1]);
          if (bisLen < 1e-9) continue;
          const bis: [number, number] = [bisRaw[0] / bisLen, bisRaw[1] / bisLen];
          const distToCtr = filletM / Math.sin(theta / 2);
          const acx = corner[0] + bis[0] * distToCtr;
          const acy = corner[1] + bis[1] * distToCtr;

          const angA = Math.atan2(tangA[1] - acy, tangA[0] - acx);
          const angB = Math.atan2(tangB[1] - acy, tangB[0] - acx);
          const caRel = Math.atan2(-bis[1], -bis[0]);
          const acw = !inSweep(caRel, angA, angB);

          results.push({
            corner,
            tangA,
            tangB,
            arcCenter: [acx, acy],
            angA,
            angB,
            acw,
            radius: filletM,
            streetA: sA,
            streetB: sB,
          });
        }
      }
    }
  }
  return results;
}

// ─── Generar puntos del arco para renderizado ───────────────────────

export function filletArcPoints(fillet: StreetFillet, segments = 16): [number, number][] {
  const { arcCenter, angA, angB, acw, radius } = fillet;
  const points: [number, number][] = [];

  let startAng = angA;
  let endAng = angB;

  if (acw) {
    if (endAng <= startAng) endAng += Math.PI * 2;
  } else {
    if (startAng <= endAng) startAng += Math.PI * 2;
  }

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const ang = startAng + (endAng - startAng) * t;
    points.push([
      arcCenter[0] + Math.cos(ang) * radius,
      arcCenter[1] + Math.sin(ang) * radius,
    ]);
  }
  return points;
}

// ─── Calcular rectángulo de calle (borde izq + derecho) ────────────

export function streetRectangle(street: Street): {
  left: [[number, number], [number, number]];
  right: [[number, number], [number, number]];
  halfWidth: number;
} {
  const { start, end, widthM } = street;
  const halfW = widthM / 2;
  const n = norm(start, end);
  return {
    left: [add(start, scale(n, halfW)), add(end, scale(n, halfW))],
    right: [add(start, scale(n, -halfW)), add(end, scale(n, -halfW))],
    halfWidth: halfW,
  };
}

// ─── Generar geometría de borde de calle con gaps para fillets ──────

export function streetEdgeSegments(
  street: Street,
  side: number,
  fillets: StreetFillet[],
  _allStreets: Street[],
): [number, number][] {
  const halfW = street.widthM / 2;
  const n = norm(street.start, street.end);
  const offset = scale(n, side * halfW);
  const pa: [number, number] = [street.start[0] + offset[0], street.start[1] + offset[1]];
  const pb: [number, number] = [street.end[0] + offset[0], street.end[1] + offset[1]];
  const segDir = normalize(sub(pb, pa));
  const segLen = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  if (segLen < 1e-6) return [];

  // Encontrar zonas a suprimir (donde hay fillets o solapes con otras calles)
  const suppress: [number, number][] = [];

  // Supresión por fillets
  for (const f of fillets) {
    const isA = f.streetA === street;
    const isB = f.streetB === street;
    if (!isA && !isB) continue;
    const mySide = isA ? (f.corner[0] - street.start[0] * n[0] - street.start[1] * n[1] > 0 ? 1 : -1) : side;
    if (mySide !== side) continue;
    const myTang = isA ? f.tangA : f.tangB;
    const cornerProj = dot(sub(f.corner, pa), segDir);
    const tangProj = dot(sub(myTang, pa), segDir);
    const t0 = Math.max(0, Math.min(tangProj, cornerProj) - 1);
    const t1 = Math.min(segLen, Math.max(tangProj, cornerProj) + 1);
    if (t1 > t0) suppress.push([t0, t1]);
  }

  // Generar segmentos visibles
  suppress.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of suppress) {
    if (merged.length > 0 && s[0] <= merged[merged.length - 1][1] + 1) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], s[1]);
    } else {
      merged.push(s);
    }
  }

  const result: [number, number][] = [];
  let cur = 0;
  for (const [g0, g1] of merged) {
    if (g0 > cur + 0.5) {
      result.push([
        [pa[0] + segDir[0] * cur, pa[1] + segDir[1] * cur],
        [pa[0] + segDir[0] * g0, pa[1] + segDir[1] * g0],
      ]);
    }
    cur = g1;
  }
  if (cur < segLen - 0.5) {
    result.push([
      [pa[0] + segDir[0] * cur, pa[1] + segDir[1] * cur],
      [pa[0] + segDir[0] * segLen, pa[1] + segDir[1] * segLen],
    ]);
  }

  return result;
}
