import { useStreetStore, type Street } from '../../../store/entities/streetStore';
import { computeStreetPairFillets, filletArcPoints, type StreetFillet } from '../../../geo/roads/streetEngine';
import { type Pt } from '../../../geo/math/polygonEngine';
import { measureCachedWidth } from '../../textMeasureCache';

type StreetChain = Array<{ from: Pt; to: Pt; len: number }>;
type CrossingsMap = globalThis.Map<string, Pt[]>;
type StreetLabelSlot = { pos: Pt; angle: number; len: number };
interface StreetLabelZone { lo: number; hi: number }

function streetsHash(streets: Street[]): string {
  return streets
    .map((s) => `${s.id}:${s.start[0]},${s.start[1]}-${s.end[0]},${s.end[1]}:${s.widthM}:${s.sideWidthM}`)
    .join('|');
}

function buildStreetChain(coords: Array<[number, number]>): StreetChain {
  const chain: StreetChain = [];
  for (let i = 1; i < coords.length; i++) {
    const from = coords[i - 1];
    const to = coords[i];
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    chain.push({ from, to, len });
  }
  return chain;
}

function segSegIntersection(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const dax = a2[0] - a1[0], day = a2[1] - a1[1];
  const dbx = b2[0] - b1[0], dby = b2[1] - b1[1];
  const den = dax * dby - day * dbx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b1[0] - a1[0]) * dby - (b1[1] - a1[1]) * dbx) / den;
  const u = ((b1[0] - a1[0]) * day - (b1[1] - a1[1]) * dax) / den;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [a1[0] + t * dax, a1[1] + t * day];
  return null;
}

function computeStreetPairCrossings(si: Street, sj: Street): Pt[] {
  const chainI = buildStreetChain([si.start, ...(si.waypoints ?? []), si.end]);
  const chainJ = buildStreetChain([sj.start, ...(sj.waypoints ?? []), sj.end]);
  const points: Pt[] = [];
  for (const segI of chainI) {
    for (const segJ of chainJ) {
      const pt = segSegIntersection(segI.from, segI.to, segJ.from, segJ.to);
      if (pt) points.push(pt);
    }
  }
  return points;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function computeCrossingOffsets(chain: StreetChain, crossings: Pt[]): number[] {
  const offsets: number[] = [];
  let walk = 0;
  for (const seg of chain) {
    for (const c of crossings) {
      const d = distToSegment(c, seg.from, seg.to);
      if (d < 0.5) {
        const t = ((c[0] - seg.from[0]) * (seg.to[0] - seg.from[0]) + (c[1] - seg.from[1]) * (seg.to[1] - seg.from[1])) / (seg.len * seg.len);
        offsets.push(walk + Math.max(0, Math.min(seg.len, t * seg.len)));
      }
    }
    walk += seg.len;
  }
  return offsets;
}

function sampleChainAt(chain: StreetChain, dist: number): { pos: Pt; angle: number } | null {
  let walk = 0;
  for (const seg of chain) {
    const isLast = seg === chain[chain.length - 1];
    if (dist <= walk + seg.len || isLast) {
      const t = seg.len > 1e-6 ? Math.max(0, Math.min(1, (dist - walk) / seg.len)) : 0;
      const pos: Pt = [seg.from[0] + t * (seg.to[0] - seg.from[0]), seg.from[1] + t * (seg.to[1] - seg.from[1])];
      let ang = Math.atan2(seg.to[1] - seg.from[1], seg.to[0] - seg.from[0]);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      return { pos, angle: ang };
    }
    walk += seg.len;
  }
  return null;
}

function pickStreetLabelSlots(
  ctx: CanvasRenderingContext2D,
  coords: Array<[number, number]>,
  crossings: Pt[],
  labelText: string,
  fontPx: number,
  roadHalfWidthM: number,
  repeatM = 140,
): StreetLabelSlot[] {
  const chain = buildStreetChain(coords);
  const totalLen = chain.reduce((s, c) => s + c.len, 0);
  if (totalLen < 1) return [];

  ctx.save();
  ctx.font = `bold ${fontPx}px Courier New`;
  const textHalfW = measureCachedWidth(ctx, labelText) / 2 + 4;
  ctx.restore();

  const marginM = textHalfW + roadHalfWidthM + 4;
  const zones: StreetLabelZone[] = [
    { lo: 0, hi: marginM },
    { lo: totalLen - marginM, hi: totalLen },
  ];
  for (const off of computeCrossingOffsets(chain, crossings)) {
    zones.push({ lo: off - marginM, hi: off + marginM });
  }
  zones.sort((a, b) => a.lo - b.lo);

  const merged: StreetLabelZone[] = [];
  for (const z of zones) {
    const lo = Math.max(0, z.lo), hi = Math.min(totalLen, z.hi);
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
      if (sample) slots.push({ pos: sample.pos, angle: sample.angle, len: usable });
    }
  }
  return slots;
}

