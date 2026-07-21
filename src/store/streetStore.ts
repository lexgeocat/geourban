import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface Street {
  id: string;
  start: [number, number];
  end: [number, number];
  widthM: number;
  /** Ancho de vereda (acera) en metros, fijado al trazar la calle. */
  sideWidthM: number;
  waypoints?: Array<[number, number]>;
  name: string;
}

interface StreetState {
  streets: Street[];
  defaultWidthM: number;
  /** Ancho de vereda por defecto para las próximas calles trazadas. */
  defaultSideWidthM: number;
  visible: boolean;

  addStreet: (
    street: Omit<Street, 'id' | 'name' | 'sideWidthM'> & { sideWidthM?: number }
  ) => string;
  /** Re-inserta una calle con un id específico — usado por
   *  AddStreetCommand.redo() para no perder la referencia al id original
   *  entre un undo y su redo. */
  addStreetWithId: (id: string, street: Omit<Street, 'id' | 'name'>) => void;
  updateStreet: (id: string, patch: Partial<Omit<Street, 'id'>>) => void;
  removeStreet: (id: string) => void;
  clearStreets: () => void;
  setDefaultWidth: (w: number) => void;
  setDefaultSideWidth: (w: number) => void;
  setVisible: (v: boolean) => void;
}

let nextId = 1;

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

    addStreet: (street) => {
      let newId = '';
      set((state) => {
        const id = `street-${nextId++}`;
        newId = id;
        const name = autoName(state.streets.length);
        state.streets.push({
          ...street,
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
        const s = state.streets.find((s) => s.id === id);
        if (s) Object.assign(s, patch);
      }),

    removeStreet: (id) =>
      set((state) => {
        state.streets = state.streets.filter((s) => s.id !== id);
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

    setDefaultSideWidth: (w) =>
      set((state) => {
        state.defaultSideWidthM = Math.max(0, w);
      }),

    setVisible: (v) =>
      set((state) => {
        state.visible = v;
      }),
  }))
);
