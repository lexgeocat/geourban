import { create } from 'zustand';

type GenerateLotsProgressState = {
  active: boolean;
  processed: number;
  total: number;
  cancelRequested: boolean;
  start: (total: number) => void;
  setProgress: (processed: number) => void;
  requestCancel: () => void;
  finish: () => void;
};

export const useGenerateLotsProgressStore = create<GenerateLotsProgressState>()((set) => ({
  active: false,
  processed: 0,
  total: 0,
  cancelRequested: false,
  start: (total) => set({ active: true, processed: 0, total, cancelRequested: false }),
  setProgress: (processed) => set({ processed }),
  requestCancel: () => set({ cancelRequested: true }),
  finish: () => set({ active: false, cancelRequested: false }),
}));