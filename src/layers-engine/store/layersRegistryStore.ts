import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { isLayerKind, type Layer, type LayerKind } from '../../core/objectModel';

export type LayerState = {
  layers: Layer[];
  index: Map<string, number>; // id -> posición en array
  activeLayerId: string | null;

  add: (layer: Omit<Layer, 'zIndex'>) => void;
  remove: (id: string) => void;
  update: (patch: Partial<Layer> & { id: string }) => void;
  reorder: (ids: string[], position: number) => void;
  isolatedLayerId: string | null;
  isolatePrevVisibility: Record<string, boolean> | null;
  toggleIsolate: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  loadLayers: (layers: Layer[], activeLayerId?: string | null) => void;
  resetToEmpty: () => void;
  getById: (id: string) => Layer | undefined;
  hasKindVisible: (kind: string) => boolean;
  getLayerForKind: (kind: string) => Layer | undefined;
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
          showLabel: layer.showLabel ?? false,
          showCota: layer.showCota ?? false,
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
        state.index = new Map(state.layers.map((layer, idx) => [layer.id, idx]));
      }),

    update: (patch) =>
      set((state) => {
        const index = state.index.get(patch.id);
        if (index === undefined) return;
        Object.assign(state.layers[index], patch);
        if ('zIndex' in patch) {
          state.layers.sort((a, b) => a.zIndex - b.zIndex);
          state.index = new Map(state.layers.map((layer, idx) => [layer.id, idx]));
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

        state.layers = state.layers.filter((layer) => !existingIds.includes(layer.id));

        const before = state.layers.slice(0, position);
        const after = state.layers.slice(position);
        state.layers = [...before, ...layersToMove, ...after];

        state.layers.forEach((layer, idx) => {
          layer.zIndex = idx;
        });

        state.index = new Map(state.layers.map((layer, idx) => [layer.id, idx]));
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
        state.isolatedLayerId = null;
        state.isolatePrevVisibility = null;
      }),

    /* ---------- Queries ---------- */
    getById: (id) => {
      const index = get().index.get(id);
      return index !== undefined ? get().layers[index] : undefined;
    },

    hasKindVisible: (kind) => {
      return get().layers.some((layer) => layer.visible && layer.kind === kind);
    },

    getLayerForKind: (kind) => {
      return get().layers.find((layer) => layer.kind === kind);
    },
  }))
);
