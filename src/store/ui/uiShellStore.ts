import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BaseMapId } from '../../map/baseMaps';


type PanelKey = 'properties';


/** Tabs del ribbon estilo ArcGIS Pro. Cada tab tiene un id y un label. */
export type RibbonTabId = 'map' | 'edit' | 'view';


type UiShellState = {
  baseMap: BaseMapId;
  panelVisibility: Record<PanelKey, boolean>;
  /** Offset de la grilla CAD, usado tanto para render (cadGridLayer) como para gridSnap.ts. */
  gridOrigin: [number, number];
  statsPanelVisible: boolean;
  measurementsVisible: boolean;
  /** Ribbon state */
  activeTab: RibbonTabId;
  /** Tabs contraídos: solo se ve la franja de tabs (no los paneles). */
  ribbonCollapsed: boolean;
  setBaseMap: (id: BaseMapId) => void;
  setPanelVisibility: (key: PanelKey, visible: boolean) => void;
  setGridOrigin: (o: [number, number]) => void;
  setStatsPanelVisible: (v: boolean) => void;
  setMeasurementsVisible: (v: boolean) => void;
  setActiveTab: (id: RibbonTabId) => void;
  setRibbonCollapsed: (v: boolean) => void;
};

export const useUiShellStore = create<UiShellState>()(
  immer((set) => ({
    baseMap: 'cad' as BaseMapId,
    panelVisibility: {
      properties: false,
    },
    gridOrigin: [0, 0],
    statsPanelVisible: false,
    measurementsVisible: false, // ← antes true (master switch de cotas)
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
    setGridOrigin: (o) =>
      set((state) => {
        state.gridOrigin = o;
      }),
    setStatsPanelVisible: (v) =>
      set((state) => {
        state.statsPanelVisible = v;
      }),
    setMeasurementsVisible: (v) =>
      set((state) => {
        state.measurementsVisible = v;
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
