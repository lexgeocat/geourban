import { create } from 'zustand';
import type { SnapResult } from '../../map/advancedSnap';

type SnapLiveState = {
  active: SnapResult | null;
  setActive: (result: SnapResult | null) => void;
};

export const useSnapLiveStore = create<SnapLiveState>()((set) => ({
  active: null,
  setActive: (result) => set({ active: result }),
}));
