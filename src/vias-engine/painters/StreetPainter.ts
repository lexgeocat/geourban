import { useStreetStore, type Street } from '../store/streetStore';
import { useRoundaboutStore, type Roundabout } from '../store/roundaboutStore';
import { useRoadCornerStore } from '../store/roadCornerStore';
import { type CornerMode } from '../geometry/ringFillet';
import type { RoadNetworkNet } from '../geometry/types';
import { computeRoadNetworkNetInWorker } from '@kernel/native/geoWorkerClient';
import { type Pt } from '@kernel/geometry/polygonEngine';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { withAlpha } from '@map-core/scene/DrawLayerRenderer';
import { strokePolyline, traceRing } from '@map-core/scene/canvasPathUtils';
import type { Layer } from '@kernel/domain-model/featureModel';
import { roundaboutGeometry } from '../geometry/roundaboutEngine';
import { getLayerByIdCached, resolveEntityLayer, resolveRoundaboutLayer } from '@layers-engine/selectors/layersPainterHelpers';

const FALLBACK_STREET_COLOR = '#f78166';
const NO_LAYER_KEY = '__geourban_street_no_layer__';
const NET_RECOMPUTE_DEBOUNCE_MS = 200;

function streetsHash(streets: Street[]): string {
  return streets
    .map(
      (s) =>
        `${s.id}:${s.start[0]},${s.start[1]}-${s.end[0]},${s.end[1]}:${s.widthM}:${s.sideWidthM}:${(s.waypoints ?? []).map((w) => `${w[0]},${w[1]}`).join(';')}`
    )
    .join('|');
}

function roundaboutsHash(roundabouts: Roundabout[]): string {
  return roundabouts
    .map(
      (r) =>
        `${r.id}:${r.center[0]},${r.center[1]}:${r.radiusM}:${r.sides}:${r.rotation}:${r.roadWidthM}:${r.sidewalkWidthM}`
    )
    .join('|');
}

function clipSegmentOutsideCircle(a: Pt, b: Pt, center: Pt, radius: number): Array<[Pt, Pt]> {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const fx = a[0] - center[0],
    fy = a[1] - center[1];
  const A = dx * dx + dy * dy;
  if (A < 1e-12) {
    const d2 = fx * fx + fy * fy;
    return d2 > radius * radius ? [[a, b]] : [];
  }
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const disc = B * B - 4 * A * C;
  const pointAt = (t: number): Pt => [a[0] + dx * t, a[1] + dy * t];

  if (disc <= 0) return C > 0 ? [[a, b]] : [];

  const sqrtDisc = Math.sqrt(disc);
  const t1 = (-B - sqrtDisc) / (2 * A);
  const t2 = (-B + sqrtDisc) / (2 * A);

  if (t1 >= 1 || t2 <= 0) return [[a, b]];
  if (t1 <= 0 && t2 >= 1) return [];

  const segs: Array<[Pt, Pt]> = [];
  if (t1 > 0) segs.push([a, pointAt(t1)]);
  if (t2 < 1) segs.push([pointAt(t2), b]);
  return segs;
}

function streetAllCoords(s: Street): Array<[number, number]> {
  const coords: Array<[number, number]> = [s.start];
  if (s.waypoints) coords.push(...s.waypoints);
  coords.push(s.end);
  return coords;
}

function clipStreetAxisSegments(
  coords: Array<[number, number]>,
  roundabouts: Roundabout[]
): Array<[Pt, Pt]> {
  let segs: Array<[Pt, Pt]> = [];
  for (let i = 0; i < coords.length - 1; i++) segs.push([coords[i] as Pt, coords[i + 1] as Pt]);
  if (roundabouts.length === 0) return segs;

  for (const rb of roundabouts) {
    const outer = roundaboutGeometry(rb).sideOuter;
    let r = rb.radiusM;
    for (const p of outer) {
      const d = Math.hypot(p[0] - rb.center[0], p[1] - rb.center[1]);
      if (d > r) r = d;
    }
    const next: Array<[Pt, Pt]> = [];
    for (const [a, b] of segs) next.push(...clipSegmentOutsideCircle(a, b, rb.center as Pt, r));
    segs = next;
  }
  return segs;
}

function resolveStreetLayer(
  street: Street,
  registry: ReturnType<typeof useLayersStore.getState>,
  byId: globalThis.Map<string, Layer>
): Layer | undefined {
  return resolveEntityLayer(street, 'calle', registry, byId);
}

interface StreetLayerGroup {
  layerId: string;
  layer: Layer | undefined;
  streets: Street[];
  roundabouts: Roundabout[];
}

