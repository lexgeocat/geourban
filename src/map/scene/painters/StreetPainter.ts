import { useStreetStore, type Street } from '../../../store/entities/streetStore';
import { useRoadCornerStore } from '../../../store/map/roadCornerStore';
import { computeRoadNetworkNet, type RoadNetworkNet } from '../../../geo/roads/roadNetworkNet';
import { type Pt } from '../../../geo/math/polygonEngine';
import { type CornerMode } from '../../../geo/roads/ringFillet';
import { measureCachedWidth } from '../../textMeasureCache';

type StreetChain = Array<{ from: Pt; to: Pt; len: number }>;
type CrossingsMap = globalThis.Map<string, Pt[]>;
/** El ángulo de rotación de la etiqueta YA NO se guarda acá (ver nota en
 *  sampleChainAt): se recalcula en paint(), en espacio de pantalla. */
type StreetLabelSlot = { pos: Pt; segFrom: Pt; segTo: Pt };

interface StreetLabelZone { lo: number; hi: number }

function streetsHash(streets: Street[]): string {
  return streets
    .map((s) => `${s.id}:${s.start[0]},${s.start[1]}-${s.end[0]},${s.end[1]}:${s.widthM}:${s.sideWidthM}:${(s.waypoints ?? []).map((w) => `${w[0]},${w[1]}`).join(';')}`)
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

/**
 * Muestrea el punto (mundo) a una distancia de arco dada + el segmento al
 * que pertenece. El ÁNGULO de rotación de la etiqueta se calcula en
 * paint(), a partir de `toPx(segFrom)`/`toPx(segTo)` — NO acá con las
 * coordenadas de mundo: mundo (EPSG:3857, Y arriba) y pantalla (Y abajo)
 * difieren en la orientación del eje Y, así que un ángulo calculado en
 * mundo y aplicado directo a ctx.rotate() (espacio de pantalla) sale
 * girado/espejado salvo en tramos perfectamente horizontales — la causa
 * de "las etiquetas no se ajustan al ángulo del eje".
 */
function sampleChainAt(chain: StreetChain, dist: number): { pos: Pt; segFrom: Pt; segTo: Pt } | null {
  let walk = 0;
  for (const seg of chain) {
    const isLast = seg === chain[chain.length - 1];
    if (dist <= walk + seg.len || isLast) {
      const t = seg.len > 1e-6 ? Math.max(0, Math.min(1, (dist - walk) / seg.len)) : 0;
      const pos: Pt = [seg.from[0] + t * (seg.to[0] - seg.from[0]), seg.from[1] + t * (seg.to[1] - seg.from[1])];
      return { pos, segFrom: seg.from, segTo: seg.to };
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
  resolution: number,
  repeatM = 140,
): StreetLabelSlot[] {
  const chain = buildStreetChain(coords);
  const totalLen = chain.reduce((s, c) => s + c.len, 0);
  if (totalLen < 1) return [];

  ctx.save();
  ctx.font = `bold ${fontPx}px Courier New`;
  // measureCachedWidth da PÍXELES de pantalla; roadHalfWidthM/marginM están
  // en metros de mundo — sin este *resolution, el margen quedaba mal
  // escalado según el zoom (a veces tapaba la calle entera y no dejaba
  // ningún hueco libre para el rótulo: "las etiquetas no se visualizan").
  const textHalfW = (measureCachedWidth(ctx, labelText) / 2 + 4) * resolution;
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
      if (sample) slots.push({ pos: sample.pos, segFrom: sample.segFrom, segTo: sample.segTo });
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
  resolution: number,
): globalThis.Map<string, StreetLabelSlot[]> {
  const result = new globalThis.Map<string, StreetLabelSlot[]>();
  if (zoom <= 12) return result;
  for (const s of streets) {
    const crossings = crossingsMap.get(s.id) ?? [];
    const fs1 = Math.max(9, Math.min(13, (10 * zoom) / 18));
    const labelText = `--- ${s.name} (Ancho de Vía ${s.widthM.toFixed(2)}m) ---`;
    const roadHalfWidthM = s.widthM / 2 + Math.max(0, s.sideWidthM ?? 0);
    const slots = pickStreetLabelSlots(ctx, streetAllCoords(s), crossings, labelText, fs1, roadHalfWidthM, resolution, 140);
    result.set(s.id, slots);
  }
  return result;
}

/** Pinta calzada/vereda (unidas + ochavadas, ver roadNetworkNet.ts),
 *  eje y labels de la red vial. Reemplaza el fillet calle-por-calle +
 *  cachés incrementales por par (frágil: ochaves invertidos en cruces no
 *  perpendiculares, y riesgo de geometría fantasma si la poda de esas
 *  cachés se desincroniza) por una reconstrucción completa desde el
 *  estado actual de `streets` cada vez que cambia el fingerprint. */
export class StreetPainter {
  private cachedNet: RoadNetworkNet = { road: [], outer: [] };
  private cachedCrossings: CrossingsMap = new globalThis.Map();
  private cachedStreetLabelSlots = new globalThis.Map<string, StreetLabelSlot[]>();
  private lastStreetHash = '';
  private lastCornerMode: CornerMode = 'fillet';
  private lastLabelZoomBucket = -1;
  private pairCrossingCache = new globalThis.Map<string, { points: Pt[]; hashA: string; hashB: string }>();

  private streetPairHash(s: Street): string {
    return `${s.start[0]},${s.start[1]}|${s.end[0]},${s.end[1]}|${s.widthM}|${s.sideWidthM}|${(s.waypoints ?? []).map((w) => `${w[0]},${w[1]}`).join(';')}`;
  }

  private updateCrossingsCache(streets: Street[]): void {
    const currentIds = new Set(streets.map((s) => s.id));
    for (const key of this.pairCrossingCache.keys()) {
      const [idA, idB] = key.split('::');
      if (!currentIds.has(idA) || !currentIds.has(idB)) this.pairCrossingCache.delete(key);
    }
    const hashes = new globalThis.Map<string, string>();
    for (const s of streets) hashes.set(s.id, this.streetPairHash(s));

    const crossings: CrossingsMap = new globalThis.Map();
    for (const s of streets) crossings.set(s.id, []);

    for (let i = 0; i < streets.length; i++) {
      for (let j = i + 1; j < streets.length; j++) {
        const sA = streets[i], sB = streets[j];
        const key = sA.id < sB.id ? `${sA.id}::${sB.id}` : `${sB.id}::${sA.id}`;
        const hA = hashes.get(sA.id)!, hB = hashes.get(sB.id)!;
        let entry = this.pairCrossingCache.get(key);
        if (!entry || entry.hashA !== hA || entry.hashB !== hB) {
          entry = { points: computeStreetPairCrossings(sA, sB), hashA: hA, hashB: hB };
          this.pairCrossingCache.set(key, entry);
        }
        if (entry.points.length > 0) {
          crossings.get(sA.id)!.push(...entry.points);
          crossings.get(sB.id)!.push(...entry.points);
        }
      }
    }
    this.cachedCrossings = crossings;
  }

  /** `forceDirty`: invalidación externa (drawSource cambió). `resolution`
   *  hace falta acá para convertir el ancho de texto (px) a metros al
   *  calcular los huecos libres de etiqueta. */
  update(ctx: CanvasRenderingContext2D, zoom: number, forceDirty: boolean, resolution: number): void {
    const streets = useStreetStore.getState().streets;
    const currentHash = streetsHash(streets);
    const cornerMode = useRoadCornerStore.getState().mode;
    const streetsChanged = currentHash !== this.lastStreetHash;
    const cornerModeChanged = cornerMode !== this.lastCornerMode;
    const zoomBucket = Math.round(zoom * 4);
    const zoomBucketChanged = zoomBucket !== this.lastLabelZoomBucket;

    if (streetsChanged || cornerModeChanged || forceDirty) {
      this.cachedNet = computeRoadNetworkNet(streets);
      this.updateCrossingsCache(streets);
      this.lastStreetHash = currentHash;
      this.lastCornerMode = cornerMode;
    }
    if (streetsChanged || forceDirty || zoomBucketChanged) {
      this.cachedStreetLabelSlots = computeAllStreetLabelSlots(ctx, streets, this.cachedCrossings, zoom, resolution);
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

    this.paintRings(ctx, this.cachedNet.outer, toPx, { fill: null, stroke: 'rgba(200, 200, 200, 0.55)', lineWidth: 1 });
    this.paintRings(ctx, this.cachedNet.road, toPx, { fill: 'rgba(247, 129, 102, 0.08)', stroke: 'rgba(247, 129, 102, 0.75)', lineWidth: 1.5 });

    // Eje central (línea discontinua) — una polilínea por calle, ajena a
    // la unión de calzada/vereda.
    ctx.save();
    ctx.strokeStyle = 'rgba(247, 129, 102, 0.75)';
    ctx.lineWidth = 1;
    ctx.setLineDash([7, 5]);
    for (const s of streets) {
      const coords = streetAllCoords(s);
      ctx.beginPath();
      coords.forEach((c, i) => {
        const p = toPx(c);
        if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    if (!interacting && zoom > 12) {
      const fs1 = Math.max(9, Math.min(13, (10 * zoom) / 18));
      const fs2 = Math.max(8, Math.min(11, (9 * zoom) / 18));
      for (const s of streets) {
        const slots = this.cachedStreetLabelSlots.get(s.id) ?? [];
        const labelText = `--- ${s.name} (Ancho de Vía ${s.widthM.toFixed(2)}m) ---`;
        for (const slot of slots) {
          const px = toPx(slot.pos);
          // Ángulo en espacio de PANTALLA — ver nota en sampleChainAt.
          const a = toPx(slot.segFrom), b = toPx(slot.segTo);
          let angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
          if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
          ctx.save();
          ctx.translate(px[0], px[1]);
          ctx.rotate(angle);
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
  }

  private paintRings(
    ctx: CanvasRenderingContext2D,
    polygons: Pt[][][],
    toPx: (c: number[]) => [number, number],
    style: { fill: string | null; stroke: string; lineWidth: number },
  ): void {
    if (polygons.length === 0) return;
    ctx.save();
    ctx.lineWidth = style.lineWidth;
    ctx.strokeStyle = style.stroke;

    for (const rings of polygons) {
      if (rings.length === 0) continue;

      // Relleno: TODOS los anillos del polígono (exterior + holes) van en
      // un solo path como subpaths, y se rellena con 'evenodd'. Esto es lo
      // que faltaba: antes cada anillo se rellenaba por separado como si
      // fuera un polígono sólido independiente, así que un hueco (p.ej. la
      // manzana central en un cruce en "#") se pintaba como si fuera vía.
      if (style.fill) {
        ctx.beginPath();
        for (const ring of rings) {
          if (ring.length < 3) continue;
          const first = toPx(ring[0]);
          ctx.moveTo(first[0], first[1]);
          for (let i = 1; i < ring.length; i++) {
            const p = toPx(ring[i]);
            ctx.lineTo(p[0], p[1]);
          }
          ctx.closePath();
        }
        ctx.fillStyle = style.fill;
        ctx.fill('evenodd');
      }

      // Contorno: cada anillo (exterior y huecos) se traza aparte, para
      // que el borde del hueco también se dibuje.
      for (const ring of rings) {
        if (ring.length < 3) continue;
        ctx.beginPath();
        const first = toPx(ring[0]);
        ctx.moveTo(first[0], first[1]);
        for (let i = 1; i < ring.length; i++) {
          const p = toPx(ring[i]);
          ctx.lineTo(p[0], p[1]);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}