import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import Map from 'ol/Map';
import { extend as extendExtent, Extent } from 'ol/extent';

type CursorCoords = { x: number; y: number } | null;

type MapState = {
  mapInstance: Map | null;
  cursorCoords: CursorCoords;
  zoom: number;
  setMap: (map: Map | null) => void;
  setCursorCoords: (coords: CursorCoords) => void;
  setZoom: (zoom: number) => void;
  fitToExtent: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

export const useMapStore = create<MapState>()(
  immer((set, get) => ({
    mapInstance: null,
    cursorCoords: null,
    zoom: 2,
    setMap: (map) =>
      set((state) => {
        // @ts-ignore – immer draft vs OL class instance
        state.mapInstance = map;
      }),
    setCursorCoords: (coords) =>
      set((state) => {
        // @ts-ignore
        state.cursorCoords = coords;
      }),
    setZoom: (zoom) =>
      set((state) => {
        state.zoom = zoom;
      }),
    fitToExtent: () => {
      const map = get().mapInstance;
      if (!map) return;
      // Itera todas las capas vectoriales y calcula el extent combinado
      const layers = map.getLayers().getArray();
      let fullExtent: Extent | null = null;
      for (const layer of layers) {
        const src = (layer as any).getSource?.();
        if (!src || typeof src.getExtent !== 'function') continue;
        const ext = src.getExtent();
        if (!ext || ext[0] === Infinity || ext[0] === -Infinity) continue;
        if (!fullExtent) fullExtent = [...ext] as Extent;
        else extendExtent(fullExtent, ext);
      }
      if (fullExtent) {
        map.getView().fit(fullExtent, { size: map.getSize(), maxZoom: 18, padding: [40, 40, 40, 40] });
      }
    },
    zoomIn: () => {
      const map = get().mapInstance;
      if (!map) return;
      const view = map.getView();
      const z = view.getZoom();
      if (z !== undefined) view.animate({ zoom: z + 1, duration: 200 });
    },
    zoomOut: () => {
      const map = get().mapInstance;
      if (!map) return;
      const view = map.getView();
      const z = view.getZoom();
      if (z !== undefined) view.animate({ zoom: z - 1, duration: 200 });
    },
  }))
);
