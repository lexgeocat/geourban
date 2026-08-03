import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import type BaseLayer from 'ol/layer/Base.js';
import type Map from 'ol/Map.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import type { Layer } from '../../core/objectModel';
import { MZN_COLORS, MZN_COLOR_COUNT } from '../../geo/manzanoColor';
import { recordSetStyleCall, recordSyncLayerSetCall, recordWebglLayerCount } from '../../store/debug/debugCounters';

export type WorkVisibility = {
  lots: boolean;
  streets: boolean;
  measurements: boolean;
};

export interface DrawLayers {
  webglRenderer: LayeredWebglRenderer;
  streetLayer: VectorLayer<VectorSource>;
  postrenderLayer: VectorLayer<VectorSource>;
  source: VectorSource;
  streetSource: VectorSource;
}

/** Hex `#rrggbb` o `#rgb` → `rgba(r,g,b,a)`. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function safeDisposeLayer(layer: { dispose: () => void }): void {
  try {
    layer.dispose();
  } catch (err) {
    console.warn(
      'DrawLayerRenderer: layer.dispose() falló (probablemente el helper WebGL nunca se inicializó ' +
        'porque la capa nunca llegó a renderizar) — se ignora.',
      err,
    );
  }
}

function buildSingleLayerStyle(layer: Layer): Record<string, unknown> {
  const op = layer.opacity ?? 1;
  const isManzanaLayer = layer.kind === 'manzana';

  const suppressFillIfSubdivided = (expr: unknown): unknown =>
    isManzanaLayer
      ? ['case', ['==', ['get', 'lotStatus'], 'subdivided'], 'rgba(0,0,0,0)', expr]
      : expr;

  if (layer.colorMode !== 'colorIdx') {
    return {
      'fill-color': suppressFillIfSubdivided(withAlpha(layer.fillColor ?? layer.color, 0.3 * op)),
      'stroke-color': withAlpha(layer.color, op),
      'stroke-width': 2,
    };
  }
  const fillExpr: unknown[] = ['match', ['get', 'colorIdx']];
  const strokeExpr: unknown[] = ['match', ['get', 'colorIdx']];
  for (let i = 0; i < MZN_COLOR_COUNT; i++) {
    fillExpr.push(i, withAlpha(MZN_COLORS[i], 0.3 * op));
    strokeExpr.push(i, withAlpha(MZN_COLORS[i], op));
  }
  fillExpr.push(withAlpha(MZN_COLORS[0], 0.3 * op));
  strokeExpr.push(withAlpha(MZN_COLORS[0], op));
  return {
    'fill-color': suppressFillIfSubdivided(fillExpr),
    'stroke-color': strokeExpr,
    'stroke-width': 2,
  };
}

const FALLBACK_STYLE = {
  'fill-color': 'rgba(16,185,129,0.30)',
  'stroke-color': '#10b981',
  'stroke-width': 2,
};

const FALLBACK_KEY = '__geourban_unassigned_mirror__';

const STREET_SKETCH_Z_INDEX = 10_000;
const POSTRENDER_Z_INDEX = 10_001;
export const MAX_WEBGL_LAYERS = 48;

interface MirrorEntry {
  source: VectorSource;
  layer: WebGLVectorLayer;
}

interface PoolLayerColor {
  color: string;
  fillColor: string;
  opacity: number;
  suppressIfSubdivided: boolean;
  colorMode: 'solid' | 'colorIdx';
}

interface PoolSlot {
  source: VectorSource;
  layer: WebGLVectorLayer;
  colorTable: PoolLayerColor[];
  lastSig: string;
}

export class LayeredWebglRenderer {
  private readonly master: VectorSource;
  private readonly mirrors = new globalThis.Map<string, MirrorEntry>();
  private readonly fallback: MirrorEntry;
  private readonly placement = new WeakMap<Feature<Geometry>, string>();
  private knownLayerIds = new Set<string>();
  private byIdCache: { layers: Layer[]; map: globalThis.Map<string, Layer> } | null = null;

  private map: Map | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private onAdd?: (evt: { feature?: Feature<Geometry> }) => void;
  private onRemove?: (evt: { feature?: Feature<Geometry> }) => void;
  private onChange?: (evt: { feature?: Feature<Geometry> }) => void;
  private lastStyleSignatures = new globalThis.Map<string, string>();

  private poolMode = false;
  private poolSlots: PoolSlot[] = [];
  private layerSlotMap = new globalThis.Map<string, { slot: number; idx: number }>();
  private poolFallbackSource: VectorSource | null = null;
  private poolFallbackLayer: WebGLVectorLayer | null = null;

  constructor(master: VectorSource) {
    this.master = master;
    this.fallback = this.createMirror(FALLBACK_STYLE, -1, true);
    this.syncLayerSet(useLayersStore.getState().layers);
  }

  private createMirror(style: Record<string, unknown>, zIndex: number, visible: boolean): MirrorEntry {
    const source = new VectorSource();
    const layer = new WebGLVectorLayer({
      source,
      disableHitDetection: true,
      style,
      zIndex,
    });
    layer.setVisible(visible);
    return { source, layer };
  }
  private static layerSignature(layer: Layer): string {
    return `${layer.color}|${layer.fillColor}|${layer.opacity}|${layer.colorMode}|${layer.kind}`;
  }

  private getByIdMap(): globalThis.Map<string, Layer> {
    const layers = useLayersStore.getState().layers;
    if (this.byIdCache && this.byIdCache.layers === layers) return this.byIdCache.map;
    const map = new globalThis.Map(layers.map((l) => [l.id, l] as const));
    this.byIdCache = { layers, map };
    return map;
  }

  private resolveMirrorKey(feature: Feature<Geometry>, byId: globalThis.Map<string, Layer>): string {
    const layerId = feature.get('layerId') as string | undefined;
    if (layerId && byId.has(layerId)) return layerId;
    return FALLBACK_KEY;
  }

  private entryFor(key: string): MirrorEntry | undefined {
    return key === FALLBACK_KEY ? this.fallback : this.mirrors.get(key);
  }

  private place(feature: Feature<Geometry>, byId: globalThis.Map<string, Layer>): void {
    this.unplaceOnly(feature);

    if (this.poolMode) {
      const layerId = feature.get('layerId') as string | undefined;
      if (!layerId || !byId.has(layerId)) {
        this.poolFallbackSource?.addFeature(feature);
        this.placement.set(feature, '__geourban_pool_fallback__');
        feature.set('webglSlotIdx', -1, true);
        return;
      }
      const slotInfo = this.layerSlotMap.get(layerId);
      if (!slotInfo || !this.poolSlots[slotInfo.slot]) {
        this.poolFallbackSource?.addFeature(feature);
        this.placement.set(feature, '__geourban_pool_fallback__');
        feature.set('webglSlotIdx', -1, true);
        return;
      }
      feature.set('webglSlotIdx', slotInfo.idx, true);
      this.poolSlots[slotInfo.slot].source.addFeature(feature);
      this.placement.set(feature, `pool:${slotInfo.slot}`);
      return;
    }

    const key = this.resolveMirrorKey(feature, byId);
    this.entryFor(key)?.source.addFeature(feature);
    this.placement.set(feature, key);
  }

  private unplaceOnly(feature: Feature<Geometry>): void {
    const prevKey = this.placement.get(feature);
    if (prevKey == null) return;
    if (this.poolMode) {
      if (prevKey === '__geourban_pool_fallback__') {
        this.poolFallbackSource?.removeFeature(feature);
      } else if (prevKey.startsWith('pool:')) {
        const slot = parseInt(prevKey.slice(5), 10);
        if (!Number.isNaN(slot) && slot < this.poolSlots.length && this.poolSlots[slot]) {
          this.poolSlots[slot].source.removeFeature(feature);
        }
      }
    } else {
      this.entryFor(prevKey)?.source.removeFeature(feature);
    }
    this.placement.delete(feature);
  }

  private unplace(feature: Feature<Geometry>): void {
    this.unplaceOnly(feature);
  }

  private syncLayerSet(layers: Layer[]): void {
    const shouldPool = layers.length > MAX_WEBGL_LAYERS;
    if (shouldPool !== this.poolMode) {
      this.transitionMode(shouldPool, layers);
      return;
    }
    if (this.poolMode) {
      this.syncPooledLayers(layers);
    } else {
      this.syncPerLayerSet(layers);
    }
  }

  private syncPerLayerSet(layers: Layer[]): void {
    recordSyncLayerSetCall();
    const byId = new globalThis.Map(layers.map((l) => [l.id, l] as const));
    const currentIds = new Set(byId.keys());

    let membershipChanged = currentIds.size !== this.knownLayerIds.size;
    if (!membershipChanged) {
      for (const id of currentIds) {
        if (!this.knownLayerIds.has(id)) { membershipChanged = true; break; }
      }
    }

    for (const layer of layers) {
      let entry = this.mirrors.get(layer.id);
      const sig = LayeredWebglRenderer.layerSignature(layer);
      if (!entry) {
        entry = this.createMirror(buildSingleLayerStyle(layer), layer.zIndex, layer.visible);
        this.mirrors.set(layer.id, entry);
        this.map?.addLayer(entry.layer);
        this.lastStyleSignatures.set(layer.id, sig);
      } else {
        if (this.lastStyleSignatures.get(layer.id) !== sig) {
          entry.layer.setStyle(buildSingleLayerStyle(layer));
          recordSetStyleCall();
          this.lastStyleSignatures.set(layer.id, sig);
        }
        entry.layer.setZIndex(layer.zIndex);
        entry.layer.setVisible(layer.visible);
      }
    }

    for (const [id, entry] of Array.from(this.mirrors.entries())) {
      if (byId.has(id)) continue;
      for (const f of entry.source.getFeatures().slice()) {
        entry.source.removeFeature(f);
        this.fallback.source.addFeature(f);
        this.placement.set(f as Feature<Geometry>, FALLBACK_KEY);
      }
      this.map?.removeLayer(entry.layer);
      safeDisposeLayer(entry.layer);
      this.mirrors.delete(id);
      this.lastStyleSignatures.delete(id);
    }

    this.knownLayerIds = currentIds;
    this.byIdCache = { layers, map: byId };

    if (membershipChanged) {
      for (const f of this.master.getFeatures()) {
        this.place(f as Feature<Geometry>, byId);
      }
    }

    recordWebglLayerCount(this.mirrors.size + 1);
  }

  private static poolSlotSig(layers: PoolLayerColor[]): string {
  return layers
    .map((l) => `${l.color}|${l.fillColor}|${l.opacity}|${l.suppressIfSubdivided ? 1 : 0}|${l.colorMode}`)
    .join(',');
}

private static buildPoolSlotStyle(colors: PoolLayerColor[]): Record<string, unknown> {
  const fillMatch: unknown[] = ['match', ['get', 'webglSlotIdx']];
  const strokeMatch: unknown[] = ['match', ['get', 'webglSlotIdx']];

  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];

    if (c.colorMode === 'colorIdx') {
      const fillIdxExpr: unknown[] = ['match', ['get', 'colorIdx']];
      const strokeIdxExpr: unknown[] = ['match', ['get', 'colorIdx']];
      for (let k = 0; k < MZN_COLOR_COUNT; k++) {
        fillIdxExpr.push(k, withAlpha(MZN_COLORS[k], 0.3 * c.opacity));
        strokeIdxExpr.push(k, withAlpha(MZN_COLORS[k], c.opacity));
      }
      fillIdxExpr.push(withAlpha(MZN_COLORS[0], 0.3 * c.opacity));
      strokeIdxExpr.push(withAlpha(MZN_COLORS[0], c.opacity));

      const fill = c.suppressIfSubdivided
        ? ['case', ['==', ['get', 'lotStatus'], 'subdivided'], 'rgba(0,0,0,0)', fillIdxExpr]
        : fillIdxExpr;

      fillMatch.push(i, fill);
      strokeMatch.push(i, strokeIdxExpr);
      continue;
    }

    const fill = withAlpha(c.fillColor, 0.3 * c.opacity);
    const stroke = withAlpha(c.color, c.opacity);
    fillMatch.push(
      i,
      c.suppressIfSubdivided
        ? ['case', ['==', ['get', 'lotStatus'], 'subdivided'], 'rgba(0,0,0,0)', fill]
        : fill,
    );
    strokeMatch.push(i, stroke);
  }

  fillMatch.push('rgba(0,0,0,0)');
  strokeMatch.push('rgba(0,0,0,0)');
  return { 'fill-color': fillMatch, 'stroke-color': strokeMatch, 'stroke-width': 2 };
}

  private allocatePoolSlots(layers: Layer[]): void {
    this.layerSlotMap.clear();
    const nSlots = Math.min(MAX_WEBGL_LAYERS, layers.length);
    if (nSlots === 0) {
      this.disposeAllPoolSlots();
      return;
    }
    const slotSize = Math.max(1, Math.ceil(layers.length / nSlots));

    const slotLayers: Array<{ layer: Layer; idx: number }[]> = [];
    for (let i = 0; i < nSlots; i++) slotLayers.push([]);

    let layerIdxGlobal = 0;
    for (const layer of layers) {
      const slot = Math.min(nSlots - 1, Math.floor(layerIdxGlobal / slotSize));
      slotLayers[slot].push({ layer, idx: slotLayers[slot].length });
      this.layerSlotMap.set(layer.id, { slot, idx: slotLayers[slot].length - 1 });
      layerIdxGlobal++;
    }

    const oldSlots = this.poolSlots;
    const nextSlots: PoolSlot[] = new Array(nSlots);

    for (let i = 0; i < nSlots; i++) {
      const colorTable: PoolLayerColor[] = slotLayers[i].map((entry) => ({
  color: entry.layer.color,
  fillColor: entry.layer.fillColor,
  opacity: entry.layer.opacity,
  suppressIfSubdivided: entry.layer.kind === 'manzana',
  colorMode: entry.layer.colorMode,
}));
      const sig = LayeredWebglRenderer.poolSlotSig(colorTable);
      const existing = oldSlots[i];

      if (existing) {
        if (existing.lastSig !== sig) {
          if (this.map) existing.layer.setStyle(LayeredWebglRenderer.buildPoolSlotStyle(colorTable));
          recordSetStyleCall();
        }
        existing.colorTable = colorTable;
        existing.lastSig = sig;
        nextSlots[i] = existing;
      } else {
        const source = new VectorSource();
        const layer = new WebGLVectorLayer({
          source,
          disableHitDetection: true,
          style: LayeredWebglRenderer.buildPoolSlotStyle(colorTable),
          zIndex: 0, // todos los slots del pool quedan al mismo Z base
        });
        nextSlots[i] = { source, layer, colorTable, lastSig: sig };
        this.map?.addLayer(layer);
      }
    }
    for (let i = nSlots; i < oldSlots.length; i++) {
      const removed = oldSlots[i];
      if (!removed) continue;
      this.map?.removeLayer(removed.layer);
      safeDisposeLayer(removed.layer);
    }

    this.poolSlots = nextSlots;
  }

  private disposeAllPoolSlots(): void {
    for (const slot of this.poolSlots) {
      this.map?.removeLayer(slot.layer);
      safeDisposeLayer(slot.layer);
    }
    this.poolSlots = [];
  }
  private syncPooledLayers(layers: Layer[]): void {
    recordSyncLayerSetCall();
    this.allocatePoolSlots(layers);

    this.byIdCache = null; 
    const byId = this.getByIdMap();
    for (const f of this.master.getFeatures()) {
      this.place(f as Feature<Geometry>, byId);
    }
    recordWebglLayerCount(this.poolSlots.length);
  }

  private transitionMode(toPooled: boolean, layers: Layer[]): void {
    this.poolMode = toPooled;
    if (toPooled) {
      for (const [, entry] of Array.from(this.mirrors.entries())) {
        entry.source.clear(true);
        this.map?.removeLayer(entry.layer);
        safeDisposeLayer(entry.layer);
      }
      this.mirrors.clear();
      this.lastStyleSignatures.clear();
      this.knownLayerIds.clear();
      this.poolFallbackSource = new VectorSource();
      this.poolFallbackLayer = new WebGLVectorLayer({
        source: this.poolFallbackSource,
        disableHitDetection: true,
        style: FALLBACK_STYLE,
        zIndex: -1,
      });
      this.map?.addLayer(this.poolFallbackLayer);

      this.allocatePoolSlots(layers);
      this.byIdCache = null;
      const byId = this.getByIdMap();
      for (const f of this.master.getFeatures()) {
        this.place(f as Feature<Geometry>, byId);
      }
      recordWebglLayerCount(this.poolSlots.length);
    } else {
      this.disposeAllPoolSlots();
      if (this.poolFallbackLayer) {
        this.poolFallbackSource?.clear(true);
        this.map?.removeLayer(this.poolFallbackLayer);
        safeDisposeLayer(this.poolFallbackLayer);
        this.poolFallbackLayer = null;
        this.poolFallbackSource = null;
      }
      this.poolMode = false;
      this.syncPerLayerSet(layers);
    }
  }

  attach(map: Map): () => void {
    this.map = map;

    this.onAdd = (evt) => { if (evt.feature) this.place(evt.feature, this.getByIdMap()); };
    this.onRemove = (evt) => { if (evt.feature) this.unplace(evt.feature); };
    this.onChange = (evt) => { if (evt.feature) this.place(evt.feature, this.getByIdMap()); };

    this.master.on('addfeature', this.onAdd as never);
    this.master.on('removefeature', this.onRemove as never);
    this.master.on('changefeature', this.onChange as never);

    this.unsubscribeStore = useLayersStore.subscribe((state, prevState) => {
      if (state.layers !== prevState.layers) this.syncLayerSet(state.layers);
    });

    return () => {
      if (this.onAdd) this.master.un('addfeature', this.onAdd as never);
      if (this.onRemove) this.master.un('removefeature', this.onRemove as never);
      if (this.onChange) this.master.un('changefeature', this.onChange as never);
      this.unsubscribeStore?.();
      this.unsubscribeStore = null;
      for (const entry of this.mirrors.values()) {
        this.map?.removeLayer(entry.layer);
        safeDisposeLayer(entry.layer);
      }
      this.disposeAllPoolSlots();
      if (this.poolFallbackLayer) {
        this.map?.removeLayer(this.poolFallbackLayer);
        safeDisposeLayer(this.poolFallbackLayer);
        this.poolFallbackLayer = null;
        this.poolFallbackSource = null;
      }
      this.map?.removeLayer(this.fallback.layer);
      safeDisposeLayer(this.fallback.layer);
      this.map = null;
    };
  }

  getLayers(): BaseLayer[] {
  if (this.poolMode) {
    const layers: BaseLayer[] = [];
    if (this.poolFallbackLayer) layers.push(this.poolFallbackLayer);
    for (const slot of this.poolSlots) layers.push(slot.layer);
    return layers;
  }
  return [this.fallback.layer, ...Array.from(this.mirrors.values(), (m) => m.layer)];
}

  changed(): void {
    this.fallback.layer.changed();
    for (const entry of this.mirrors.values()) entry.layer.changed();
    for (const slot of this.poolSlots) slot.layer.changed();
  }
}

export function buildDrawLayers(
  visibility: WorkVisibility,
): DrawLayers {
  const source = new VectorSource();
  const webglRenderer = new LayeredWebglRenderer(source);

  const streetSource = new VectorSource();
  const streetLayer = new VectorLayer({
    source: streetSource,
    visible: visibility.streets,
    style: null,
    zIndex: STREET_SKETCH_Z_INDEX,
  });

  const postrenderLayer = new VectorLayer({
    source: new VectorSource(),
    style: () => undefined,
    renderOrder: undefined,
    zIndex: POSTRENDER_Z_INDEX,
  });

  return { webglRenderer, streetLayer, postrenderLayer, source, streetSource };
}