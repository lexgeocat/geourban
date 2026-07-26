import { create } from 'zustand';

type RecomputeStatusState = {
  running: boolean;
  setRunning: (v: boolean) => void;
};

/** Refleja si recomputeManzanosImmediate (trazado de calles/rotondas)
 *  está corriendo — antes no había ningún feedback visible durante el
 *  debounce + tiempo de worker de ese recompute. */
export const useRecomputeStatusStore = create<RecomputeStatusState>()((set) => ({
  running: false,
  setRunning: (v) => set({ running: v }),
}));
