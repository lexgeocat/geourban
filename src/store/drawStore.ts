import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type DrawMode = 'select' | 'pan' | 'polygon' | 'line' | 'erase' | 'none';

type DrawState = {
  mode: DrawMode;
  /** Id de la ultima LineString dibujada — la usa la subdivision "manual" */
  lastDrawnLineId: string | number | null;
  setMode: (mode: DrawMode) => void;
  setLastDrawnLineId: (id: string | number | null) => void;
};

export const useDrawStore = create<DrawState>()(
  immer((set) => ({
    mode: 'select',
    lastDrawnLineId: null,
    setMode: (mode) =>
      set((state) => {
        state.mode = mode;
      }),
    setLastDrawnLineId: (id) =>
      set((state) => {
        state.lastDrawnLineId = id;
      }),
  }))
);
