// ─────────────────────────────────────────────────────────────────────────
// NOTA ARQUITECTÓNICA — PARIDAD TS↔RUST (Fase 6.2 del plan)
//
// Esta implementación TypeScript del offset de polilínea vial coexiste
// con la implementación autoritativa en Rust en:
//
//   src-tauri/crates/geourban-geo/src/domains/roads/roads.rs
//
// NO es código duplicado por descuido — son dos implementaciones
// deliberadamente distintas:
//
//   1. **TS (este archivo)** — implementación aproximada, sincrónica,
//      rápida. Se usa para:
//        - Pintar el eje vial con offset durante el render
//          (`StreetPainter`, `RoundaboutPainter`).
//        - Recalcular la geometría vial cuando se mueve/edita una calle
//          en tiempo real.
//
//   2. **Rust (`roads.rs`)** — implementación autoritativa con GEOS.
//      Se usa para:
//        - Cómputo final cuando se confirma el trazado.
//        - Recálculo del manzanado (cuando cambia la red vial, se
//          dispara `recomputeManzanos()` que llama a Rust).
//        - Export a archivos.
//
// Reglas a mantener sincronizadas manualmente entre ambos lados:
//   - Algoritmo de offset de polilínea (radio de ochave, manejo de
//     ángulos reflex).
//   - Cálculo de cruces entre tramos.
//
// Si solo cambia la lógica de offset o de ochave, hay que actualizar
// **AMBOS** lados. Ver el comentario de cabecera en `roundaboutEngine.ts`
// para la estrategia de verificación de paridad sugerida.
// ─────────────────────────────────────────────────────────────────────────

import type { Pt } from '@kernel/geometry/polygonEngine';
import type { Street } from '../store/streetStore';
import { roundaboutGeometry, type RoundaboutParams } from './roundaboutEngine';
import { normalize } from './vectorMath';

function streetPolyline(street: Street): Pt[] {
  const pts: Pt[] = [street.start];
  if (street.waypoints) pts.push(...street.waypoints);
  pts.push(street.end);
  return pts;
}

const MITER_LIMIT = 4;

function offsetPolylineMiter(pts: Pt[], d: number): Pt[] {
  const n = pts.length;
  if (n < 2) return pts.map((p) => [p[0], p[1]] as Pt);

  const dirs: Pt[] = [];
  const normals: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dir = normalize(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    dirs.push(dir);
    normals.push([-dir[1], dir[0]]);
  }

  const out: Pt[] = [];
  out.push([pts[0][0] + normals[0][0] * d, pts[0][1] + normals[0][1] * d]);

  const absD = Math.abs(d) || 1e-9;

  for (let i = 0; i < n - 2; i++) {
    const n0 = normals[i],
      n1 = normals[i + 1];
    const d0 = dirs[i],
      d1 = dirs[i + 1];
    const p0: Pt = [pts[i + 1][0] + n0[0] * d, pts[i + 1][1] + n0[1] * d];
    const p1: Pt = [pts[i + 1][0] + n1[0] * d, pts[i + 1][1] + n1[1] * d];
    const det = d0[0] * d1[1] - d0[1] * d1[0];
    if (Math.abs(det) < 1e-9) {
      out.push(p0);
      continue;
    }
    const t = ((p1[0] - p0[0]) * d1[1] - (p1[1] - p0[1]) * d1[0]) / det;
    const miter: Pt = [p0[0] + d0[0] * t, p0[1] + d0[1] * t];
    const miterDist = Math.hypot(miter[0] - pts[i + 1][0], miter[1] - pts[i + 1][1]);

    if (miterDist > absD * MITER_LIMIT) {
      out.push(p0, p1);
    } else {
      out.push(miter);
    }
  }

  const last = normals[normals.length - 1];
  out.push([pts[n - 1][0] + last[0] * d, pts[n - 1][1] + last[1] * d]);
  return out;
}

function buildRing(pts: Pt[], half: number): Pt[] {
  const left = offsetPolylineMiter(pts, half);
  const right = offsetPolylineMiter(pts, -half);
  return [...left, ...right.reverse()];
}

const ROUNDABOUT_CONNECT_TOLERANCE_M = 3;
const ROUNDABOUT_OVERLAP_MARGIN_M = 0.5;

function nudgeEndpointIntoRoundabouts(
  out: Pt[],
  idx: number,
  refIdx: number,
  roundabouts: RoundaboutParams[],
  outerRadiusFor: (rb: RoundaboutParams) => number
): void {
  const p = out[idx];
  const ref = out[refIdx];
  const dirLen = Math.hypot(p[0] - ref[0], p[1] - ref[1]);
  if (dirLen < 1e-6) return;
  const dirX = (p[0] - ref[0]) / dirLen;
  const dirY = (p[1] - ref[1]) / dirLen;

  for (const rb of roundabouts) {
    const outerR = outerRadiusFor(rb);
    const d = Math.hypot(p[0] - rb.center[0], p[1] - rb.center[1]);
    if (d <= 1e-6 || d > outerR + ROUNDABOUT_CONNECT_TOLERANCE_M) continue;
    const push = Math.max(0, outerR - d) + ROUNDABOUT_OVERLAP_MARGIN_M;
    out[idx] = [p[0] + dirX * push, p[1] + dirY * push];
    return;
  }
}

function nudgePolylineIntoRoundabouts(
  ptsIn: Pt[],
  roundabouts: RoundaboutParams[],
  outerRadiusFor: (rb: RoundaboutParams) => number
): Pt[] {
  if (roundabouts.length === 0 || ptsIn.length < 2) return ptsIn;
  const out = ptsIn.map((p) => [p[0], p[1]] as Pt);
  nudgeEndpointIntoRoundabouts(out, 0, 1, roundabouts, outerRadiusFor);
  nudgeEndpointIntoRoundabouts(out, out.length - 1, out.length - 2, roundabouts, outerRadiusFor);
  return out;
}

function sidewalkOuterRadius(rb: RoundaboutParams): number {
  return rb.radiusM + rb.roadWidthM / 2 + Math.max(0, rb.sidewalkWidthM);
}
function buildStreetOuterRing(street: Street, roundabouts: RoundaboutParams[]): Pt[] {
  const half = street.widthM / 2 + Math.max(0, street.sideWidthM ?? 0);
  const pts = nudgePolylineIntoRoundabouts(
    streetPolyline(street),
    roundabouts,
    sidewalkOuterRadius
  );
  return buildRing(pts, half);
}

function buildRoundaboutOuterRing(rb: RoundaboutParams): Pt[] {
  return roundaboutGeometry(rb).sideOuter;
}

export function buildRoadNetworkRings(
  streets: Street[],
  roundabouts: RoundaboutParams[] = []
): Pt[][] {
  const rings: Pt[][] = [];
  for (const s of streets) {
    if (s.widthM <= 0) continue;
    const ring = buildStreetOuterRing(s, roundabouts);
    if (ring.length >= 3) rings.push(ring);
  }
  for (const rb of roundabouts) {
    const ring = buildRoundaboutOuterRing(rb);
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}
