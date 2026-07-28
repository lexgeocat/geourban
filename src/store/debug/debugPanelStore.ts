import { create } from 'zustand';

type DebugPanelState = {
  open: boolean;
  toggle: () => void;
  setOpen: (v: boolean) => void;
};

export const useDebugPanelStore = create<DebugPanelState>()((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (v) => set({ open: v }),
}));