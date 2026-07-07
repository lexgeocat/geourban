import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BaseMapId } from '../map/baseMaps';

type LayerKey = 'demo';

type LayerState = {
  /** Mapa base activo (solo uno a la vez) */
  baseMap: BaseMapId;
  /** Visibilidad de capas adicionales */
  visibility: Record<LayerKey, boolean>;
  setBaseMap: (id: BaseMapId) => void;
  setVisibility: (key: LayerKey, visible: boolean) => void;
};

export const useLayerStore = create<LayerState>()(
  immer((set) => ({
    baseMap: 'osm' as BaseMapId,
    visibility: {
      demo: false,
    },
    setBaseMap: (id) =>
      set((state) => {
        state.baseMap = id;
      }),
    setVisibility: (key, visible) =>
      set((state) => {
        state.visibility[key] = visible;
      }),
  }))
);
