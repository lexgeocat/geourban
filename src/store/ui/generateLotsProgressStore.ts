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

/** Fase 6, punto 4: progreso incremental + cancelación real de
 *  GenerateLotsCommand — antes era un único postMessage con TODOS los
 *  manzanos, sin feedback ni forma de abortar a mitad de camino. */
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