function streetAllCoords(s: Street): Array<[number, number]> {
  const coords: Array<[number, number]> = [s.start];
  if (s.waypoints) coords.push(...s.waypoints);
  coords.push(s.end);
  return coords;
}

function computeAllStreetLabelSlots(
  ctx: CanvasRenderingContext2D,
  streets: Street[],
  crossingsMap: CrossingsMap,
  zoom: number,
): globalThis.Map<string, StreetLabelSlot[]> {
  const result = new globalThis.Map<string, StreetLabelSlot[]>();
  if (zoom <= 12) return result;
  for (const s of streets) {
    const crossings = crossingsMap.get(s.id) ?? [];
    const fs1 = Math.max(9, Math.min(13, (10 * zoom) / 18));
    const labelText = `--- ${s.name} (Ancho de Vía ${s.widthM.toFixed(2)}m) ---`;
    const roadHalfWidthM = s.widthM / 2 + Math.max(0, s.sideWidthM ?? 0);
    const slots = pickStreetLabelSlots(ctx, streetAllCoords(s), crossings, labelText, fs1, roadHalfWidthM, 140);
    result.set(s.id, slots);
  }
  return result;
}

/** Pinta calzada/vereda/eje/fillets/labels de la red vial. Cache
 *  incremental por par de calles (ex Fase 6, punto 2 / H-VIA-10).
 *  Extraído de PostrenderPainter (Fase 5). */
export class StreetPainter {
  private cachedFillets: StreetFillet[] = [];
  private cachedOuterFillets: StreetFillet[] = [];
  private cachedCrossings: CrossingsMap = new globalThis.Map();
  private cachedStreetLabelSlots = new globalThis.Map<string, StreetLabelSlot[]>();
  private lastStreetHash = '';
  private lastLabelZoomBucket = -1;
  private pairFilletCache = new globalThis.Map<string, { inner: StreetFillet[]; outer: StreetFillet[]; hashA: string; hashB: string }>();
  private pairCrossingCache = new globalThis.Map<string, { points: Pt[]; hashA: string; hashB: string }>();

  private streetPairHash(s: Street): string {
    return `${s.start[0]},${s.start[1]}|${s.end[0]},${s.end[1]}|${s.widthM}|${s.sideWidthM}|${(s.waypoints ?? []).map((w) => `${w[0]},${w[1]}`).join(';')}`;
  }

