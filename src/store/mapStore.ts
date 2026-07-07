import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import Map from 'ol/Map';

type CursorCoords = { x: number; y: number } | null;

type MapState = {
  mapInstance: Map | null;
  cursorCoords: CursorCoords;
  zoom: number;
  setMap: (map: Map | null) => void;
  setCursorCoords: (coords: CursorCoords) => void;
  setZoom: (zoom: number) => void;
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
