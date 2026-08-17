import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useLeftSidebarStore } from '@app-shell/store/leftSidebarStore';

export type DrawMode =
  | 'select'
  | 'polygon'
  | 'rectangle'
  | 'line'
  | 'polyline'
  | 'circle'
  | 'point'
  | 'street'
  | 'roundabout'
  | 'erase'
  | 'edit'
  | 'splitFeature' // NEW: herramienta "Dividir" (Split Features) estilo QGIS/ArcGIS
  | 'labelOrder'
  | 'none';

type DrawState = {
  mode: DrawMode;
  lastDrawnLineId: string | number | null;
  setMode: (mode: DrawMode) => void;
  setLastDrawnLineId: (id: string | number | null) => void;
};

export const useDrawStore = create<DrawState>()(
  immer((set) => ({
    mode: 'select',
    lastDrawnLineId: null,

    setMode: (mode) => {
      if (mode === 'street') useLeftSidebarStore.getState().openTab('vias');
      if (mode === 'roundabout') useLeftSidebarStore.getState().openTab('rotondas');
      set((state) => {
        state.mode = mode;
      });
    },

    setLastDrawnLineId: (id) =>
      set((state) => {
        state.lastDrawnLineId = id;
      }),
  }))
);