  private updateIncrementalCaches(streets: Street[]): void {
    const currentIds = new Set(streets.map((s) => s.id));
    for (const key of this.pairFilletCache.keys()) {
      const [idA, idB] = key.split('::');
      if (!currentIds.has(idA) || !currentIds.has(idB)) {
        this.pairFilletCache.delete(key);
        this.pairCrossingCache.delete(key);
      }
    }

    const hashes = new globalThis.Map<string, string>();
    for (const s of streets) hashes.set(s.id, this.streetPairHash(s));

    const inner: StreetFillet[] = [];
    const outer: StreetFillet[] = [];
    const crossings: CrossingsMap = new globalThis.Map();
    for (const s of streets) crossings.set(s.id, []);

    for (let i = 0; i < streets.length; i++) {
      for (let j = i + 1; j < streets.length; j++) {
        const sA = streets[i], sB = streets[j];
        const key = sA.id < sB.id ? `${sA.id}::${sB.id}` : `${sB.id}::${sA.id}`;
        const hA = hashes.get(sA.id)!, hB = hashes.get(sB.id)!;

        let filletEntry = this.pairFilletCache.get(key);
        if (!filletEntry || filletEntry.hashA !== hA || filletEntry.hashB !== hB) {
          const pair = computeStreetPairFillets(sA, sB);
          filletEntry = { inner: pair.inner, outer: pair.outer, hashA: hA, hashB: hB };
          this.pairFilletCache.set(key, filletEntry);
        }
        inner.push(...filletEntry.inner);
        outer.push(...filletEntry.outer);

        let crossEntry = this.pairCrossingCache.get(key);
        if (!crossEntry || crossEntry.hashA !== hA || crossEntry.hashB !== hB) {
          const points = computeStreetPairCrossings(sA, sB);
          crossEntry = { points, hashA: hA, hashB: hB };
          this.pairCrossingCache.set(key, crossEntry);
        }
        if (crossEntry.points.length > 0) {
          crossings.get(sA.id)!.push(...crossEntry.points);
          crossings.get(sB.id)!.push(...crossEntry.points);
        }
      }
    }

    this.cachedFillets = inner;
    this.cachedOuterFillets = outer;
    this.cachedCrossings = crossings;
  }

  /** `forceDirty`: invalidación externa (drawSource cambió) — la pasa
   *  PostrenderPainter.updateCaches(). */
  update(ctx: CanvasRenderingContext2D, zoom: number, forceDirty: boolean): void {
    const streets = useStreetStore.getState().streets;
    const currentHash = streetsHash(streets);
    const streetsChanged = currentHash !== this.lastStreetHash;
    const zoomBucket = Math.round(zoom * 4);
    const zoomBucketChanged = zoomBucket !== this.lastLabelZoomBucket;

    if (streetsChanged || forceDirty) {
      this.updateIncrementalCaches(streets);
      this.lastStreetHash = currentHash;
    }
    if (streetsChanged || forceDirty || zoomBucketChanged) {
      this.cachedStreetLabelSlots = computeAllStreetLabelSlots(ctx, streets, this.cachedCrossings, zoom);
      this.lastLabelZoomBucket = zoomBucket;
    }
  }

