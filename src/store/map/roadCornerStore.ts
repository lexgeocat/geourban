import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CornerMode } from '../../geo/roads/ringFillet';

type RoadCornerState = {
  mode: CornerMode;
  setMode: (mode: CornerMode) => void;
};

/** Modo de tratamiento de esquinas de la red vial: 'fillet' (ochave,
 *  arco — default, comportamiento histórico), 'chamfer' (chaflán, corte
 *  recto) o 'none' (esquina tal cual del miter, sin tratamiento). */
export const useRoadCornerStore = create<RoadCornerState>()(
  persist(
    (set) => ({
      mode: 'fillet',
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'geourban.roadCornerMode.v1',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);
