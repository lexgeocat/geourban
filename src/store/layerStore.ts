import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BaseMapId } from '../map/baseMaps';

type WorkLayerKey = 'lots' | 'streets' | 'measurements';
type BaseLayerKey = 'gridSnap';
type PanelKey = 'properties';

type LayerState = {
  baseMap: BaseMapId;
  workVisibility: Record<WorkLayerKey, boolean>;
  baseVisibility: Record<BaseLayerKey, boolean>;
  panelVisibility: Record<PanelKey, boolean>;
  gridOrigin: [number, number];
  statsPanelVisible: boolean;
  setBaseMap: (id: BaseMapId) => void;
  setWorkVisibility: (key: WorkLayerKey, visible: boolean) => void;
  setBaseVisibility: (key: BaseLayerKey, visible: boolean) => void;
  setPanelVisibility: (key: PanelKey, visible: boolean) => void;
  setGridOrigin: (o: [number, number]) => void;
  setStatsPanelVisible: (v: boolean) => void;
};

export const useLayerStore = create<LayerState>()(
  immer((set) => ({
    baseMap: 'cad' as BaseMapId,
    workVisibility: {
      lots: true,
      streets: true,
      measurements: true,
    },
    baseVisibility: {
      gridSnap: true,
    },
    panelVisibility: {
      properties: false,
    },
    gridOrigin: [0, 0],
    statsPanelVisible: false,
    setBaseMap: (id) =>
      set((state) => {
        state.baseMap = id;
      }),
    setWorkVisibility: (key, visible) =>
      set((state) => {
        state.workVisibility[key] = visible;
      }),
    setBaseVisibility: (key, visible) =>
      set((state) => {
        state.baseVisibility[key] = visible;
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
  }))
);

