import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type DrawMode =
  | 'select'
  | 'polyline'   // legado: dibuja polígono cerrado (atajo P)
  | 'polygon'    // dibuja polígono cerrado (atajo P, recomendado)
  | 'line'       // dibuja polilínea abierta (atajo L)
  | 'rectangle'  // dibuja rectángulo por 2 esquinas (atajo R)
  | 'circle'     // dibuja círculo por centro+radio (atajo C)
  | 'arc'        // dibuja arco de 3 puntos (atajo A)
  | 'text'       // inserta texto (atajo T — reasignado de street; ver Toolbar)
  | 'street'     // traza calle de 2 puntos (atajo S)
  | 'erase'
  | 'edit'
  | 'none';

type DrawState = {
  mode: DrawMode;
  /** Id de la última línea dibujada — la usa subdivision "manual-slice". */
  lastDrawnLineId: string | number | null;
  setMode: (mode: DrawMode) => void;
  setLastDrawnLineId: (id: string | number | null) => void;
};

export const useDrawStore = create<DrawState>()(
  immer((set) => ({
    mode: 'select',
    lastDrawnLineId: null,
    setMode: (mode) =>
      set((state) => {
        state.mode = mode;
      }),
    setLastDrawnLineId: (id) =>
      set((state) => {
        state.lastDrawnLineId = id;
      }),
  }))
);
