import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type LeftSidebarTab = 'manzanos' | 'vias' | 'rotondas';

type LeftSidebarState = {
  activeTab: LeftSidebarTab | null;
  setActiveTab: (tab: LeftSidebarTab | null) => void;
  openTab: (tab: LeftSidebarTab) => void;
  toggleTab: (tab: LeftSidebarTab) => void;
};

export const useLeftSidebarStore = create<LeftSidebarState>()(
  persist(
    (set, get) => ({
      activeTab: null,
      setActiveTab: (tab) => set({ activeTab: tab }),
      openTab: (tab) => set({ activeTab: tab }),
      toggleTab: (tab) => set({ activeTab: get().activeTab === tab ? null : tab }),
    }),
    {
      name: 'geourban.leftSidebar.v1',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);