  paint(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    resolution: number,
    toPx: (c: number[]) => [number, number],
    interacting: boolean,
  ): void {
    const streets = useStreetStore.getState().streets;
    const streetVisible = useStreetStore.getState().visible;
    if (!streetVisible || streets.length === 0) return;
    const fillets = this.cachedFillets;
    const outerFillets = this.cachedOuterFillets;

    for (let si = 0; si < streets.length; si++) {
      const s = streets[si];
      const allCoords: Array<[number, number]> = [s.start];
      if (s.waypoints) for (const wp of s.waypoints) allCoords.push(wp);
      allCoords.push(s.end);

      const allPx = allCoords.map((c) => toPx(c));
      const halfPx = (s.widthM / 2) / resolution;
      const sideWidthM = Math.max(0, s.sideWidthM ?? 0);
      const outerHalfPx = (s.widthM / 2 + sideWidthM) / resolution;

      const normals: Array<[number, number]> = [];
      for (let i = 0; i < allPx.length; i++) {
        const prev = allPx[Math.max(0, i - 1)];
        const next = allPx[Math.min(allPx.length - 1, i + 1)];
        const dx = next[0] - prev[0], dy = next[1] - prev[1];
        const len = Math.hypot(dx, dy);
        if (len < 0.1) normals.push(normals[i - 1] ?? [0, 1]);
        else normals.push([-dy / len, dx / len]);
      }

      if (sideWidthM > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(200, 200, 200, 0.55)';
        ctx.lineWidth = 1;
        for (const side of [1, -1]) {
          ctx.beginPath();
          for (let i = 0; i < allPx.length; i++) {
            const nx = normals[i][0] * outerHalfPx * side, ny = normals[i][1] * outerHalfPx * side;
            if (i === 0) ctx.moveTo(allPx[i][0] + nx, allPx[i][1] + ny);
            else ctx.lineTo(allPx[i][0] + nx, allPx[i][1] + ny);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      ctx.save();
      ctx.fillStyle = 'rgba(247, 129, 102, 0.08)';
      ctx.beginPath();
      for (let i = 0; i < allPx.length; i++) {
        const nx = normals[i][0] * halfPx, ny = normals[i][1] * halfPx;
        if (i === 0) ctx.moveTo(allPx[i][0] + nx, allPx[i][1] + ny);
        else ctx.lineTo(allPx[i][0] + nx, allPx[i][1] + ny);
      }
      for (let i = allPx.length - 1; i >= 0; i--) {
        const nx = normals[i][0] * halfPx, ny = normals[i][1] * halfPx;
        ctx.lineTo(allPx[i][0] - nx, allPx[i][1] - ny);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(247, 129, 102, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      for (const side of [1, -1]) {
        ctx.beginPath();
        for (let i = 0; i < allPx.length; i++) {
          const nx = normals[i][0] * halfPx * side, ny = normals[i][1] * halfPx * side;
          if (i === 0) ctx.moveTo(allPx[i][0] + nx, allPx[i][1] + ny);
          else ctx.lineTo(allPx[i][0] + nx, allPx[i][1] + ny);
        }
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(247, 129, 102, 0.75)';
      ctx.lineWidth = 1;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      for (let i = 0; i < allPx.length; i++) {
        if (i === 0) ctx.moveTo(allPx[i][0], allPx[i][1]);
        else ctx.lineTo(allPx[i][0], allPx[i][1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      if (!interacting && zoom > 12) {
        const slots = this.cachedStreetLabelSlots.get(s.id) ?? [];
        const fs1 = Math.max(9, Math.min(13, 10 * zoom / 18));
        const fs2 = Math.max(8, Math.min(11, 9 * zoom / 18));
        const labelText = `--- ${s.name} (Ancho de Vía ${s.widthM.toFixed(2)}m) ---`;
        for (const slot of slots) {
          const px = toPx(slot.pos);
          ctx.save();
          ctx.translate(px[0], px[1]);
          ctx.rotate(slot.angle);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `bold ${fs1}px Courier New`;
          ctx.fillStyle = 'rgba(247, 129, 102, 0.85)';
          ctx.fillText(labelText, 0, -fs1 * 0.8);
          ctx.font = `${fs2}px Courier New`;
          ctx.fillStyle = 'rgba(247, 129, 102, 0.55)';
          ctx.fillText('E   J   E    D   E     V   Í   A', 0, fs2 * 0.8);
          ctx.restore();
        }
      }
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(247, 129, 102, 0.65)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const fillet of fillets) {
      const arcPts = filletArcPoints(fillet, 16);
      if (arcPts.length < 2) continue;
      const firstPx = toPx(arcPts[0]);
      ctx.beginPath();
      ctx.moveTo(firstPx[0], firstPx[1]);
      for (let i = 1; i < arcPts.length; i++) {
        const px = toPx(arcPts[i]);
        ctx.lineTo(px[0], px[1]);
      }
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.55)';
    ctx.lineWidth = 1;
    for (const fillet of outerFillets) {
      const arcPts = filletArcPoints(fillet, 16);
      if (arcPts.length < 2) continue;
      const firstPx = toPx(arcPts[0]);
      ctx.beginPath();
      ctx.moveTo(firstPx[0], firstPx[1]);
      for (let i = 1; i < arcPts.length; i++) {
        const px = toPx(arcPts[i]);
        ctx.lineTo(px[0], px[1]);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}