import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { autoName } from '../../lib/autoName';

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

let nextId = 1;

function resetNextId(): void {
  nextId = 1;
}

export const useStreetStore = create<StreetState>()(
  immer((set) => ({
    streets: [],
    defaultWidthM: 8,
    defaultSideWidthM: 2,

    addStreet: (street) => {
      let newId = '';
      const widthM = Math.max(0.5, street.widthM);
      set((state) => {
        const id = `street-${nextId++}`;
        newId = id;
        const name = autoName(state.streets.length, 'Calle');
        state.streets.push({
          ...street,
          widthM,
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
        const name = autoName(state.streets.length, 'Calle');
        state.streets.push({ ...street, id, name });
      }),

    updateStreet: (id, patch) =>
      set((state) => {
        const street = state.streets.find((s) => s.id === id);
        if (!street) return;
        const next = { ...patch };
        if (next.widthM != null) next.widthM = Math.max(0.5, next.widthM);
        Object.assign(street, next);
      }),

    removeStreet: (id) =>
      set((state) => {
        state.streets = state.streets.filter((s) => s.id !== id);
        state.streets.forEach((s, i) => {
          s.name = autoName(i, 'Calle');
        });
      }),

    clearStreets: () =>
      set((state) => {
        state.streets = [];
        resetNextId();
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
