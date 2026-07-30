import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useStreetStore } from '../entities/streetStore';
import { useRoundaboutStore } from '../entities/roundaboutStore';

export type DrawMode =
  | 'select'
  | 'polygon'    // Previously 'polyline' - keep for backwards compatibility
  | 'line'       // Open polyline (drag mouse to draw)
  | 'rectangle'  // Rectangle via OL's built-in draw type
  | 'street' // Street axis (segmented line)
  | 'roundabout' // Rotonda: 2 clics (centro → radio)
  | 'erase'      // Delete selected features
  | 'edit'       // Enter vertex editing mode (modify selected geometry)
  | 'none';       // No tool selected (for UI state)

/** Tipo de feature que se creará al dibujar un polígono */
export type DrawKind = 'lote' | 'equipamiento';

type DrawState = {
  mode: DrawMode;
  areaKind: DrawKind;
  lastDrawnLineId: string | number | null;

  /* ----- Mutations ----- */
  setMode: (mode: DrawMode) => void;
  setLastDrawnLineId: (id: string | number | null) => void;
  setAreaKind: (kind: DrawKind) => void;

  /* ----- Queries ----- */
  getCanDraw?: () => boolean;
  getIsToolActive?: (tool: DrawMode) => boolean;
};

export const useDrawStore = create<DrawState>()(
  immer((set, get) => ({
    mode: 'select',
    areaKind: 'lote', // Por defecto se crean lotes
    lastDrawnLineId: null,

    setMode: (mode) => {
      if (mode === 'street') useStreetStore.getState().setPanelVisible(true);
      if (mode === 'roundabout') useRoundaboutStore.getState().setPanelVisible(true);
      set((state) => {
        state.mode = mode;
      });
    },

    setLastDrawnLineId: (id) =>
      set((state) => {
        state.lastDrawnLineId = id;
      }),

    setAreaKind: (kind) =>
      set((state) => {
        state.areaKind = kind;
      }),

    /* Helper queries - added for UI component compatibility */
    getCanDraw: () => {
      return !['select', 'edit', 'none'].includes(get().mode);
    },

    getIsToolActive: (tool) => {
      return get().mode === tool;
    },
  }))
);