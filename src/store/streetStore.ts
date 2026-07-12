import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/**
 * Store de calles — modelo de datos portado de LOTES_SAI.
 *
 * Una calle es un segmento definido por start/end (coordenadas EPSG:3857)
 * con un ancho en metros y un nombre auto-generado.
 * El motor de calles usa estos datos para:
 *  - Recortar manzanos (applyStreetToLots con clipHalfPlane)
 *  - Renderizar ejes punteados, bordes sólidos con fillets
 *  - Mostrar etiquetas de nombre y ancho de vía
 */

export interface Street {
  id: string;
  start: [number, number];
  end: [number, number];
  widthM: number;
  name: string;
}

interface StreetState {
  streets: Street[];
  defaultWidthM: number;
  visible: boolean;

  addStreet: (street: Omit<Street, 'id' | 'name'>) => string;
  updateStreet: (id: string, patch: Partial<Omit<Street, 'id'>>) => void;
  removeStreet: (id: string) => void;
  clearStreets: () => void;
  setDefaultWidth: (w: number) => void;
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

    setVisible: (v) =>
      set((state) => {
        state.visible = v;
      }),
  }))
);
