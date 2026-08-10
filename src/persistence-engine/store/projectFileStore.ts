import { create } from 'zustand';

interface ProjectFileState {
  currentName: string | null;
  busy: boolean;
  saveModalOpen: boolean;
  openModalOpen: boolean;
  setCurrentName: (name: string | null) => void;
  setBusy: (v: boolean) => void;
  setSaveModalOpen: (v: boolean) => void;
  setOpenModalOpen: (v: boolean) => void;
}

export const useProjectFileStore = create<ProjectFileState>()((set) => ({
  currentName: null,
  busy: false,
  saveModalOpen: false,
  openModalOpen: false,
  setCurrentName: (name) => set({ currentName: name }),
  setBusy: (v) => set({ busy: v }),
  setSaveModalOpen: (v) => set({ saveModalOpen: v }),
  setOpenModalOpen: (v) => set({ openModalOpen: v }),
}));