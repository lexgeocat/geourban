import type { Pt } from '@kernel/geometry/polygonEngine';
import { distToSegment } from '@kernel/geometry/dist';
import type { Street } from '@vias-engine/store/streetStore';

export interface StreetLabelSlot {
  pos: Pt;
  segFrom: Pt;
  segTo: Pt;
}

interface StreetLabelZone {
  lo: number;
  hi: number;
}

type StreetChain = Array<{ from: Pt; to: Pt; len: number }>;

function streetAllCoords(s: Street): Pt[] {
  return [s.start, ...(s.waypoints ?? []), s.end];
}

function buildChain(coords: Pt[]): StreetChain {
  const chain: StreetChain = [];
  for (let i = 1; i < coords.length; i++) {
    const from = coords[i - 1];
    const to = coords[i];
    chain.push({ from, to, len: Math.hypot(to[0] - from[0], to[1] - from[1]) });
  }
  return chain;
}

function segSegIntersection(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const dax = a2[0] - a1[0],
    day = a2[1] - a1[1];
  const dbx = b2[0] - b1[0],
    dby = b2[1] - b1[1];
  const den = dax * dby - day * dbx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b1[0] - a1[0]) * dby - (b1[1] - a1[1]) * dbx) / den;
  const u = ((b1[0] - a1[0]) * day - (b1[1] - a1[1]) * dax) / den;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [a1[0] + t * dax, a1[1] + t * day];
  return null;
}

function streetPairCrossings(si: Street, sj: Street): Pt[] {
  const chainI = buildChain(streetAllCoords(si));
  const chainJ = buildChain(streetAllCoords(sj));
  const points: Pt[] = [];
  for (const segI of chainI) {
    for (const segJ of chainJ) {
      const pt = segSegIntersection(segI.from, segI.to, segJ.from, segJ.to);
      if (pt) points.push(pt);
    }
  }
  return points;
}

export function computeStreetCrossings(streets: Street[]): Map<string, Pt[]> {
  const result = new Map<string, Pt[]>();
  for (const s of streets) result.set(s.id, []);
  for (let i = 0; i < streets.length; i++) {
    for (let j = i + 1; j < streets.length; j++) {
      const pts = streetPairCrossings(streets[i], streets[j]);
      if (pts.length === 0) continue;
      result.get(streets[i].id)!.push(...pts);
      result.get(streets[j].id)!.push(...pts);
    }
  }
  return result;
}

function crossingOffsets(chain: StreetChain, crossings: Pt[]): number[] {
  const offsets: number[] = [];
  let walk = 0;
  for (const seg of chain) {
    for (const c of crossings) {
      const d = distToSegment(c, seg.from, seg.to);
      if (d < 0.5) {
        const t =
          ((c[0] - seg.from[0]) * (seg.to[0] - seg.from[0]) +
            (c[1] - seg.from[1]) * (seg.to[1] - seg.from[1])) /
          (seg.len * seg.len);
        offsets.push(walk + Math.max(0, Math.min(seg.len, t * seg.len)));
      }
    }
    walk += seg.len;
  }
  return offsets;
}

function sampleChainAt(chain: StreetChain, dist: number): StreetLabelSlot | null {
  let walk = 0;
  for (const seg of chain) {
    const isLast = seg === chain[chain.length - 1];
    if (dist <= walk + seg.len || isLast) {
      const t = seg.len > 1e-6 ? Math.max(0, Math.min(1, (dist - walk) / seg.len)) : 0;
      const pos: Pt = [
        seg.from[0] + t * (seg.to[0] - seg.from[0]),
        seg.from[1] + t * (seg.to[1] - seg.from[1]),
      ];
      return { pos, segFrom: seg.from, segTo: seg.to };
    }
    walk += seg.len;
  }
  return null;
}

export function pickStreetLabelSlots(
  street: Street,
  crossings: Pt[],
  textHalfWidthMapUnits: number,
  repeatM = 140
): StreetLabelSlot[] {
  const coords = streetAllCoords(street);
  const chain = buildChain(coords);
  const totalLen = chain.reduce((sum, seg) => sum + seg.len, 0);
  if (totalLen < 1) return [];

  const roadHalfWidthM = street.widthM / 2 + Math.max(0, street.sideWidthM ?? 0);
  const marginM = textHalfWidthMapUnits + roadHalfWidthM + 4;

  const zones: StreetLabelZone[] = [
    { lo: 0, hi: marginM },
    { lo: totalLen - marginM, hi: totalLen },
  ];
  for (const off of crossingOffsets(chain, crossings)) {
    zones.push({ lo: off - marginM, hi: off + marginM });
  }
  zones.sort((a, b) => a.lo - b.lo);

  const merged: StreetLabelZone[] = [];
  for (const z of zones) {
    const lo = Math.max(0, z.lo),
      hi = Math.min(totalLen, z.hi);
    if (hi <= lo) continue;
    const last = merged[merged.length - 1];
    if (last && lo <= last.hi) last.hi = Math.max(last.hi, hi);
    else merged.push({ lo, hi });
  }

  const free: StreetLabelZone[] = [];
  let cursor = 0;
  for (const z of merged) {
    if (z.lo > cursor) free.push({ lo: cursor, hi: z.lo });
    cursor = Math.max(cursor, z.hi);
  }
  if (cursor < totalLen) free.push({ lo: cursor, hi: totalLen });

  const slots: StreetLabelSlot[] = [];
  for (const { lo, hi } of free) {
    const usable = hi - lo;
    if (usable <= 0) continue;
    const count = Math.max(1, Math.floor(usable / repeatM));
    const step = count === 1 ? 0 : usable / count;
    const first = count === 1 ? (lo + hi) / 2 : lo + step / 2;
    for (let k = 0; k < count; k++) {
      const sample = sampleChainAt(chain, first + k * step);
      if (sample) slots.push(sample);
    }
  }
  return slots;
}
