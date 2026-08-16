import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type LeftSidebarTab = 'manzanos' | 'vias' | 'rotondas';

const PANEL_WIDTH_MIN = 220;
const PANEL_WIDTH_MAX = 520;
const PANEL_WIDTH_DEFAULT = 320;

function clampPanelWidth(w: number): number {
  if (!Number.isFinite(w)) return PANEL_WIDTH_DEFAULT;
  return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.round(w)));
}

type LeftSidebarState = {
  activeTab: LeftSidebarTab | null;
  panelWidth: number;
  setActiveTab: (tab: LeftSidebarTab | null) => void;
  openTab: (tab: LeftSidebarTab) => void;
  toggleTab: (tab: LeftSidebarTab) => void;
  setPanelWidth: (w: number) => void;
};

export const useLeftSidebarStore = create<LeftSidebarState>()(
  persist(
    (set, get) => ({
      activeTab: null,
      panelWidth: PANEL_WIDTH_DEFAULT,
      setActiveTab: (tab) => set({ activeTab: tab }),
      openTab: (tab) => set({ activeTab: tab }),
      toggleTab: (tab) => set({ activeTab: get().activeTab === tab ? null : tab }),
      setPanelWidth: (w) => set({ panelWidth: clampPanelWidth(w) }),
    }),
    {
      name: 'geourban.leftSidebar.v1',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (state: unknown, _fromVersion: number) => {
        if (!state || typeof state !== 'object') return { activeTab: null, panelWidth: PANEL_WIDTH_DEFAULT };
        const s = state as Partial<LeftSidebarState>;
        return {
          activeTab: typeof s.activeTab === 'string' || s.activeTab === null ? s.activeTab : null,
          panelWidth: clampPanelWidth(typeof s.panelWidth === 'number' ? s.panelWidth : PANEL_WIDTH_DEFAULT),
        };
      },
    },
  ),
);

export const LEFT_SIDEBAR_LIMITS = {
  min: PANEL_WIDTH_MIN,
  max: PANEL_WIDTH_MAX,
  default: PANEL_WIDTH_DEFAULT,
} as const;
