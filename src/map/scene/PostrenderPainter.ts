import type Map from 'ol/Map.js';
import type VectorSource from 'ol/source/Vector.js';
import type VectorLayer from 'ol/layer/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import { useStreetStore, type Street } from '../../store/streetStore';
import { useSelectionStore } from '../../store/selectionStore';
import { computeStreetFilletsBoth, filletArcPoints, type StreetFillet } from '../../geo/streetEngine';
import { type Pt } from '../../geo/polygonEngine';
import { useRoundaboutStore } from '../../store/roundaboutStore';
import { roundaboutGeometry } from '../../geo/roundaboutEngine';
import type { RoundaboutDrawPreview } from './RoundaboutDrawInteraction';
import {
  drawSegmentLabels,
  drawMainMetricLabel,
  resolveDimensionOrientation,
  computeLotGroupCounts,
  getApproxScreenArea,
} from '../styleFactory';
import { formatMetricLength, formatMetricArea, type SegmentMetric } from '../../geo/metrics';
import { MZN_COLORS_STR } from './DrawLayerRenderer';
import type { SnapGuideVisual } from '../advancedSnap';
import { measureCached, measureCachedWidth } from '../textMeasureCache';

// Función para calcular el zoom a partir de la resolución
function getZoomFromResolution(resolution: number): number {
  return Math.log2(156543.03392804097 / resolution);
}

function streetsHash(streets: Street[]): string {
  return streets
    .map((s) => `${s.id}:${s.start[0]},${s.start[1]}-${s.end[0]},${s.end[1]}:${s.widthM}:${s.sideWidthM}`)
    .join('|');
}

type StreetChain = Array<{ from: Pt; to: Pt; len: number }>;

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

function segSegIntersection(
  a1: Pt, a2: Pt, b1: Pt, b2: Pt,
): Pt | null {
  const dax = a2[0] - a1[0], day = a2[1] - a1[1];
  const dbx = b2[0] - b1[0], dby = b2[1] - b1[1];
  const den = dax * dby - day * dbx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b1[0] - a1[0]) * dby - (b1[1] - a1[1]) * dbx) / den;
  const u = ((b1[0] - a1[0]) * day - (b1[1] - a1[1]) * dax) / den;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return [a1[0] + t * dax, a1[1] + t * day];
  }
  return null;
}

type CrossingsMap = globalThis.Map<string, Pt[]>;

function computeStreetCrossings(streets: Street[]): CrossingsMap {
  const map: CrossingsMap = new globalThis.Map();
  for (const s of streets) {
    map.set(s.id, []);
  }
  for (let i = 0; i < streets.length; i++) {
    const si = streets[i];
    const chainI = buildStreetChain([si.start, ...(si.waypoints ?? []), si.end]);
    for (let j = i + 1; j < streets.length; j++) {
      const sj = streets[j];
      const chainJ = buildStreetChain([sj.start, ...(sj.waypoints ?? []), sj.end]);
      for (const segI of chainI) {
        for (const segJ of chainJ) {
          const pt = segSegIntersection(segI.from, segI.to, segJ.from, segJ.to);
          if (pt) {
            map.get(si.id)!.push(pt);
            map.get(sj.id)!.push(pt);
          }
        }
      }
    }
  }
  return map;
}

type StreetLabelSlot = { pos: Pt; angle: number; len: number };

interface StreetLabelZone { lo: number; hi: number }

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

/** Reparte etiquetas en los tramos libres del eje, evitando cruces y puntas
 *  según el ancho real del texto (medido con ctx) — mismo criterio que
 *  drawStreetNameAlongPath de index_modelo.html. */
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

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

interface PlacedBox { x: number; y: number; w: number; h: number; }

function isColliding(
  ctx: CanvasRenderingContext2D,
  coord: [number, number],
  text: string,
  boxes: PlacedBox[],
  toPx: (c: number[]) => [number, number],
): boolean {
  const px = toPx(coord);
  const m = measureCached(ctx, text);
  const w = Math.abs(m.left) + Math.abs(m.right) + 12;
  const h = Math.abs(m.ascent) + Math.abs(m.descent) + 6;
  const bx = px[0] - w / 2;
  const by = px[1] - h / 2;
  for (const b of boxes) {
    if (bx < b.x + b.w && bx + w > b.x && by < b.y + b.h && by + h > b.y) return true;
  }
  boxes.push({ x: bx, y: by, w, h });
  return false;
}

