import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import Map from 'ol/Map';
import { Extent } from 'ol/extent';

type MapState = {
  mapInstance: Map | null;
  setMap: (map: Map | null) => void;
  fitPolygonsLayer: () => void;
};

export const useMapStore = create<MapState>()(
  immer((set) => ({
    mapInstance: null,
    setMap: (map) =>
      set((state) => {
        state.mapInstance = map;
      }),
    fitPolygonsLayer: () => {
      set((state) => {
        const map = state.mapInstance;
        if (!map) return;
        const polygonsLayer = map.getLayers().item(2);
        if (!polygonsLayer) return;
        // @ts-ignore – WebGLVectorLayer has getSource()
        const source = (polygonsLayer as any).getSource();
        const extent = source.getExtent();
        const view = map.getView();
        view.fit(extent, { size: map.getSize(), maxZoom: 10, padding: [20, 20, 20, 20] });
      });
    },
  }))
);
