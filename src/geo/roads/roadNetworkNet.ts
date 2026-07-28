import type { Pt } from '../math/polygonEngine';
import type { Street } from '../../store/entities/streetStore';
import type { RoundaboutParams } from '../roundabout/roundaboutEngine';
import { buildRoadNetworkRings, buildRoadOnlyRings } from './roadNetworkEngine';
import { roundRingReflex } from './ringFillet';
import { useRoadCornerStore } from '../../store/map/roadCornerStore';
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

const UNION_PRECISION = 1e6; // grilla de ~1e-6 unidades de mapa
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

function unionRings(rings: Pt[][]): Pt[][][] {
  if (rings.length === 0) return [];

  const totalPoints = rings.reduce((sum, r) => sum + r.length, 0);
  if (totalPoints > MAX_UNION_POINTS) {
    console.warn(
      `roadNetworkNet: unión omitida — ${totalPoints} puntos totales supera el límite de seguridad (${MAX_UNION_POINTS}). Revisá geometría de vías por segmentos degenerados o duplicados.`,
    );
    return rings.map((r) => [r]);
  }

  const polys: ClipPolygon[] = [];
  for (const ring of rings) {
    const rounded = roundRingForUnion(ring);
    if (rounded.length >= 3) polys.push([closeRing(rounded)] as unknown as ClipPolygon);
  }
  if (polys.length === 0) return [];

  try {
    const result = polygonClipping.union(polys[0], ...polys.slice(1));
    return extractPolygonRingsFromMultiPolygon(result);
  } catch {
    try {
      const selfCleaned: ClipPolygon[] = [];
      for (const p of polys) {
        for (const poly of polygonClipping.union(p)) selfCleaned.push(poly);
      }
      if (selfCleaned.length === 0) return [];
      const result = polygonClipping.union(selfCleaned[0], ...selfCleaned.slice(1));
      return extractPolygonRingsFromMultiPolygon(result);
    } catch (err2) {
      console.warn(
        'roadNetworkNet: unión falló sin recuperación (revisá si alguna vía tiene una curva muy cerrada para su ancho/offset):',
        err2,
      );
      // Fallback sin unión real: cada anillo como su propio polígono sin holes.
      return rings.map((r) => [r]);
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
): RoadNetworkNet {
  const roadRingsRaw = buildRoadOnlyRings(streets, roundabouts);
  const outerRingsRaw = buildRoadNetworkRings(streets, roundabouts);
  const sideExtraAt = makeSideExtraProbe(streets, roundabouts);

  const roadUnion = unionRings(roadRingsRaw);
  const outerUnion = unionRings(outerRingsRaw);

  const cornerMode = useRoadCornerStore.getState().mode;

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