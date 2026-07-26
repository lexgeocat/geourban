import { create } from 'zustand';
import type { Pt } from '../geo/polygonEngine';

type SubdivisionPreviewState = {
  /** Anillos (EPSG:3857 / unidades de mapa) a pintar como overlay
   *  temporal antes de aplicar una subdivisión. */
  rings: Pt[][] | null;
  setRings: (rings: Pt[][] | null) => void;
  clear: () => void;
};

export const useSubdivisionPreviewStore = create<SubdivisionPreviewState>()((set) => ({
  rings: null,
  setRings: (rings) => set({ rings }),
  clear: () => set({ rings: null }),
}));