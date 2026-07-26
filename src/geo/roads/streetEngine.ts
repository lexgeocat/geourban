import type { Street } from '../../store/entities/streetStore';

export interface StreetFillet {
  corner: [number, number];
  tangA: [number, number];
  tangB: [number, number];
  arcCenter: [number, number];
  angA: number;
  angB: number;
  acw: boolean;
  radius: number;
  streetA: Street;
  streetB: Street;
}

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

/** Radio máximo de ochave, configurable por proyecto (H-VIA-3). Antes era
 *  una constante fija de 8m sin UI ni relación con el ancho real de
 *  calzada. El control vive en ManzanoPanel → llama setMaxFilletRadius. */
let filletMaxRadiusM = 8;

export function setMaxFilletRadius(radiusM: number): void {
  filletMaxRadiusM = Math.max(1, radiusM);
}

export function getMaxFilletRadius(): number {
  return filletMaxRadiusM;
}

/**
 * Radio de ochave por ángulo interno del vértice. `roadHalfWidthM`
 * (medio-ancho combinado de calzada+vereda de las 2 calles que se
 * cruzan) es opcional: si se pasa, el radio de tabla se escala hacia
 * arriba para vías anchas (una avenida de 30m no puede tener el mismo
 * ochave que una calle de 6m), sin superar `filletMaxRadiusM`.
 */
export function getFilletRadiusForAngle(angleDeg: number, roadHalfWidthM?: number): number {
  const tableValue = (() => {
    if (angleDeg <= 35) return 2.5;
    if (angleDeg <= 45) return 3;
    if (angleDeg <= 95) return 4;
    if (angleDeg <= 120) return 4.5;
    if (angleDeg <= 150) return 5;
    return filletMaxRadiusM;
  })();

  const base = Math.min(tableValue, filletMaxRadiusM);
  if (roadHalfWidthM == null) return base;

  const scaledForWidth = Math.min(filletMaxRadiusM, roadHalfWidthM * 0.5);
  return Math.max(base, scaledForWidth);
}

export interface StreetFilletsBundle {
  inner: StreetFillet[];
  outer: StreetFillet[];
}

/** Fillets de UN par de calles (ambas variantes: calzada + vereda). Es
 *  el cuerpo por-par que antes vivía inline dentro del doble loop de
 *  `computeStreetFilletsBoth` — extraído para que PostrenderPainter
 *  pueda cachear por par y no recalcular TODO ante cualquier cambio
 *  (Fase 6, punto 2 / H-VIA-10). */
export function computeStreetPairFillets(sA: Street, sB: Street): StreetFilletsBundle {
  const inner: StreetFillet[] = [];
  const outer: StreetFillet[] = [];

  const a0 = sA.start, a1 = sA.end;
  const b0 = sB.start, b1 = sB.end;

  const ip = lineLineIntersect(a0, a1, b0, b1);
  if (!ip) return { inner, outer };

  const swA = Math.max(0, sA.sideWidthM ?? 0);
  const swB = Math.max(0, sB.sideWidthM ?? 0);
  const nA = norm(a0, a1), dA = normalize(sub(a1, a0));
  const nB = norm(b0, b1), dB = normalize(sub(b1, b0));

  for (const variant of ['inner', 'outer'] as const) {
    const isOuter = variant === 'outer';
    const halfA = sA.widthM / 2 + (isOuter ? swA : 0);
    const halfB = sB.widthM / 2 + (isOuter ? swB : 0);
    const out = isOuter ? outer : inner;

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
        const baseFillet = getFilletRadiusForAngle(cornerAngleDeg, Math.max(halfA, halfB));
        const filletM = isOuter ? baseFillet : baseFillet + Math.max(swA, swB);

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

        out.push({
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

  return { inner, outer };
}

/** Agregado de TODOS los pares — se mantiene como API pública (recompute
 *  completo, útil para tests o cualquier otro consumidor), pero
 *  PostrenderPainter ya NO la usa directamente: usa `computeStreetPairFillets`
 *  con cache por par (ver PostrenderPainter.updateIncrementalStreetCaches). */
export function computeStreetFilletsBoth(streets: Street[]): StreetFilletsBundle {
  const inner: StreetFillet[] = [];
  const outer: StreetFillet[] = [];
  for (let i = 0; i < streets.length; i++) {
    for (let j = i + 1; j < streets.length; j++) {
      const pair = computeStreetPairFillets(streets[i], streets[j]);
      inner.push(...pair.inner);
      outer.push(...pair.outer);
    }
  }
  return { inner, outer };
}

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