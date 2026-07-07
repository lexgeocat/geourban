import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import GeoJSON from 'ol/format/GeoJSON.js';

const geoJsonFormat = new GeoJSON();

const MAX_HISTORY = 50;

type HistoryState = {
  past: string[]; // snapshots serializados (GeoJSON)
  future: string[]; // snapshots para redo
  canUndo: boolean;
  canRedo: boolean;

  /** Toma un snapshot de las features (serializadas a GeoJSON) */
  pushState: (features: import('ol/Feature').default[]) => void;
  undo: () => object[] | null;
  redo: () => object[] | null;
  clear: () => void;
};

export const useHistoryStore = create<HistoryState>()(
  immer((set, get) => ({
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,

    pushState: (features) =>
      set((state) => {
        const serialized = geoJsonFormat.writeFeatures(features, {
          featureProjection: 'EPSG:3857',
        });
        state.past.push(serialized);
        if (state.past.length > MAX_HISTORY) state.past.shift();
        state.future = [];
        state.canUndo = state.past.length > 0;
        state.canRedo = false;
      }),

    undo: () => {
      const { past } = get();
      if (past.length < 2) return null; // need at least current + previous

      const restored = past[past.length - 2];
      set((state) => {
        const current = state.past.pop()!;
        state.future.push(current);
        state.canUndo = state.past.length > 1;
        state.canRedo = true;
      });

      return JSON.parse(restored);
    },

    redo: () => {
      const { future } = get();
      if (future.length === 0) return null;

      const restored = future[future.length - 1];
      set((state) => {
        state.past.push(state.future.pop()!);
        state.canUndo = state.past.length > 1;
        state.canRedo = state.future.length > 0;
      });

      return JSON.parse(restored);
    },

    clear: () =>
      set((state) => {
        state.past = [];
        state.future = [];
        state.canUndo = false;
        state.canRedo = false;
      }),
  }))
);
