import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type DrawMode = 'none' | 'polygon' | 'line';

type DrawState = {
  mode: DrawMode;
  setMode: (mode: DrawMode) => void;
};

export const useDrawStore = create<DrawState>()(
  immer((set) => ({
    mode: 'none',
    setMode: (mode) =>
      set((state) => {
        state.mode = mode;
      }),
  }))
);