function streetAllCoords(s: Street): Array<[number, number]> {
  const coords: Array<[number, number]> = [s.start];
  if (s.waypoints) coords.push(...s.waypoints);
  coords.push(s.end);
  return coords;
}

/**
 * Precalcula, por calle, dónde va cada repetición del nombre de vía. Es
 * lo más caro de pintar una calle (mide texto + evita cruces/puntas), así
 * que se cachea en updateCache() en vez de correr en cada frame dentro de
 * paintStreets() — ver diagnóstico H4.
 */
function computeAllStreetLabelSlots(
  ctx: CanvasRenderingContext2D,
  streets: Street[],
  crossingsMap: CrossingsMap,
  zoom: number,
): globalThis.Map<string, StreetLabelSlot[]> {
  const result = new globalThis.Map<string, StreetLabelSlot[]>();
  if (zoom <= 12) return result; // por debajo de este zoom no se pintan etiquetas de calle
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

export class PostrenderPainter {
  private cache = {
    lastZoom: -1,
    lastFeatureCount: -1,
    lastStreetHash: '',
    cachedFillets: [] as StreetFillet[],
    cachedOuterFillets: [] as StreetFillet[],
    cachedCrossings: new globalThis.Map<string, Pt[]>(),
    cachedStreetLabelSlots: new globalThis.Map<string, StreetLabelSlot[]>(),
    lastLabelZoomBucket: -1,
    lotGroupCounts: new globalThis.Map<string, number>(),
    dirty: true,
  };

  private readonly map: Map;
  private readonly drawSource: VectorSource;
  private readonly postrenderLayer: VectorLayer<VectorSource>;
  private readonly listener: (event: any) => void;

  /** true mientras hay un gesto de pan/zoom activo (movestart sin
   *  moveend) — ver diagnóstico H4 "modo barato durante interacción". */
  private interacting = false;

  constructor(opts: {
    map: Map;
    drawSource: VectorSource;
    postrenderLayer: VectorLayer<VectorSource>;
  }) {
    this.map = opts.map;
    this.drawSource = opts.drawSource;
    this.postrenderLayer = opts.postrenderLayer;

    // Marcar dirty cuando cambian features
    const onFeatureChange = () => { this.cache.dirty = true; };
    this.drawSource.on('addfeature', onFeatureChange);
    this.drawSource.on('removefeature', onFeatureChange);
    this.drawSource.on('change', onFeatureChange);

    this.listener = (event: any) => this.handle(event);
    this.postrenderLayer.on('postrender', this.listener);
  }

  /** Llamar para invalidar el cache cuando cambia el set de features. */
  invalidate(): void {
    this.cache.dirty = true;
  }

  /** Activa/desactiva el modo barato durante pan/zoom. Mientras está
   *  activo, se omite el pintado de etiquetas de texto (áreas,
   *  perímetros, cotas de segmento, nombres de calle); la geometría de
   *  lotes/manzanos sigue viéndose vía WebGL sin interrupción. */
  setInteracting(value: boolean): void {
    if (this.interacting === value) return;
    this.interacting = value;
    this.postrenderLayer.changed();
  }

  private handle(event: any): void {
    const ctx = event.context as CanvasRenderingContext2D | undefined;
    if (!ctx) return;

    const resolution = this.map.getView().getResolution() ?? 1;
    const zoom = getZoomFromResolution(resolution);
    const features = this.drawSource.getFeatures() ?? [];

    this.updateCache(ctx, features, zoom);

    const toPx = (coord: number[]): [number, number] => {
      const px = this.map.getPixelFromCoordinate(coord as [number, number]);
      return px ? [px[0], px[1]] : [0, 0];
    };

    if (!this.interacting) {
      this.paintFeatureLabels(ctx, features, zoom, resolution, toPx);
    }
    this.paintManualCotaz(ctx, features, zoom, resolution, toPx);
    this.paintStreets(ctx, zoom, resolution, toPx);
    this.paintRoundabouts(ctx, toPx);
    this.paintSnapGuides(ctx, resolution, toPx);
    this.paintLassoPreview(ctx, toPx);
  }

  private updateCache(ctx: CanvasRenderingContext2D, features: Array<Feature<Geometry>>, zoom: number): void {
    const currentFeatureCount = features.length;
    const streets = useStreetStore.getState().streets;
    const currentStreetHash = streetsHash(streets);
    const featuresChanged = currentFeatureCount !== this.cache.lastFeatureCount;
    const streetsChanged = currentStreetHash !== this.cache.lastStreetHash;
    // Bucket grueso de zoom: el margen de las etiquetas de calle depende
    // del tamaño de fuente (que depende del zoom), pero no vale la pena
    // recalcular sus posiciones en cada frame de un pan puro (zoom
    // constante) — ver diagnóstico H4.
    const zoomBucket = Math.round(zoom * 4);
    const zoomBucketChanged = zoomBucket !== this.cache.lastLabelZoomBucket;

    if (streetsChanged || this.cache.dirty) {
      // Antes: 2 llamadas a computeStreetFillets (outer:false / outer:true)
      // repitiendo el doble loop completo sobre pares de calles. Ahora:
      // una sola pasada — ver diagnóstico H4/H7.
      const { inner, outer } = computeStreetFilletsBoth(streets);
      this.cache.cachedFillets = inner;
      this.cache.cachedOuterFillets = outer;
      this.cache.cachedCrossings = computeStreetCrossings(streets);
      this.cache.lastStreetHash = currentStreetHash;
    }

    if (streetsChanged || this.cache.dirty || zoomBucketChanged) {
      this.cache.cachedStreetLabelSlots = computeAllStreetLabelSlots(
        ctx,
        streets,
        this.cache.cachedCrossings,
        zoom,
      );
      this.cache.lastLabelZoomBucket = zoomBucket;
    }

    if (featuresChanged || this.cache.dirty) {
      this.cache.lotGroupCounts = computeLotGroupCounts(features as Feature<Geometry>[]);
    }
    this.cache.lastFeatureCount = currentFeatureCount;
    this.cache.dirty = false;
  }

  private paintFeatureLabels(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    zoom: number,
    resolution: number,
    toPx: (c: number[]) => [number, number],
  ): void {
    const selectedIds = useSelectionStore.getState().selectedIds;
    const placedBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];

    for (let fi = 0; fi < features.length; fi++) {
      const feature = features[fi];
      const kind = feature.get('kind') as string | undefined;
      if (kind === 'cota') continue; // rendered by paintManualCotaz
      const geometry = feature.getGeometry();
      if (!geometry) continue;

      const isManzana = feature.get('type') === 'manzana';
      const colorIdx = feature.get('colorIdx') ?? 0;
      const featureId = feature.getId();
      const isSelected = featureId != null && selectedIds.has(featureId as string | number);
      const orientation = resolveDimensionOrientation(
        feature as Feature<Geometry>,
        this.cache.lotGroupCounts,
      );
      const labelPoint = feature.get('labelPoint') as [number, number] | undefined;

      if (geometry instanceof Polygon) {
        const coordinates = geometry.getCoordinates()[0] ?? [];
        if (coordinates.length < 3) continue;
        const showMainLabel =
          isSelected || zoom > 15.5 || getApproxScreenArea(geometry, resolution) >= 4200;
        if (showMainLabel && labelPoint) {
          const areaM2 = feature.get('areaM2') as number | undefined;
          if (areaM2 !== undefined) {
            const text = isManzana
              ? `Mzo. ${colorIdx + 1}`
              : formatMetricArea(areaM2);
            if (!isColliding(ctx, labelPoint, text, placedBoxes, toPx)) {
              if (isManzana) {
                const mznColor = MZN_COLORS_STR[colorIdx % MZN_COLORS_STR.length];
                drawMainMetricLabel(ctx, labelPoint, toPx, text, true, {
                  extraLine: formatMetricArea(areaM2),
                  color: mznColor,
                });
              } else {
                drawMainMetricLabel(ctx, labelPoint, toPx, text, false);
              }
            }
          }
        }
        drawSegmentLabels(
          ctx,
          coordinates,
          feature.get('segmentLengths') as SegmentMetric[] | undefined,
          labelPoint,
          orientation,
          toPx,
          isManzana,
        );
      } else if (geometry instanceof LineString) {
        const coordinates = geometry.getCoordinates() ?? [];
        if (coordinates.length < 2) continue;
        const showMainLabel = isSelected || zoom > 15.5;
        if (showMainLabel && labelPoint) {
          const lengthM = feature.get('lengthM') as number | undefined;
          if (lengthM !== undefined) {
            const text = formatMetricLength(lengthM);
            if (!isColliding(ctx, labelPoint, text, placedBoxes, toPx)) {
              drawMainMetricLabel(ctx, labelPoint, toPx, text, false);
            }
          }
        }
        drawSegmentLabels(
          ctx,
          coordinates,
          feature.get('segmentLengths') as SegmentMetric[] | undefined,
          labelPoint,
          orientation,
          toPx,
          false,
        );
      }
    }
  }

  private paintManualCotaz(
    ctx: CanvasRenderingContext2D,
    features: Array<Feature<Geometry>>,
    zoom: number,
    _resolution: number,
    toPx: (c: number[]) => [number, number],
  ): void {
    if (zoom < 12) return;
    const selectedIds = useSelectionStore.getState().selectedIds;

    for (let fi = 0; fi < features.length; fi++) {
      const feature = features[fi];
      if (feature.get('kind') !== 'cota') continue;
      const geom = feature.getGeometry();
      if (!(geom instanceof LineString)) continue;

      const originStart = feature.get('originStart') as [number, number] | undefined;
      const originEnd = feature.get('originEnd') as [number, number] | undefined;
      const value = feature.get('value') as number | undefined;
      if (!originStart || !originEnd || value == null) continue;

      const featureId = feature.getId();
      const isSelected = featureId != null && selectedIds.has(featureId as string | number);

      const dimCoords = geom.getCoordinates();
      if (dimCoords.length < 2) continue;
      const dimStart = dimCoords[0] as [number, number];
      const dimEnd = dimCoords[dimCoords.length - 1] as [number, number];

      const dsPx = toPx(dimStart);
      const dePx = toPx(dimEnd);
      const osPx = toPx(originStart);
      const oePx = toPx(originEnd);

      // Extension lines (dashed, from origins to dimension line)
      ctx.save();
      ctx.strokeStyle = isSelected ? 'rgba(0, 200, 255, 0.85)' : 'rgba(0, 180, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(osPx[0], osPx[1]);
      ctx.lineTo(dsPx[0], dsPx[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(oePx[0], oePx[1]);
      ctx.lineTo(dePx[0], dePx[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Dimension line
      ctx.save();
      ctx.strokeStyle = isSelected ? 'rgba(0, 200, 255, 0.95)' : 'rgba(0, 180, 255, 0.75)';
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.moveTo(dsPx[0], dsPx[1]);
      ctx.lineTo(dePx[0], dePx[1]);
      ctx.stroke();
      ctx.restore();

      // Ticks (45-degree marks at each end)
      const tdx = dePx[0] - dsPx[0], tdy = dePx[1] - dsPx[1];
      const tlen = Math.hypot(tdx, tdy);
      if (tlen > 1) {
        const tux = tdx / tlen, tuy = tdy / tlen;
        const tickSize = 6;
        ctx.save();
        ctx.strokeStyle = isSelected ? 'rgba(0, 200, 255, 0.95)' : 'rgba(0, 180, 255, 0.75)';
        ctx.lineWidth = 1.5;
        // Tick at start
        ctx.beginPath();
        ctx.moveTo(dsPx[0] + (tux - tuy) * tickSize, dsPx[1] + (tuy + tux) * tickSize);
        ctx.lineTo(dsPx[0] - (tux - tuy) * tickSize, dsPx[1] - (tuy + tux) * tickSize);
        ctx.stroke();
        // Tick at end
        ctx.beginPath();
        ctx.moveTo(dePx[0] - (tux + tuy) * tickSize, dePx[1] - (tuy - tux) * tickSize);
        ctx.lineTo(dePx[0] + (tux + tuy) * tickSize, dePx[1] + (tuy - tux) * tickSize);
        ctx.stroke();
        ctx.restore();
      }

      // Value text centered above the dimension line
      if (zoom > 13) {
        const midPx: [number, number] = [(dsPx[0] + dePx[0]) / 2, (dsPx[1] + dePx[1]) / 2];
        let ang = Math.atan2(tdy, tdx);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        const fs = Math.max(9, Math.min(13, 10 * zoom / 18));
        const text = formatMetricLength(value);
        ctx.save();
        ctx.translate(midPx[0], midPx[1]);
        ctx.rotate(ang);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = `bold ${fs}px Courier New`;
        const tw = measureCachedWidth(ctx, text);
        ctx.fillStyle = 'rgba(13, 17, 23, 0.72)';
        ctx.fillRect(-tw / 2 - 4, -fs - 4, tw + 8, fs + 6);
        ctx.fillStyle = isSelected ? '#00ccff' : '#00b4ff';
        ctx.fillText(text, 0, -4);
        ctx.restore();
      }
    }
  }

  private paintStreets(
    ctx: CanvasRenderingContext2D,
    zoom: number,
    resolution: number,
    toPx: (c: number[]) => [number, number],
  ): void {
    const streets = useStreetStore.getState().streets;
    const streetVisible = useStreetStore.getState().visible;
    if (!streetVisible || streets.length === 0) return;
    const fillets = this.cache.cachedFillets;
    const outerFillets = this.cache.cachedOuterFillets;

    for (let si = 0; si < streets.length; si++) {
      const s = streets[si];
      const allCoords: Array<[number, number]> = [s.start];
      if (s.waypoints) {
        for (const wp of s.waypoints) allCoords.push(wp);
      }
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
        if (len < 0.1) {
          normals.push(normals[i - 1] ?? [0, 1]);
        } else {
          normals.push([-dy / len, dx / len]);
        }
      }

      // ── Vereda (borde exterior: calzada + ancho de acera) ──
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

      // ── Cuerpo de calzada ──
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

      // ── Bordes sólidos (cordón de calzada) ──
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

      // ── Eje central punteado ──
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

      // Etiqueta de calle — posiciones ya precomputadas en updateCache()
      // (dirty solo si cambian las calles o el bucket de zoom, ver H4).
      if (!this.interacting && zoom > 12) {
        const slots = this.cache.cachedStreetLabelSlots.get(s.id) ?? [];
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

    // Fillets de calzada (cordón, radio = tabla + vereda)
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

    // Fillets de vereda (borde exterior, radio = tabla pura)
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

  private paintSnapGuides(
    ctx: CanvasRenderingContext2D,
    resolution: number,
    _toPx: (c: number[]) => [number, number],
  ): void {
    // El guide lo inyecta el SnapEngine vía paintSnapGuide().
    if (!this.currentGuide) return;
    this.paintGuide(ctx, this.currentGuide, resolution);
  }

  /* ─── Roundabout preview + committed roundabouts ─── */
private currentRoundaboutPreview: RoundaboutDrawPreview | null = null;

setRoundaboutPreview(preview: RoundaboutDrawPreview | null): void {
  this.currentRoundaboutPreview = preview;
  this.postrenderLayer.changed();
}

private paintRoundabouts(
  ctx: CanvasRenderingContext2D,
  toPx: (c: number[]) => [number, number],
): void {
  const { roundabouts, visible } = useRoundaboutStore.getState();
  if (visible) {
    for (const rb of roundabouts) {
      const geom = roundaboutGeometry(rb);
      this.fillRing(ctx, geom.roadOuter, toPx, 'rgba(247, 129, 102, 0.10)');
      this.strokeRing(ctx, geom.sideOuter, toPx, 'rgba(247, 129, 102, 0.55)', 1.5);
      this.strokeRing(ctx, geom.roadOuter, toPx, 'rgba(247, 129, 102, 0.75)', 2);
      if (geom.island) {
        this.fillRing(ctx, geom.island, toPx, 'rgba(63, 185, 80, 0.18)');
        this.strokeRing(ctx, geom.island, toPx, 'rgba(63, 185, 80, 0.6)', 1.25);
      }
      ctx.save();
      ctx.setLineDash([6, 5]);
      this.strokeRing(ctx, geom.centerAxis, toPx, 'rgba(247, 129, 102, 0.45)', 1);
      ctx.restore();
      const [lx, ly] = toPx(rb.center);
      ctx.save();
      ctx.font = 'bold 11px Courier New';
      ctx.fillStyle = 'rgba(247, 129, 102, 0.9)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${rb.name} · R${rb.radiusM.toFixed(1)}m`, lx, ly);
      ctx.restore();
    }
  }
  if (this.currentRoundaboutPreview) {
    const { center, current } = this.currentRoundaboutPreview;
    const radius = Math.hypot(current[0] - center[0], current[1] - center[1]);
    if (radius > 0.1) {
      const defaults = useRoundaboutStore.getState();
      const previewGeom = roundaboutGeometry({
        center: center as [number, number],
        radiusM: radius,
        sides: defaults.defaultSides,
        rotation: 0,
        roadWidthM: defaults.defaultRoadWidthM,
        sidewalkWidthM: defaults.defaultSidewalkWidthM,
      });
      ctx.save();
      ctx.setLineDash([6, 4]);
      this.strokeRing(ctx, previewGeom.sideOuter, toPx, 'rgba(0, 212, 255, 0.85)', 1.5);
      ctx.restore();
    }
    const centerPx = toPx(center);
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerPx[0], centerPx[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = '#0e9f6e';
    ctx.fill();
    ctx.restore();
  }
}

private strokeRing(
  ctx: CanvasRenderingContext2D,
  ring: Array<[number, number]>,
  toPx: (c: number[]) => [number, number],
  color: string,
  width: number,
): void {
  if (ring.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  const first = toPx(ring[0]);
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < ring.length; i++) {
    const p = toPx(ring[i]);
    ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

private fillRing(
  ctx: CanvasRenderingContext2D,
  ring: Array<[number, number]>,
  toPx: (c: number[]) => [number, number],
  color: string,
): void {
  if (ring.length < 3) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  const first = toPx(ring[0]);
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < ring.length; i++) {
    const p = toPx(ring[i]);
    ctx.lineTo(p[0], p[1]);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ─── Lasso / Rect selection preview (Fase 4) ─── */
private currentLassoPreview: import('./LassoSelection').LassoPreview = null;

setLassoPreview(preview: import('./LassoSelection').LassoPreview): void {
  this.currentLassoPreview = preview;
  this.postrenderLayer.changed();
}

private paintLassoPreview(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number],
  ): void {
    const preview = this.currentLassoPreview;
    if (!preview) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(0, 212, 255, 0.95)';
    ctx.fillStyle = 'rgba(0, 212, 255, 0.10)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);

    if (preview.mode === 'rect') {
      const a = toPx(preview.start);
      const b = toPx(preview.current);
      const x = Math.min(a[0], b[0]);
      const y = Math.min(a[1], b[1]);
      const w = Math.abs(b[0] - a[0]);
      const h = Math.abs(b[1] - a[1]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    } else if (preview.mode === 'lasso') {
      const pts = preview.points;
      if (pts.length > 0) {
        ctx.beginPath();
        const first = toPx(pts[0]);
        ctx.moveTo(first[0], first[1]);
        for (let i = 1; i < pts.length; i++) {
          const p = toPx(pts[i]);
          ctx.lineTo(p[0], p[1]);
        }
        // Cerramos visualmente con la posición actual del cursor
        if (preview.current) {
          const cur = toPx(preview.current);
          ctx.lineTo(cur[0], cur[1]);
        } else {
          ctx.lineTo(first[0], first[1]);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  private currentGuide: SnapGuideVisual | null = null;

  /** Llamado por el snap engine cuando cambia la guía. */
  setSnapGuide(guide: SnapGuideVisual | null): void {
    this.currentGuide = guide;
    this.postrenderLayer.changed();
  }

  private paintGuide(
    ctx: CanvasRenderingContext2D,
    guide: SnapGuideVisual,
    resolution: number,
  ): void {
    if (guide.highlightSegment) {
      const [ga, gb] = guide.highlightSegment;
      const gaPx = this.map.getPixelFromCoordinate(ga);
      const gbPx = this.map.getPixelFromCoordinate(gb);
      if (gaPx && gbPx) {
        ctx.save();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(gaPx[0], gaPx[1]);
        ctx.lineTo(gbPx[0], gbPx[1]);
        ctx.stroke();
        ctx.restore();
      }
    }
    if (guide.dashedLine) {
      const [da, db] = guide.dashedLine;
      const daPx = this.map.getPixelFromCoordinate(da);
      const dbPx = this.map.getPixelFromCoordinate(db);
      if (daPx && dbPx) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.85)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(daPx[0], daPx[1]);
        ctx.lineTo(dbPx[0], dbPx[1]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
    if (guide.rightAngleSquare) {
      const { point, size } = guide.rightAngleSquare;
      const centerPx = this.map.getPixelFromCoordinate(point);
      if (centerPx) {
        const sizePx = Math.max(6, size / resolution);
        ctx.save();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(centerPx[0] - sizePx / 2, centerPx[1] - sizePx / 2, sizePx, sizePx);
        ctx.restore();
      }
    }
    if (guide.distanceLabel) {
      const { point, text } = guide.distanceLabel;
      const px = this.map.getPixelFromCoordinate(point);
      if (px) {
        ctx.save();
        ctx.font = '10px Courier New';
        ctx.fillStyle = 'rgba(0, 212, 255, 0.9)';
        ctx.textAlign = 'center';
        ctx.fillText(text, px[0], px[1] - 6);
        ctx.restore();
      }
    }
  }

  dispose(): void {
    this.postrenderLayer.un('postrender', this.listener);
  }
}