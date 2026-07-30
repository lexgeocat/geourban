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

function buildSingleLayerStyle(layer: Layer): Record<string, unknown> {
  const op = layer.opacity ?? 1;
  const isManzanaLayer = layer.kind === 'manzana';
  const hideIfSubdivided = (expr: unknown): unknown =>
    isManzanaLayer
      ? ['case', ['==', ['get', 'lotStatus'], 'subdivided'], 'rgba(0,0,0,0)', expr]
      : expr;

  if (layer.colorMode !== 'colorIdx') {
    return {
      'fill-color': hideIfSubdivided(withAlpha(layer.fillColor ?? layer.color, 0.3 * op)),
      'stroke-color': hideIfSubdivided(withAlpha(layer.color, op)),
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
    'fill-color': hideIfSubdivided(fillExpr),
    'stroke-color': hideIfSubdivided(strokeExpr),
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

interface MirrorEntry {
  source: VectorSource;
  layer: WebGLVectorLayer;
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
    const key = this.resolveMirrorKey(feature, byId);
    const prevKey = this.placement.get(feature);
    if (prevKey === key) return; // ya está en el mirror correcto — nada que mover
    if (prevKey != null) this.entryFor(prevKey)?.source.removeFeature(feature);
    this.entryFor(key)?.source.addFeature(feature);
    this.placement.set(feature, key);
  }

  private unplace(feature: Feature<Geometry>): void {
    const prevKey = this.placement.get(feature);
    if (prevKey == null) return;
    this.entryFor(prevKey)?.source.removeFeature(feature);
    this.placement.delete(feature);
  }

  private syncLayerSet(layers: Layer[]): void {
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
        // setStyle() es lo caro (recompila el pipeline de shaders): solo lo
        // llamamos si algo que afecta el estilo realmente cambió, no en
        // cada tick del store (p.ej. al mover el slider de OTRA capa).
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
      entry.layer.dispose();
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
        entry.layer.dispose();
      }
      this.map?.removeLayer(this.fallback.layer);
      this.fallback.layer.dispose();
      this.map = null;
    };
  }

  getLayers(): BaseLayer[] {
    return [this.fallback.layer, ...Array.from(this.mirrors.values(), (m) => m.layer)];
  }

  changed(): void {
    this.fallback.layer.changed();
    for (const entry of this.mirrors.values()) entry.layer.changed();
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