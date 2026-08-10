// src/vias-engine/store/roundaboutStore.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { RoundaboutParams } from '../geometry/roundaboutEngine';
import { createIdCounter, nextEntityName, renumberEntityNames } from './roadEntityStore';

export interface Roundabout extends RoundaboutParams {
  id: string;
  name: string;
}

interface RoundaboutState {
  roundabouts: Roundabout[];
  defaultRadiusM: number;
  defaultSides: number;
  defaultRoadWidthM: number;
  defaultSidewalkWidthM: number;

  addRoundabout: (r: RoundaboutParams) => string;
  addRoundaboutWithId: (id: string, r: RoundaboutParams) => void;
  updateRoundabout: (id: string, patch: Partial<RoundaboutParams>) => void;
  removeRoundabout: (id: string) => void;
  clearRoundabouts: () => void;

  setDefaultRadius: (v: number) => void;
  setDefaultSides: (v: number) => void;
  setDefaultRoadWidth: (v: number) => void;
  setDefaultSidewalkWidth: (v: number) => void;
}

const roundaboutIdCounter = createIdCounter();

export const useRoundaboutStore = create<RoundaboutState>()(
  immer((set) => ({
    roundabouts: [],

    defaultRadiusM: 12,
    defaultSides: 0,
    defaultRoadWidthM: 8,
    defaultSidewalkWidthM: 2,

    addRoundabout: (r) => {
      let newId = '';
      set((state) => {
        const id = roundaboutIdCounter.next('roundabout-');
        newId = id;
        state.roundabouts.push({ ...r, id, name: nextEntityName(state.roundabouts.length, 'Rotonda') });
      });
      return newId;
    },

    addRoundaboutWithId: (id, r) =>
      set((state) => {
        if (state.roundabouts.some((x) => x.id === id)) return;
        state.roundabouts.push({ ...r, id, name: nextEntityName(state.roundabouts.length, 'Rotonda') });
      }),

    updateRoundabout: (id, patch) =>
      set((state) => {
        const rb = state.roundabouts.find((r) => r.id === id);
        if (rb) Object.assign(rb, patch);
      }),

    removeRoundabout: (id) =>
      set((state) => {
        state.roundabouts = state.roundabouts.filter((r) => r.id !== id);
        renumberEntityNames(state.roundabouts, 'Rotonda');
      }),

    clearRoundabouts: () =>
      set((state) => {
        state.roundabouts = [];
        roundaboutIdCounter.reset();
      }),

    setDefaultRadius: (v) =>
      set((state) => {
        state.defaultRadiusM = Math.max(1, v);
      }),
    setDefaultSides: (v) =>
      set((state) => {
        state.defaultSides = v;
      }),
    setDefaultRoadWidth: (v) =>
      set((state) => {
        state.defaultRoadWidthM = Math.max(1, v);
      }),
    setDefaultSidewalkWidth: (v) =>
      set((state) => {
        state.defaultSidewalkWidthM = Math.max(0, v);
      }),
  }))
);
