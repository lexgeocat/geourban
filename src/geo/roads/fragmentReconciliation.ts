import polygonClipping, { type Polygon as ClipPolygon } from 'polygon-clipping';
import { polyArea, type Pt } from '../math/polygonEngine';

export interface FragmentAssignment<T> {
  fragmentIdx: number;
  member: T | null;
  overlapArea: number;
}

function closeRing(ring: Pt[]): Pt[] {
  if (ring.length === 0) return ring;
  const f = ring[0], l = ring[ring.length - 1];
  if (Math.abs(f[0] - l[0]) > 1e-9 || Math.abs(f[1] - l[1]) > 1e-9) return [...ring, [f[0], f[1]]];
  return ring;
}

function toClipPoly(ring: Pt[]): ClipPolygon {
  return [closeRing(ring) as unknown as [number, number][]] as unknown as ClipPolygon;
}

export function ringIntersectionArea(a: Pt[], b: Pt[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  try {
    const result = polygonClipping.intersection(toClipPoly(a), toClipPoly(b));
    let area = 0;
    for (const poly of result) {
      const outer = poly[0] as unknown as Pt[];
      area += polyArea(outer);
      for (let i = 1; i < poly.length; i++) {
        area -= polyArea(poly[i] as unknown as Pt[]);
      }
    }
    return Math.max(0, area);
  } catch {
    return 0;
  }
}

const MATCH_MIN_RATIO = 0.35;

export function matchFragmentsToMembers<T>(
  fragments: Pt[][],
  members: Array<{ ring: Pt[]; ref: T }>,
): Array<FragmentAssignment<T>> {
  const candidates: Array<{ fragIdx: number; memberIdx: number; overlap: number }> = [];
  const MATCH_COMPLEXITY_WARNING = 20000;
  const totalPairs = fragments.length * members.length;
  if (totalPairs > MATCH_COMPLEXITY_WARNING) {
    console.warn(
      `fragmentReconciliation: matchFragmentsToMembers procesando ${fragments.length} fragmento(s) × ` +
      `${members.length} miembro(s) = ${totalPairs} pares candidatos — puede ser lento. Revisá si hay ` +
      `demasiadas vías cruzándose en la misma zona.`,
    );
  }

  for (let fi = 0; fi < fragments.length; fi++) {
    if (polyArea(fragments[fi]) <= 0) continue;
    for (let mi = 0; mi < members.length; mi++) {
      const overlap = ringIntersectionArea(fragments[fi], members[mi].ring);
      if (overlap > 0) candidates.push({ fragIdx: fi, memberIdx: mi, overlap });
    }
  }
  candidates.sort((a, b) => b.overlap - a.overlap);

  const fragAssigned = new Set<number>();
  const memberAssigned = new Set<number>();
  const assignments: Array<FragmentAssignment<T>> = [];

  for (const c of candidates) {
    if (fragAssigned.has(c.fragIdx) || memberAssigned.has(c.memberIdx)) continue;
    const fragArea = polyArea(fragments[c.fragIdx]);
    const ratio = fragArea > 0 ? c.overlap / fragArea : 0;
    if (ratio < MATCH_MIN_RATIO) continue;
    assignments.push({ fragmentIdx: c.fragIdx, member: members[c.memberIdx].ref, overlapArea: c.overlap });
    fragAssigned.add(c.fragIdx);
    memberAssigned.add(c.memberIdx);
  }

  for (let fi = 0; fi < fragments.length; fi++) {
    if (!fragAssigned.has(fi)) assignments.push({ fragmentIdx: fi, member: null, overlapArea: 0 });
  }

  return assignments;
}
