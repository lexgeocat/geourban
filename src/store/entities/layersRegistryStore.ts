import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import {
  UNASSIGNED_LAYER_ID,
  createUnassignedLayer,
  isLayerKind,
  type Layer,
  type LayerKind,
} from '../../core/objectModel';

type LayerState = {
  layers: Layer[];
  index: Map<string, number>; // id -> posición en array
  activeLayerId: string | null;

  add: (layer: Omit<Layer, 'zIndex'>) => void;
  remove: (id: string) => void;
  update: (patch: Partial<Layer> & { id: string }) => void;
  reorder: (ids: string[], position: number) => void;
  toggleLock: (id: string) => void;
  toggleVisibility: (id: string) => void;
  isolatedLayerId: string | null;
  /** Snapshot de visibilidades previas al `isolate`, para restaurar al desaislar. */
  isolatePrevVisibility: Record<string, boolean> | null;
  toggleIsolate: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  loadLayers: (layers: Layer[], activeLayerId?: string | null) => void;
  resetToEmpty: () => void;
  reconcileOrphanFeatures: (features: Feature<Geometry>[]) => number;
  getById: (id: string) => Layer | undefined;
  getVisible: () => Layer[];
  count: () => number;
  hasKindVisible: (kind: string) => boolean;
  getLayerForKind: (kind: string) => Layer | undefined;
  getKind: (id: string) => LayerKind | null;
  hasKind: (kind: LayerKind) => boolean;
  getColorMode: (id: string) => 'solid' | 'colorIdx';
};

