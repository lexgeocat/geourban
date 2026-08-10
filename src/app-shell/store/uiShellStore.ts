import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BaseMapId } from '@map-core/baseMaps';

type PanelKey = 'properties';

/** Tabs del ribbon estilo ArcGIS Pro. Cada tab tiene un id y un label. */
export type RibbonTabId = 'map' | 'edit' | 'view';

type UiShellState = {
  baseMap: BaseMapId;
  panelVisibility: Record<PanelKey, boolean>;
  statsPanelVisible: boolean;
  activeTab: RibbonTabId;
  ribbonCollapsed: boolean;
  setBaseMap: (id: BaseMapId) => void;
  setPanelVisibility: (key: PanelKey, visible: boolean) => void;
  setStatsPanelVisible: (v: boolean) => void;
  setActiveTab: (id: RibbonTabId) => void;
  setRibbonCollapsed: (v: boolean) => void;
};

export const useUiShellStore = create<UiShellState>()(
  immer((set) => ({
    baseMap: 'cad' as BaseMapId,
    panelVisibility: {
      properties: false,
    },
    statsPanelVisible: false,
    activeTab: 'map',
    ribbonCollapsed: false,
    setBaseMap: (id) =>
      set((state) => {
        state.baseMap = id;
      }),
    setPanelVisibility: (key, visible) =>
      set((state) => {
        state.panelVisibility[key] = visible;
      }),
    setStatsPanelVisible: (v) =>
      set((state) => {
        state.statsPanelVisible = v;
      }),
    setActiveTab: (id) =>
      set((state) => {
        state.activeTab = id;
      }),
    setRibbonCollapsed: (v) =>
      set((state) => {
        state.ribbonCollapsed = v;
      }),
  }))
);