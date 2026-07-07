import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type DrawMode = 'select' | 'pan' | 'polygon' | 'line' | 'none';

type DrawState = {
  mode: DrawMode;
  setMode: (mode: DrawMode) => void;
};

export const useDrawStore = create<DrawState>()(
  immer((set) => ({
    mode: 'select',
    setMode: (mode) =>
      set((state) => {
        state.mode = mode;
      }),
  }))
);
