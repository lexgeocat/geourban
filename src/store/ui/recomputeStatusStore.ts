import { create } from 'zustand';

type RecomputeStatusState = {
  running: boolean;
  setRunning: (v: boolean) => void;
};

export const useRecomputeStatusStore = create<RecomputeStatusState>()((set) => ({
  running: false,
  setRunning: (v) => set({ running: v }),
}));
