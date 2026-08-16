import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { createIdCounter, nextEntityName, renumberEntityNames } from './roadEntityStore';

export interface Street {
  id: string;
  start: [number, number];
  end: [number, number];
  widthM: number;
  sideWidthM: number;
  waypoints?: Array<[number, number]>;
  name: string;
  layerId?: string;
}

interface StreetState {
  streets: Street[];
  defaultWidthM: number;
  defaultSideWidthM: number;

  addStreet: (
    street: Omit<Street, 'id' | 'name' | 'sideWidthM'> & { sideWidthM?: number }
  ) => string;
  addStreetWithId: (id: string, street: Omit<Street, 'id' | 'name'>) => void;
  updateStreet: (id: string, patch: Partial<Omit<Street, 'id'>>) => void;
  removeStreet: (id: string) => void;
  clearStreets: () => void;
  setDefaultWidth: (w: number) => void;
  setDefaultSideWidth: (w: number) => void;
}

const streetIdCounter = createIdCounter();

function clampStreetParams<T extends Partial<Omit<Street, 'id' | 'name'>>>(p: T): T {
  const next = { ...p };
  if (next.widthM != null) next.widthM = Math.max(0.5, next.widthM);
  return next;
}

export const useStreetStore = create<StreetState>()(
  immer((set) => ({
    streets: [],
    defaultWidthM: 8,
    defaultSideWidthM: 2,

    addStreet: (street) => {
      let newId = '';
      set((state) => {
        const id = streetIdCounter.next('street-');
        newId = id;
        const name = nextEntityName(state.streets.length, 'Vía');
        state.streets.push({
          ...clampStreetParams(street),
          sideWidthM: street.sideWidthM ?? state.defaultSideWidthM,
          id,
          name,
        });
      });
      return newId;
    },

    addStreetWithId: (id, street) =>
      set((state) => {
        if (state.streets.some((s) => s.id === id)) return;
        const name = nextEntityName(state.streets.length, 'Vía');
        state.streets.push({ ...street, id, name });
      }),

    updateStreet: (id, patch) =>
      set((state) => {
        const street = state.streets.find((s) => s.id === id);
        if (!street) return;
        Object.assign(street, clampStreetParams(patch));
      }),

    removeStreet: (id) =>
      set((state) => {
        state.streets = state.streets.filter((s) => s.id !== id);
        renumberEntityNames(state.streets, 'Vía');
      }),

    clearStreets: () =>
      set((state) => {
        state.streets = [];
        streetIdCounter.reset();
      }),

    setDefaultWidth: (w) =>
      set((state) => {
        state.defaultWidthM = Math.max(0.5, w);
      }),

    setDefaultSideWidth: (w) =>
      set((state) => {
        state.defaultSideWidthM = Math.max(0, w);
      }),
  }))
);
