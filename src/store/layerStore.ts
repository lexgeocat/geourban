import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BaseMapId } from '../map/baseMaps';

type LayerKey = 'measurements' | 'gridSnap';

type LayerState = {
  baseMap: BaseMapId;
  visibility: Record<LayerKey, boolean>;
  gridOrigin: [number, number];
  statsPanelVisible: boolean;
  setBaseMap: (id: BaseMapId) => void;
  setVisibility: (key: LayerKey, visible: boolean) => void;
  setGridOrigin: (o: [number, number]) => void;
  setStatsPanelVisible: (v: boolean) => void;
};

export const useLayerStore = create<LayerState>()(
  immer((set) => ({
    baseMap: 'cad' as BaseMapId,
    visibility: {
      measurements: true,
      gridSnap: true,
    },
    gridOrigin: [0, 0],
    statsPanelVisible: false,
    setBaseMap: (id) =>
      set((state) => {
        state.baseMap = id;
      }),
    setVisibility: (key, visible) =>
      set((state) => {
        state.visibility[key] = visible;
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

