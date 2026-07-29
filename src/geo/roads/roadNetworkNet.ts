import type { Pt } from '../math/polygonEngine';
import type { Street } from '../../store/entities/streetStore';
import type { RoundaboutParams } from '../roundabout/roundaboutEngine';
import { buildRoadNetworkRings, buildRoadOnlyRings } from './roadNetworkEngine';
import { roundRingReflex, type CornerMode } from './ringFillet';
import polygonClipping, {
  type Polygon as ClipPolygon,
  type MultiPolygon as ClipMultiPolygon,
} from 'polygon-clipping';

export interface RoadNetworkNet {
  road: Pt[][][];
  outer: Pt[][][];
}

function closeRing(ring: Pt[]): Pt[] {
  const f = ring[0], l = ring[ring.length - 1];
  if (Math.abs(f[0] - l[0]) > 1e-9 || Math.abs(f[1] - l[1]) > 1e-9) return [...ring, [f[0], f[1]]];
  return ring;
}

function orientRingCcw(ring: Pt[]): Pt[] {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return area >= 0 ? ring : ring.slice().reverse();
}

const UNION_PRECISION = 1e6;
function roundRingForUnion(ring: Pt[]): Pt[] {
  return ring.map(
    ([x, y]) =>
      [Math.round(x * UNION_PRECISION) / UNION_PRECISION, Math.round(y * UNION_PRECISION) / UNION_PRECISION] as Pt,
  );
}

function extractPolygonRingsFromMultiPolygon(mp: ClipMultiPolygon): Pt[][][] {
  const polygons: Pt[][][] = [];
  for (const poly of mp) {
    const rings: Pt[][] = [];
    for (const ring of poly) {
      if (ring && ring.length >= 4) rings.push(ring.map((c) => [c[0], c[1]] as Pt));
    }
    if (rings.length > 0) polygons.push(rings);
  }
  return polygons;
}

const MAX_UNION_POINTS = 15000;
const MAX_UNION_SHAPES = 800;
const UNION_TIME_WARNING_MS = 300;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function unionRings(rings: Pt[][]): Pt[][][] {
  if (rings.length === 0) return [];

  const totalPoints = rings.reduce((sum, r) => sum + r.length, 0);
  if (totalPoints > MAX_UNION_POINTS || rings.length > MAX_UNION_SHAPES) {
    console.warn(
      `roadNetworkNet: unión omitida — ${rings.length} anillo(s) / ${totalPoints} punto(s) totales supera el ` +
      `límite de seguridad (shapes: ${MAX_UNION_SHAPES}, points: ${MAX_UNION_POINTS}). Se dibuja cada calle sin ` +
      `fusionar. Revisá geometría de vías por segmentos degenerados o duplicados.`,
    );
    return rings.map((r) => [r]);
  }

  const polys: ClipPolygon[] = [];
  for (const ring of rings) {
    const rounded = roundRingForUnion(ring);
    if (rounded.length >= 3) polys.push([closeRing(rounded)] as unknown as ClipPolygon);
  }
  if (polys.length === 0) return [];

  const t0 = now();
  try {
    let mp: ClipMultiPolygon;
    try {
      mp = polygonClipping.union(polys[0], ...polys.slice(1));
    } catch {
      const selfCleaned: ClipPolygon[] = [];
      for (const p of polys) {
        for (const poly of polygonClipping.union(p)) selfCleaned.push(poly);
      }
      if (selfCleaned.length === 0) return [];
      mp = polygonClipping.union(selfCleaned[0], ...selfCleaned.slice(1));
    }
    return extractPolygonRingsFromMultiPolygon(mp);
  } catch (err2) {
    console.warn(
      'roadNetworkNet: unión falló sin recuperación (revisá si alguna vía tiene una curva muy cerrada para su ancho/offset):',
      err2,
    );
    return rings.map((r) => [r]);
  } finally {
    const elapsed = now() - t0;
    if (elapsed > UNION_TIME_WARNING_MS) {
      console.warn(
        `roadNetworkNet: unión de ${polys.length} polígono(s) (${totalPoints} pts) tardó ${elapsed.toFixed(0)}ms. ` +
        `Si esto se repite seguido, es indicio de geometría degenerada o de una red vial demasiado densa.`,
      );
    }
  }
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function makeSideExtraProbe(streets: Street[], roundabouts: RoundaboutParams[]) {
  return (pt: Pt): number => {
    let best = 0;
    for (const s of streets) {
      const sw = Math.max(0, s.sideWidthM ?? 0);
      if (sw <= best) continue;
      const pts: Pt[] = [s.start, ...(s.waypoints ?? []), s.end];
      for (let i = 0; i < pts.length - 1; i++) {
        const reach = s.widthM / 2 + sw + 3;
        if (distToSegment(pt, pts[i], pts[i + 1]) < reach) { best = Math.max(best, sw); break; }
      }
    }
    for (const rb of roundabouts) {
      const sw = Math.max(0, rb.sidewalkWidthM ?? 0);
      if (sw <= best) continue;
      const d = Math.hypot(pt[0] - rb.center[0], pt[1] - rb.center[1]);
      if (Math.abs(d - (rb.radiusM + rb.roadWidthM / 2)) < rb.roadWidthM + sw + 3) best = Math.max(best, sw);
    }
    return best;
  };
}

export function computeRoadNetworkNet(
  streets: Street[],
  roundabouts: RoundaboutParams[] = [],
  cornerMode: CornerMode = 'fillet',
): RoadNetworkNet {
  const roadRingsRaw = buildRoadOnlyRings(streets, roundabouts);
  const outerRingsRaw = buildRoadNetworkRings(streets, roundabouts);
  const sideExtraAt = makeSideExtraProbe(streets, roundabouts);

  const roadUnion = unionRings(roadRingsRaw);
  const outerUnion = unionRings(outerRingsRaw);

  const processPolygons = (
    polygons: Pt[][][],
    extra: number | ((pt: Pt) => number),
  ): Pt[][][] =>
    polygons.map((rings) =>
      rings.map((ring, idx) => roundRingReflex(orientRingCcw(ring), extra, idx > 0, cornerMode)),
    );

  return {
    road: processPolygons(roadUnion, sideExtraAt),
    outer: processPolygons(outerUnion, 0),
  };
}