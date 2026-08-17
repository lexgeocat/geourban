import type { Pt } from './polygonEngine';
import { closeRing, polyArea } from './polygonEngine';

function segIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): { pt: Pt; tA: number } | null {
  const x1 = a1[0],
    y1 = a1[1],
    x2 = a2[0],
    y2 = a2[1];
  const x3 = b1[0],
    y3 = b1[1],
    x4 = b2[0],
    y4 = b2[1];
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-12) return null;
  const tA = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const tB = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / denom;
  if (tA < -1e-9 || tA > 1 + 1e-9 || tB < -1e-9 || tB > 1 + 1e-9) return null;
  const clampedA = Math.min(1, Math.max(0, tA));
  return { pt: [x1 + clampedA * (x2 - x1), y1 + clampedA * (y2 - y1)], tA: clampedA };
}

interface Crossing {
  pt: Pt;
  segIndex: number;
  t: number;
  arc: number;
}

function findCrossings(target: Pt[], cutter: Pt[]): Crossing[] {
  const crossings: Crossing[] = [];
  let arc = 0;
  for (let i = 0; i < target.length - 1; i++) {
    const a = target[i];
    const b = target[i + 1];
    const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let j = 0; j < cutter.length - 1; j++) {
      const hit = segIntersect(a, b, cutter[j], cutter[j + 1]);
      if (hit) crossings.push({ pt: hit.pt, segIndex: i, t: hit.tA, arc: arc + hit.tA * segLen });
    }
    arc += segLen;
  }
  crossings.sort((c1, c2) => c1.arc - c2.arc);
  const deduped: Crossing[] = [];
  for (const c of crossings) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(prev.arc - c.arc) < 1e-6) continue;
    deduped.push(c);
  }
  return deduped;
}

/** Divide una polilínea abierta en N+1 tramos, uno por cada cruce con `cutter`. */
export function splitLineStringByLine(target: Pt[], cutter: Pt[]): Pt[][] | null {
  if (target.length < 2 || cutter.length < 2) return null;
  const crossings = findCrossings(target, cutter);
  if (crossings.length === 0) return null;

  type Node = { pt: Pt; isCrossing: boolean };
  const nodes: Node[] = [{ pt: target[0], isCrossing: false }];
  let cIdx = 0;
  for (let i = 0; i < target.length - 1; i++) {
    while (cIdx < crossings.length && crossings[cIdx].segIndex === i) {
      nodes.push({ pt: crossings[cIdx].pt, isCrossing: true });
      cIdx++;
    }
    nodes.push({ pt: target[i + 1], isCrossing: false });
  }

  const pieces: Pt[][] = [];
  let current: Pt[] = [nodes[0].pt];
  for (let i = 1; i < nodes.length; i++) {
    current.push(nodes[i].pt);
    if (nodes[i].isCrossing) {
      pieces.push(current);
      current = [nodes[i].pt];
    }
  }
  if (current.length >= 2) pieces.push(current);
  const valid = pieces.filter((p) => p.length >= 2);
  return valid.length >= 2 ? valid : null;
}

export function splitPolygonRingByLine(ringIn: Pt[], cutter: Pt[]): { a: Pt[]; b: Pt[] } | null {
  const ring = closeRing(ringIn);
  const crossings = findCrossings(ring, cutter);
  if (crossings.length !== 2) return null;
  const [c1, c2] = crossings; // ya ordenados por posición a lo largo del anillo
  const n = ring.length - 1; // vértices únicos

  const walk = (from: Crossing, to: Crossing): Pt[] => {
    const out: Pt[] = [from.pt];
    let i = from.segIndex + 1;
    let guard = 0;
    while (i % n !== (to.segIndex + 1) % n && guard <= n) {
      out.push(ring[i % n]);
      i++;
      guard++;
    }
    out.push(to.pt);
    return out;
  };

  const ringA = closeRing(walk(c1, c2));
  const ringB = closeRing(walk(c2, c1));

  if (ringA.length < 4 || ringB.length < 4) return null;
  if (polyArea(ringA) < 1e-6 || polyArea(ringB) < 1e-6) return null;

  return { a: ringA, b: ringB };
}
