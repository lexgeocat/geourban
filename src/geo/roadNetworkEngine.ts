import type { Pt } from './polygonEngine';
import type { Street } from '../store/streetStore';
import { roundaboutGeometry, type RoundaboutParams } from './roundaboutEngine';

function normalize(dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy) || 1;
  return [dx / len, dy / len];
}

/** Polilínea completa de una calle: start + waypoints + end. */
function streetPolyline(street: Street): Pt[] {
  const pts: Pt[] = [street.start];
  if (street.waypoints) pts.push(...street.waypoints);
  pts.push(street.end);
  return pts;
}

/** Multiplicador máximo de la distancia del miter respecto al offset base
 *  `d` (medio-ancho de calzada+vereda). En un ángulo muy agudo (zig-zag)
 *  el punto de miter puede alejarse arbitrariamente del vértice real —
 *  por encima de este límite se cae a un bisel en vez de la intersección
 *  exacta. Ver H-VIA-1 del diagnóstico. */
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
    const n0 = normals[i], n1 = normals[i + 1];
    const d0 = dirs[i], d1 = dirs[i + 1];
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
      // Bisel: la "espiga" del miter excede el límite — se insertan los
      // dos offsets del vértice sin unirlos en un único punto puntiagudo.
      out.push(p0, p1);
    } else {
      out.push(miter);
    }
  }

  const last = normals[normals.length - 1];
  out.push([pts[n - 1][0] + last[0] * d, pts[n - 1][1] + last[1] * d]);
  return out;
}

/** Anillo cerrado (no filleteado aún) del borde exterior de una calle
 *  (calzada/2 + vereda a cada lado). */
function buildStreetOuterRing(street: Street): Pt[] {
  const pts = streetPolyline(street);
  const half = street.widthM / 2 + Math.max(0, street.sideWidthM ?? 0);
  const left = offsetPolylineMiter(pts, half);
  const right = offsetPolylineMiter(pts, -half);
  return [...left, ...right.reverse()];
}

function buildRoundaboutOuterRing(rb: RoundaboutParams): Pt[] {
  return roundaboutGeometry(rb).sideOuter;
}

/**
 * Devuelve, sin unir, todos los anillos "outer" (calzada+vereda) de la red
 * vial actual — el llamador los une en una sola operación booleana
 * (ver computeManzanosInWorker), lo que hace el resultado independiente del
 * orden de trazado y correcto en cruces de 3+ vías.
 */
export function buildRoadNetworkRings(
  streets: Street[],
  roundabouts: RoundaboutParams[] = [],
): Pt[][] {
  const rings: Pt[][] = [];
  for (const s of streets) {
    if (s.widthM <= 0) continue;
    const ring = buildStreetOuterRing(s);
    if (ring.length >= 3) rings.push(ring);
  }
  for (const rb of roundabouts) {
    const ring = buildRoundaboutOuterRing(rb);
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}