const NETWORK_CONNECT_MARGIN_M = 1;

function streetFootprintExtent(s: Street): [number, number, number, number] {
  const half = s.widthM / 2 + Math.max(0, s.sideWidthM ?? 0);
  const coords = streetAllCoords(s);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX - half, minY - half, maxX + half, maxY + half];
}

function roundaboutFootprintExtent(rb: Roundabout): [number, number, number, number] {
  const r = rb.radiusM + rb.roadWidthM / 2 + Math.max(0, rb.sidewalkWidthM);
  return [rb.center[0] - r, rb.center[1] - r, rb.center[0] + r, rb.center[1] + r];
}

function extentsOverlap(
  a: [number, number, number, number],
  b: [number, number, number, number],
  margin: number
): boolean {
  return !(
    a[2] + margin < b[0] ||
    b[2] + margin < a[0] ||
    a[3] + margin < b[1] ||
    b[3] + margin < a[1]
  );
}

function findTouchingStreetGroupKey(
  rb: Roundabout,
  groups: globalThis.Map<string, StreetLayerGroup>
): string | null {
  const rbExtent = roundaboutFootprintExtent(rb);
  for (const [key, group] of groups) {
    for (const s of group.streets) {
      if (extentsOverlap(rbExtent, streetFootprintExtent(s), NETWORK_CONNECT_MARGIN_M)) return key;
    }
  }
  return null;
}

function groupStreetsByLayer(streets: Street[], roundabouts: Roundabout[]): StreetLayerGroup[] {
  const registry = useLayersStore.getState();
  const layers = registry.layers;
  const byId = getLayerByIdCached(layers);
  const groups = new globalThis.Map<string, StreetLayerGroup>();

  const getOrCreate = (key: string, layer: Layer | undefined): StreetLayerGroup => {
    let g = groups.get(key);
    if (!g) {
      g = { layerId: key, layer, streets: [], roundabouts: [] };
      groups.set(key, g);
    }
    return g;
  };

  for (const s of streets) {
    const layer = resolveStreetLayer(s, registry, byId);
    getOrCreate(layer?.id ?? NO_LAYER_KEY, layer).streets.push(s);
  }

  for (const rb of roundabouts) {
    const touchedKey = findTouchingStreetGroupKey(rb, groups);
    if (touchedKey) {
      groups.get(touchedKey)!.roundabouts.push(rb);
      continue;
    }
    const layer = resolveRoundaboutLayer(rb, registry, byId);
    getOrCreate(layer?.id ?? NO_LAYER_KEY, layer).roundabouts.push(rb);
  }

  return Array.from(groups.values());
}

interface StreetGroupCache {
  net: RoadNetworkNet;
  netHash: string;
  netCornerMode: CornerMode;
}

export class StreetPainter {
  private currentGroups: StreetLayerGroup[] = [];
  private groupCaches = new globalThis.Map<string, StreetGroupCache>();
  private readonly requestRender: () => void;
  private unsubscribeStreets: (() => void) | null = null;
  private unsubscribeRoundabouts: (() => void) | null = null;
  private unsubscribeCorner: (() => void) | null = null;
  private netDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private netRecomputeGeneration = 0;

  constructor(requestRender: () => void = () => {}) {
    this.requestRender = requestRender;

    this.unsubscribeStreets = useStreetStore.subscribe((state, prev) => {
      if (state.streets !== prev.streets) this.scheduleNetRecomputeAll();
    });
    this.unsubscribeRoundabouts = useRoundaboutStore.subscribe((state, prev) => {
      if (state.roundabouts !== prev.roundabouts) this.scheduleNetRecomputeAll();
    });
    this.unsubscribeCorner = useRoadCornerStore.subscribe(() => this.scheduleNetRecomputeAll());
    this.scheduleNetRecomputeAll();
  }

  dispose(): void {
    this.unsubscribeStreets?.();
    this.unsubscribeStreets = null;
    this.unsubscribeRoundabouts?.();
    this.unsubscribeRoundabouts = null;
    this.unsubscribeCorner?.();
    this.unsubscribeCorner = null;
    if (this.netDebounceTimer) {
      clearTimeout(this.netDebounceTimer);
      this.netDebounceTimer = null;
    }
  }

  private scheduleNetRecomputeAll(): void {
    if (this.netDebounceTimer) clearTimeout(this.netDebounceTimer);
    this.netDebounceTimer = setTimeout(() => {
      this.netDebounceTimer = null;
      void this.recomputeAllNets();
    }, NET_RECOMPUTE_DEBOUNCE_MS);
  }

