import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface Street {
  id: string;
  start: [number, number];
  end: [number, number];
  widthM: number;
  curvature?: number; // override fillet radius in meters (0 = use default table)
  waypoints?: Array<[number, number]>; // intermediate points for curved streets
  name: string;
}

interface StreetState {
  streets: Street[];
  defaultWidthM: number;
  defaultCurvatureM: number; // 0 = use angle-based default table
  visible: boolean;

  addStreet: (street: Omit<Street, 'id' | 'name'>) => string;
  updateStreet: (id: string, patch: Partial<Omit<Street, 'id'>>) => void;
  removeStreet: (id: string) => void;
  clearStreets: () => void;
  setDefaultWidth: (w: number) => void;
  setDefaultCurvature: (r: number) => void;
  setVisible: (v: boolean) => void;
}

let nextId = 1;

function autoName(index: number): string {
  // Calle A, Calle B, ... Calle Z, Calle AA, Calle AB, ...
  let name = '';
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Calle ${name}`;
}

export const useStreetStore = create<StreetState>()(
  immer((set) => ({
    streets: [],
    defaultWidthM: 8,
    defaultCurvatureM: 0,
    visible: true,

    addStreet: (street) => {
      let newId = '';
      set((state) => {
        const id = `street-${nextId++}`;
        newId = id;
        const name = autoName(state.streets.length);
        state.streets.push({ ...street, id, name });
      });
      return newId;
    },

    updateStreet: (id, patch) =>
      set((state) => {
        const s = state.streets.find((s) => s.id === id);
        if (s) Object.assign(s, patch);
      }),

    removeStreet: (id) =>
      set((state) => {
        state.streets = state.streets.filter((s) => s.id !== id);
        // Re-number names
        state.streets.forEach((s, i) => { s.name = autoName(i); });
      }),

    clearStreets: () =>
      set((state) => {
        state.streets = [];
      }),

    setDefaultWidth: (w) =>
      set((state) => {
        state.defaultWidthM = w;
      }),

    setDefaultCurvature: (r) =>
      set((state) => {
        state.defaultCurvatureM = r;
      }),

    setVisible: (v) =>
      set((state) => {
        state.visible = v;
      }),
  }))
);
