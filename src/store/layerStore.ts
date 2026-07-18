import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BaseMapId } from '../map/baseMaps';

type WorkLayerKey = 'lots' | 'streets' | 'measurements';
type PanelKey = 'properties';

/** Tabs del ribbon estilo ArcGIS Pro. Cada tab tiene un id y un label. */
export type RibbonTabId = 'map' | 'edit' | 'insert' | 'view';

/** Ids de paneles (subsecciones dentro del ribbon). */
export type RibbonPanelId =
  | 'navigation'
  | 'draw'
  | 'modify'
  | 'edit'
  | 'subdivision'
  | 'layers'
  | 'view';

type LayerState = {
  baseMap: BaseMapId;
  workVisibility: Record<WorkLayerKey, boolean>;
  panelVisibility: Record<PanelKey, boolean>;
  /** Offset de la grilla CAD, usado tanto para render (cadGridLayer) como para gridSnap.ts. */
  gridOrigin: [number, number];
  statsPanelVisible: boolean;
  /** Ribbon state */
  activeTab: RibbonTabId;
  /** Tabs contraídos: solo se ve la franja de tabs (no los paneles). */
  ribbonCollapsed: boolean;
  setBaseMap: (id: BaseMapId) => void;
  setWorkVisibility: (key: WorkLayerKey, visible: boolean) => void;
  setPanelVisibility: (key: PanelKey, visible: boolean) => void;
  setGridOrigin: (o: [number, number]) => void;
  setStatsPanelVisible: (v: boolean) => void;
  setActiveTab: (id: RibbonTabId) => void;
  setRibbonCollapsed: (v: boolean) => void;
};

export const useLayerStore = create<LayerState>()(
  immer((set) => ({
    baseMap: 'cad' as BaseMapId,
    workVisibility: {
      lots: true,
      streets: true,
      measurements: true,
    },
    panelVisibility: {
      properties: false,
    },
    gridOrigin: [0, 0],
    statsPanelVisible: false,
    activeTab: 'map',
    ribbonCollapsed: false,
    setBaseMap: (id) =>
      set((state) => {
        state.baseMap = id;
      }),
    setWorkVisibility: (key, visible) =>
      set((state) => {
        state.workVisibility[key] = visible;
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