  private groupHash(group: StreetLayerGroup): string {
    return `${streetsHash(group.streets)}::${roundaboutsHash(group.roundabouts)}`;
  }

  private async recomputeAllNets(): Promise<void> {
    const streets = useStreetStore.getState().streets;
    const roundabouts = useRoundaboutStore.getState().roundabouts;
    const cornerMode = useRoadCornerStore.getState().mode;
    const groups = groupStreetsByLayer(streets, roundabouts);
    const generation = ++this.netRecomputeGeneration;

    const results = await Promise.all(
      groups.map(async (group) => {
        try {
          const net = await computeRoadNetworkNetInWorker(
            group.streets,
            group.roundabouts,
            cornerMode
          );
          return { layerId: group.layerId, net, hash: this.groupHash(group), cornerMode };
        } catch (err) {
          console.error(
            `StreetPainter: no se pudo calcular la red vial de la capa "${group.layerId}"`,
            err
          );
          return null;
        }
      })
    );

    if (generation !== this.netRecomputeGeneration) return;

    let appliedAny = false;
    for (const r of results) {
      if (!r) continue;
      let cache = this.groupCaches.get(r.layerId);
      if (!cache) {
        cache = { net: r.net, netHash: r.hash, netCornerMode: r.cornerMode };
        this.groupCaches.set(r.layerId, cache);
      } else {
        cache.net = r.net;
        cache.netHash = r.hash;
        cache.netCornerMode = r.cornerMode;
      }
      appliedAny = true;
    }
    if (appliedAny) this.requestRender();
  }

  update(): void {
    const streets = useStreetStore.getState().streets;
    const roundabouts = useRoundaboutStore.getState().roundabouts;
    const groups = groupStreetsByLayer(streets, roundabouts);
    this.currentGroups = groups;

    const seenGroupIds = new Set(groups.map((g) => g.layerId));
    for (const key of this.groupCaches.keys()) {
      if (!seenGroupIds.has(key)) this.groupCaches.delete(key);
    }
    for (const group of groups) {
      if (!this.groupCaches.has(group.layerId)) {
        this.groupCaches.set(group.layerId, {
          net: { road: [], outer: [] },
          netHash: '',
          netCornerMode: useRoadCornerStore.getState().mode,
        });
      }
    }
  }

  paint(
    ctx: CanvasRenderingContext2D,
    toPx: (c: number[]) => [number, number],
    interacting: boolean
  ): void {
    if (this.currentGroups.length === 0) return;

    for (const group of this.currentGroups) {
      const layer = group.layer;
      if (!layer || !layer.visible) continue;
      if (group.streets.length === 0 && group.roundabouts.length === 0) continue;
      const cache = this.groupCaches.get(group.layerId);
      if (!cache) continue;

      const strokeColor = layer.color ?? FALLBACK_STREET_COLOR;
      const layerOp = layer.opacity ?? 1;

      if (!interacting) {
        this.paintRings(ctx, cache.net.outer, toPx, {
          fill: null,
          stroke: withAlpha('#c8c8c8', 0.55 * layerOp),
          lineWidth: 1,
        });
        this.paintRings(ctx, cache.net.road, toPx, {
          fill: null,
          stroke: withAlpha(strokeColor, 0.75 * layerOp),
          lineWidth: 1.5,
        });
      }

      ctx.save();
      ctx.strokeStyle = withAlpha(strokeColor, 0.75 * layerOp);
      ctx.lineWidth = 1;
      ctx.setLineDash([7, 5]);
      const allRoundabouts = useRoundaboutStore.getState().roundabouts;
      for (const s of group.streets) {
        const segs = clipStreetAxisSegments(streetAllCoords(s), allRoundabouts);
        for (const [a, b] of segs) {
          strokePolyline(ctx, [a, b] as Pt[], toPx, ctx.strokeStyle, 1);
        }
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  private paintRings(
    ctx: CanvasRenderingContext2D,
    polygons: Pt[][][],
    toPx: (c: number[]) => [number, number],
    style: { fill: string | null; stroke: string; lineWidth: number }
  ): void {
    if (polygons.length === 0) return;
    ctx.save();
    ctx.lineWidth = style.lineWidth;
    ctx.strokeStyle = style.stroke;

    for (const rings of polygons) {
      if (rings.length === 0) continue;

      if (style.fill) {
        ctx.beginPath();
        for (const ring of rings) {
          if (ring.length < 3) continue;
          traceRing(ctx, ring, toPx, true);
        }
        ctx.fillStyle = style.fill;
        ctx.fill('evenodd');
      }

      for (const ring of rings) {
        if (ring.length < 3) continue;
        traceRing(ctx, ring, toPx, true);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
