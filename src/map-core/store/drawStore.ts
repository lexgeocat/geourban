import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useLeftSidebarStore } from '@app-shell/store/leftSidebarStore';

export type DrawMode =
  | 'select'
  | 'polygon'    // Previously 'polyline' - keep for backwards compatibility
  | 'line'       // Open polyline (drag mouse to draw)
  | 'rectangle'  // Rectangle via OL's built-in draw type
  | 'street' // Street axis (segmented line)
  | 'roundabout' // Rotonda: 2 clics (centro → radio)
  | 'erase'      // Delete selected features
  | 'edit'       // Enter vertex editing mode (modify selected geometry)
  | 'labelOrder' // Trazado de línea para ordenar etiquetas de manzanos
  | 'none';       // No tool selected (for UI state)

/** Tipo de feature que se creará al dibujar un polígono */

type DrawState = {
  mode: DrawMode;
  lastDrawnLineId: string | number | null;

  /* ----- Mutations ----- */
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