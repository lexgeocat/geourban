import { create } from 'zustand';
import type { Pt } from '@kernel/geometry/polygonEngine';

type SubdivisionPreviewState = {
  rings: Pt[][] | null;
  setRings: (rings: Pt[][] | null) => void;
  clear: () => void;
};

export const useSubdivisionPreviewStore = create<SubdivisionPreviewState>()((set) => ({
  rings: null,
  setRings: (rings) => set({ rings }),
  clear: () => set({ rings: null }),
}));