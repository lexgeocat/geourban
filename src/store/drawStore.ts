import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type DrawMode =
  | 'select'
  | 'polygon'    // Previously 'polyline' - keep for backwards compatibility
  | 'line'       // Open polyline (drag mouse to draw)
  | 'rectangle'  // Rectangle via OL's built-in draw type
  | 'circle'     // Circle via OL's built-in draw type
  | 'arc'        // Custom arc (3 points)
  | 'text'       // Text label feature
  | 'cota'       // Manual linear dimension (3 clicks: start → end → offset)
  | 'street'     // Street axis (segmented line)
  | 'rotate'     // Transform selection: rotate angle
  | 'scale'      // Transform selection: scale
  | 'mirror'     // Transform selection: mirror over axis
  | 'erase'      // Delete selected features
  | 'edit'       // Enter vertex editing mode (modify selected geometry)
  | 'none';       // No tool selected (for UI state)

/** Tipo de feature que se creará al dibujar un polígono */
export type DrawKind = 'lote' | 'area_verde' | 'equipamiento';

type DrawState = {
  mode: DrawMode;

  /** Tipo de feature a crear al dibujar (solo afecta a modo 'polygon') */
  areaKind: DrawKind;

  /** Id tracking for drawing features (used in subdivision & exports) */
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

    setMode: (mode) =>
      set((state) => {
        state.mode = mode;
      }),

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