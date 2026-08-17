import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import type BaseLayer from 'ol/layer/Base.js';
import type Map from 'ol/Map.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import type { Layer } from '@kernel/domain-model/featureModel';
import { createByIdCache } from '@kernel/utils/byIdCache';
import { withAlpha } from '@kernel/color/withAlpha';

export { withAlpha };

export type WorkVisibility = {
  streets: boolean;
};

export interface DrawLayers {
  webglRenderer: LayeredWebglRenderer;
  streetLayer: VectorLayer<VectorSource>;
  postrenderLayer: VectorLayer<VectorSource>;
  source: VectorSource;
  streetSource: VectorSource;
}

const renderedWebglLayers = new WeakSet<WebGLVectorLayer>();

function trackRenderOnce(layer: WebGLVectorLayer): void {
  layer.once('postrender', () => {
    renderedWebglLayers.add(layer);
  });
}

function safeDisposeLayer(layer: WebGLVectorLayer): void {
  if (!renderedWebglLayers.has(layer)) {
    // El renderer WebGL nunca llegó a inicializar su helper (nunca pintó un
    // frame), así que no hay recursos GPU que liberar. Llamar a dispose()
    // acá rompe porque su implementación asume que el helper ya existe.
    return;
  }
  try {
    layer.dispose();
  } catch (err) {
    console.warn(
      'DrawLayerRenderer: layer.dispose() falló pese a haber renderizado — se ignora.',
      err
    );
  }
}

function buildSingleLayerStyle(layer: Layer): Record<string, unknown> {
  const op = layer.opacity ?? 1;
  return {
    'stroke-color': withAlpha(layer.color, op),
    'stroke-width': 2,
    'circle-radius': 5,
    'circle-fill-color': withAlpha(layer.color, op * 0.65),
    'circle-stroke-color': withAlpha(layer.color, op),
    'circle-stroke-width': 1.5,
  };
}

const FALLBACK_STYLE = {
  'stroke-color': '#10b981',
  'stroke-width': 2,
  'circle-radius': 5,
  'circle-fill-color': 'rgba(16, 185, 129, 0.65)',
  'circle-stroke-color': '#10b981',
  'circle-stroke-width': 1.5,
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
  opacity: number;
}

interface PoolSlot {
  source: VectorSource;
  layer: WebGLVectorLayer;
  colorTable: PoolLayerColor[];
  lastSig: string;
}

const getLayerById = createByIdCache<Layer>();

export class LayeredWebglRenderer {
  private readonly master: VectorSource;
  private readonly mirrors = new globalThis.Map<string, MirrorEntry>();
  private readonly fallback: MirrorEntry;
  private readonly placement = new WeakMap<Feature<Geometry>, string>();
  private knownLayerIds = new Set<string>();

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

  private createMirror(
    style: Record<string, unknown>,
    zIndex: number,
    visible: boolean
  ): MirrorEntry {
    const source = new VectorSource();
    const layer = new WebGLVectorLayer({
      source,
      disableHitDetection: true,
      style,
      zIndex,
    });
    layer.setVisible(visible);
    trackRenderOnce(layer);
    return { source, layer };
  }
  private static layerSignature(layer: Layer): string {
    return `${layer.color}|${layer.opacity}`;
  }

  private getByIdMap(): globalThis.Map<string, Layer> {
    return getLayerById(useLayersStore.getState().layers);
  }

  private resolveMirrorKey(
    feature: Feature<Geometry>,
    byId: globalThis.Map<string, Layer>
  ): string {
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
    const byId = new globalThis.Map(layers.map((l) => [l.id, l] as const));
    const currentIds = new Set(byId.keys());

    let membershipChanged = currentIds.size !== this.knownLayerIds.size;
    if (!membershipChanged) {
      for (const id of currentIds) {
        if (!this.knownLayerIds.has(id)) {
          membershipChanged = true;
          break;
        }
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

    if (membershipChanged) {
      for (const f of this.master.getFeatures()) {
        this.place(f as Feature<Geometry>, byId);
      }
    }
  }

  private static poolSlotSig(layers: PoolLayerColor[]): string {
    return layers.map((l) => `${l.color}|${l.opacity}`).join(',');
  }

  private static buildPoolSlotStyle(colors: PoolLayerColor[]): Record<string, unknown> {
    const strokeMatch: unknown[] = ['match', ['get', 'webglSlotIdx']];
    const fillMatch: unknown[] = ['match', ['get', 'webglSlotIdx']];

    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      strokeMatch.push(i, withAlpha(c.color, c.opacity));
      fillMatch.push(i, withAlpha(c.color, c.opacity * 0.65));
    }

    strokeMatch.push('rgba(0,0,0,0)');
    fillMatch.push('rgba(0,0,0,0)');
    return {
      'stroke-color': strokeMatch,
      'stroke-width': 2,
      'circle-radius': 5,
      'circle-fill-color': fillMatch,
      'circle-stroke-color': strokeMatch,
      'circle-stroke-width': 1.5,
    };
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
        opacity: entry.layer.opacity,
      }));
      const sig = LayeredWebglRenderer.poolSlotSig(colorTable);
      const existing = oldSlots[i];

      if (existing) {
        if (existing.lastSig !== sig) {
          if (this.map)
            existing.layer.setStyle(LayeredWebglRenderer.buildPoolSlotStyle(colorTable));
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
        trackRenderOnce(layer);
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
    this.allocatePoolSlots(layers);

    const byId = this.getByIdMap();
    for (const f of this.master.getFeatures()) {
      this.place(f as Feature<Geometry>, byId);
    }
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
      trackRenderOnce(this.poolFallbackLayer);
      this.map?.addLayer(this.poolFallbackLayer);

      this.allocatePoolSlots(layers);
      const byId = this.getByIdMap();
      for (const f of this.master.getFeatures()) {
        this.place(f as Feature<Geometry>, byId);
      }
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

    this.onAdd = (evt) => {
      if (evt.feature) this.place(evt.feature, this.getByIdMap());
    };
    this.onRemove = (evt) => {
      if (evt.feature) this.unplace(evt.feature);
    };
    this.onChange = (evt) => {
      if (evt.feature) this.place(evt.feature, this.getByIdMap());
    };

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

export function buildDrawLayers(visibility: WorkVisibility): DrawLayers {
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
