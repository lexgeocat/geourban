import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

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
  visible: boolean;
  panelVisible: boolean;

  addStreet: (
    street: Omit<Street, 'id' | 'name' | 'sideWidthM'> & { sideWidthM?: number }
  ) => string;
  addStreetWithId: (id: string, street: Omit<Street, 'id' | 'name'>) => void;
  updateStreet: (id: string, patch: Partial<Omit<Street, 'id'>>) => void;
  removeStreet: (id: string) => void;
  clearStreets: () => void;
  setDefaultWidth: (w: number) => void;
  setDefaultSideWidth: (w: number) => void;
  setVisible: (v: boolean) => void;
  setPanelVisible: (v: boolean) => void;
}

let nextId = 1;

function resetNextId(): void {
  nextId = 1;
}

function autoName(index: number): string {
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
    defaultSideWidthM: 2,
    visible: true,
    panelVisible: false,

    addStreet: (street) => {
      let newId = '';
      const widthM = Math.max(0.5, street.widthM);
      set((state) => {
        const id = `street-${nextId++}`;
        newId = id;
        const name = autoName(state.streets.length);
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
        const name = autoName(state.streets.length);
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
        state.streets.forEach((s, i) => { s.name = autoName(i); });
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

    setVisible: (v) =>
      set((state) => {
        state.visible = v;
      }),

    setPanelVisible: (v) =>
      set((state) => {
        state.panelVisible = v;
      }),
  }))
);
