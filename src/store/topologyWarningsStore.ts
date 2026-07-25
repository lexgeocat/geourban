import { create } from 'zustand';

type TopologyWarningsState = {
  checking: boolean;
  overlapCount: number;
  gapCount: number;
  /** ids de manzana (o lotGroupId) involucrados en al menos una
   *  superposición detectada — permite mostrar el aviso por tarjeta en
   *  ManzanoPanel, no solo un badge global (Fase 3, punto 6). */
  affectedManzanoIds: Set<string>;
  lastCheckedAt: number | null;
  setChecking: (v: boolean) => void;
  setResults: (overlapCount: number, gapCount: number, affectedManzanoIds?: Set<string>) => void;
  clear: () => void;
};

export const useTopologyWarningsStore = create<TopologyWarningsState>()((set) => ({
  checking: false,
  overlapCount: 0,
  gapCount: 0,
  affectedManzanoIds: new Set(),
  lastCheckedAt: null,
  setChecking: (v) => set({ checking: v }),
  setResults: (overlapCount, gapCount, affectedManzanoIds = new Set()) =>
    set({ overlapCount, gapCount, affectedManzanoIds, checking: false, lastCheckedAt: Date.now() }),
  clear: () => set({ overlapCount: 0, gapCount: 0, affectedManzanoIds: new Set(), checking: false, lastCheckedAt: null }),
}));