export const useLayersStore = create<LayerState>()(
  immer((set, get) => ({
    layers: [],
    index: new Map(),
    activeLayerId: null,

    /* ---------- Mutations ---------- */
    add: (layer) =>
      set((state) => {
        const newZIndex = state.layers.length;
        const safeKind: LayerKind = isLayerKind(layer.kind) ? layer.kind : 'lote';
        const withDefaults: Layer = {
          ...layer,
          kind: safeKind,
          fillColor: layer.fillColor ?? layer.color,
          showLabel: layer.showLabel ?? false,
          showCota: layer.showCota ?? false,
          colorMode: (layer as any).colorMode ?? (safeKind === 'manzana' ? 'colorIdx' : 'solid'),
          zIndex: newZIndex,
        };
        state.layers.push(withDefaults);
        state.index = new Map(state.layers.map((l, idx) => [l.id, idx]));
      }),

    remove: (id) =>
      set((state) => {
        const index = state.index.get(id);
        if (index === undefined) return;
        state.layers.splice(index, 1);
        state.index = new Map(
          state.layers.map((layer, idx) => [layer.id, idx])
        );
      }),

    update: (patch) =>
      set((state) => {
        const index = state.index.get(patch.id);
        if (index === undefined) return;
        Object.assign(state.layers[index], patch);
        if ('kind' in patch) {
          const safeKind: LayerKind = isLayerKind(patch.kind) ? patch.kind : 'lote';
          state.layers[index].kind = safeKind;
          state.layers[index].colorMode = safeKind === 'manzana' ? 'colorIdx' : 'solid';
        }
        if ('zIndex' in patch) {
          state.layers.sort((a, b) => a.zIndex - b.zIndex);
          state.index = new Map(
            state.layers.map((layer, idx) => [layer.id, idx])
          );
        }
        if (patch.locked === true && state.activeLayerId === patch.id) {
          state.activeLayerId = null;
        }
      }),

    reorder: (ids, position) =>
      set((state) => {
        const existingIds = ids.filter((id) => state.index.has(id));
        if (existingIds.length === 0) return;

        const layersToMove = existingIds
          .map((id) => state.layers[state.index.get(id)!])
          .filter((layer): layer is Layer => layer !== undefined);

        state.layers = state.layers.filter(
          (layer) => !existingIds.includes(layer.id)
        );

        const before = state.layers.slice(0, position);
        const after = state.layers.slice(position);
        state.layers = [...before, ...layersToMove, ...after];

        state.layers.forEach((layer, idx) => {
          layer.zIndex = idx;
        });

        state.index = new Map(
          state.layers.map((layer, idx) => [layer.id, idx])
        );
      }),

    toggleLock: (id) =>
      set((state) => {
        const index = state.index.get(id);
        if (index === undefined) return;
        const nextLocked = !state.layers[index].locked;
        state.layers[index].locked = nextLocked;
        if (nextLocked && state.activeLayerId === id) {
          state.activeLayerId = null;
        }
      }),

    toggleVisibility: (id) =>
      set((state) => {
        const index = state.index.get(id);
        if (index === undefined) return;
        state.layers[index].visible = !state.layers[index].visible;
      }),

    isolatedLayerId: null,
    isolatePrevVisibility: null as Record<string, boolean> | null,

    toggleIsolate: (id) =>
      set((state) => {
        if (state.isolatedLayerId === id) {
          const prev = state.isolatePrevVisibility;
          if (prev) {
            for (const layer of state.layers) {
              if (prev[layer.id] !== undefined) layer.visible = prev[layer.id];
            }
          }
          state.isolatedLayerId = null;
          state.isolatePrevVisibility = null;
          return;
        }
        const existing = state.isolatePrevVisibility;
        const snapshot = existing ?? Object.fromEntries(state.layers.map((l) => [l.id, l.visible]));
        for (const layer of state.layers) layer.visible = layer.id === id;
        state.isolatedLayerId = id;
        state.isolatePrevVisibility = snapshot;
      }),

    setActiveLayer: (id) =>
      set((state) => {
        if (id) {
          const idx = state.index.get(id);
          if (idx !== undefined && state.layers[idx].locked) return;
        }
        state.activeLayerId = id;
      }),

    loadLayers: (layers, activeLayerId = null) =>
      set((state) => {
        const next = layers.map((l) => ({
          ...l,
          kind: isLayerKind(l.kind) ? l.kind : 'lote',
          colorMode: ((l as any).colorMode as string) === 'colorIdx'
            ? 'colorIdx' as const
            : (isLayerKind(l.kind) && l.kind === 'manzana' ? 'colorIdx' as const : 'solid' as const),
        }));
        state.layers = next;
        state.index = new Map(next.map((l, idx) => [l.id, idx]));
        const candidate = activeLayerId ? next.find((l) => l.id === activeLayerId) : undefined;
        state.activeLayerId = candidate && !candidate.locked ? activeLayerId : null;
      }),

    resetToEmpty: () =>
      set((state) => {
        state.layers = [];
        state.index = new Map();
        state.activeLayerId = null;
      }),

    reconcileOrphanFeatures: (features) => {
      const validIds = new Set(get().layers.map((l) => l.id));
      const orphans = features.filter((f) => {
        const layerId = f.get('layerId') as string | undefined;
        return !!layerId && !validIds.has(layerId);
      });
      if (orphans.length === 0) return 0;

      if (!validIds.has(UNASSIGNED_LAYER_ID)) {
        set((state) => {
          state.layers.push(createUnassignedLayer(state.layers.length));
          state.index = new Map(state.layers.map((l, idx) => [l.id, idx]));
        });
      }
      for (const f of orphans) f.set('layerId', UNASSIGNED_LAYER_ID);
      return orphans.length;
    },

    /* ---------- Queries ---------- */
    getById: (id) => {
      const index = get().index.get(id);
      return index !== undefined ? get().layers[index] : undefined;
    },

    getVisible: () => {
      return get().layers
        .filter((layer) => layer.visible)
        .sort((a, b) => a.zIndex - b.zIndex);
    },

    count: () => {
      return get().layers.length;
    },

    hasKindVisible: (kind) => {
      return get().layers.some(
        (layer) => layer.visible && layer.kind === kind
      );
    },

    getLayerForKind: (kind) => {
      return get().layers.find((layer) => layer.kind === kind);
    },

    /* ---------- LayerKind queries---------- */
    getKind: (id) => {
      const index = get().index.get(id);
      if (index === undefined) return null;
      const k = get().layers[index].kind;
      return isLayerKind(k) ? k : null;
    },
    hasKind: (kind) => {
      return get().layers.some((l) => l.kind === kind);
    },
    getColorMode: (id) => {
      const index = get().index.get(id);
      if (index === undefined) return 'solid';
      return get().layers[index].colorMode;
    },
  }))
);