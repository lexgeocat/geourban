import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BaseMapId } from '@map-core/baseMaps';

type PanelKey = 'properties';

export type WorkspaceViewId = 'map' | 'layout';
export type MapRibbonTabId = 'map' | 'edit' | 'view';
export type LayoutRibbonTabId = 'layout-design' | 'layout-elements';
export type RibbonTabId = MapRibbonTabId | LayoutRibbonTabId;

type UiShellState = {
  baseMap: BaseMapId;
  panelVisibility: Record<PanelKey, boolean>;
  statsPanelVisible: boolean;
  workspaceView: WorkspaceViewId;
  layoutModalOpen: boolean;
  activeTab: RibbonTabId;
  mapActiveTab: MapRibbonTabId;
  layoutActiveTab: LayoutRibbonTabId;
  ribbonCollapsed: boolean;
  setBaseMap: (id: BaseMapId) => void;
  setPanelVisibility: (key: PanelKey, visible: boolean) => void;
  setStatsPanelVisible: (v: boolean) => void;
  setWorkspaceView: (view: WorkspaceViewId) => void;
  setLayoutModalOpen: (v: boolean) => void;
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
    workspaceView: 'map',
    layoutModalOpen: false,
    activeTab: 'map',
    mapActiveTab: 'map',
    layoutActiveTab: 'layout-design',
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

    setWorkspaceView: (view) =>
      set((state) => {
        state.workspaceView = view;
        state.layoutModalOpen = view === 'layout';
        state.activeTab = view === 'layout' ? state.layoutActiveTab : state.mapActiveTab;
      }),

    setLayoutModalOpen: (v) =>
      set((state) => {
        const nextView: WorkspaceViewId = v ? 'layout' : 'map';
        state.workspaceView = nextView;
        state.layoutModalOpen = v;
        state.activeTab = nextView === 'layout' ? state.layoutActiveTab : state.mapActiveTab;
      }),

    setActiveTab: (id) =>
      set((state) => {
        state.activeTab = id;
        if (id === 'layout-design' || id === 'layout-elements') {
          state.layoutActiveTab = id;
        } else {
          state.mapActiveTab = id;
        }
      }),

    setRibbonCollapsed: (v) =>
      set((state) => {
        state.ribbonCollapsed = v;
      }),
  }))
);
