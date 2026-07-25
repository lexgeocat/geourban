import { create } from 'zustand';

type TopologyWarningsState = {
  checking: boolean;
  overlapCount: number;
  gapCount: number;
  lastCheckedAt: number | null;
  setChecking: (v: boolean) => void;
  setResults: (overlapCount: number, gapCount: number) => void;
  clear: () => void;
};

/** Resultado de la validación topológica automática que corre después de
 *  cada `recomputeManzanosImmediate` (H-VIA-4) — antes esto solo existía
 *  como botones manuales "Overlaps"/"Huecos" en TopBar, que el usuario
 *  tenía que acordarse de clickear. */
export const useTopologyWarningsStore = create<TopologyWarningsState>()((set) => ({
  checking: false,
  overlapCount: 0,
  gapCount: 0,
  lastCheckedAt: null,
  setChecking: (v) => set({ checking: v }),
  setResults: (overlapCount, gapCount) =>
    set({ overlapCount, gapCount, checking: false, lastCheckedAt: Date.now() }),
  clear: () => set({ overlapCount: 0, gapCount: 0, checking: false, lastCheckedAt: null }),
}));