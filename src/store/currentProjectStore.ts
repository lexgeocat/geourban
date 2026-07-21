import { create } from 'zustand';

type CurrentProjectState = {
  /** id del proyecto abierto en el navegador (Tauri desktop). null en web. */
  currentProjectId: number | null;
  setCurrentProjectId: (id: number | null) => void;
};

export const useCurrentProjectStore = create<CurrentProjectState>((set) => ({
  currentProjectId: null,
  setCurrentProjectId: (id) => set({ currentProjectId: id }),
}));
