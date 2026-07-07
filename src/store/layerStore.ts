import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type LayerKey = 'osm' | 'satellite';

type LayerState = {
  visibility: Record<LayerKey, boolean>;
  setVisibility: (key: LayerKey, visible: boolean) => void;
};

export const useLayerStore = create<LayerState>()(
  immer((set) => ({
    visibility: {
      osm: true,
      satellite: false,
    },
    setVisibility: (key, visible) =>
      set((state) => {
        state.visibility[key] = visible;
      }),
  }))
);
