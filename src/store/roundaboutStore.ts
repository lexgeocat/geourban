// src/store/roundaboutStore.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { RoundaboutParams } from '../geo/roundaboutEngine';

export interface Roundabout extends RoundaboutParams {
  id: string;
  name: string;
}

interface RoundaboutState {
  roundabouts: Roundabout[];

  /** Parámetros de diseño para la próxima rotonda a trazar. */
  defaultRadiusM: number;
  defaultSides: number;
  defaultRoadWidthM: number;
  defaultSidewalkWidthM: number;

  visible: boolean;
  panelVisible: boolean;

  addRoundabout: (r: RoundaboutParams) => string;
  updateRoundabout: (id: string, patch: Partial<RoundaboutParams>) => void;
  removeRoundabout: (id: string) => void;
  clearRoundabouts: () => void;

  setDefaultRadius: (v: number) => void;
  setDefaultSides: (v: number) => void;
  setDefaultRoadWidth: (v: number) => void;
  setDefaultSidewalkWidth: (v: number) => void;
  setVisible: (v: boolean) => void;
  setPanelVisible: (v: boolean) => void;
}

let nextId = 1;

/** Rotonda A, Rotonda B, ... Rotonda Z, Rotonda AA, ... (mismo criterio que streetStore.autoName) */
function autoName(index: number): string {
  let name = '';
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Rotonda ${name}`;
}

export const useRoundaboutStore = create<RoundaboutState>()(
  immer((set) => ({
    roundabouts: [],

    defaultRadiusM: 12,
    defaultSides: 0,
    defaultRoadWidthM: 8,
    defaultSidewalkWidthM: 2,

    visible: true,
    panelVisible: false,

    addRoundabout: (r) => {
      let newId = '';
      set((state) => {
        const id = `roundabout-${nextId++}`;
        newId = id;
        state.roundabouts.push({ ...r, id, name: autoName(state.roundabouts.length) });
      });
      return newId;
    },

    updateRoundabout: (id, patch) =>
      set((state) => {
        const rb = state.roundabouts.find((r) => r.id === id);
        if (rb) Object.assign(rb, patch);
      }),

    removeRoundabout: (id) =>
      set((state) => {
        state.roundabouts = state.roundabouts.filter((r) => r.id !== id);
        state.roundabouts.forEach((r, i) => { r.name = autoName(i); });
      }),

    clearRoundabouts: () => set((state) => { state.roundabouts = []; }),

    setDefaultRadius: (v) => set((state) => { state.defaultRadiusM = Math.max(1, v); }),
    setDefaultSides: (v) => set((state) => { state.defaultSides = v; }),
    setDefaultRoadWidth: (v) => set((state) => { state.defaultRoadWidthM = Math.max(1, v); }),
    setDefaultSidewalkWidth: (v) => set((state) => { state.defaultSidewalkWidthM = Math.max(0, v); }),
    setVisible: (v) => set((state) => { state.visible = v; }),
    setPanelVisible: (v) => set((state) => { state.panelVisible = v; }),
  })),
);