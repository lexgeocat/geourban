import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/* ================================================================
   SELECTION STORE
   ================================================================
   Mantiene el set de features seleccionadas (por id OL) y el id del
   highlight source. Es la fuente de verdad para la seleccion; los
   consumers (Toolbar, Map, PropertyPanel futuro) se suscriben aqui.
   ================================================================ */

type SelectionState = {
  /** Set de ids (string | number) de features seleccionadas en drawSource */
  selectedIds: Set<string | number>;
  /** Ultimo id seleccionado (para que la UI resalte el "primario") */
  primaryId: string | number | null;

  setSelection: (ids: ArrayLike<string | number>, primary?: string | number | null) => void;
  add: (id: string | number) => void;
  remove: (id: string | number) => void;
  toggle: (id: string | number, additive?: boolean) => void;
  clear: () => void;
  has: (id: string | number) => boolean;
  count: () => number;
};

export const useSelectionStore = create<SelectionState>()(
  immer((set, get) => ({
    selectedIds: new Set<string | number>(),
    primaryId: null,

    setSelection: (ids, primary = null) =>
      set((state) => {
        state.selectedIds = new Set(Array.from(ids));
        state.primaryId = primary;
      }),

    add: (id) =>
      set((state) => {
        state.selectedIds.add(id);
        state.primaryId = id;
      }),

    remove: (id) =>
      set((state) => {
        state.selectedIds.delete(id);
        if (state.primaryId === id) {
          const [first] = state.selectedIds;
          state.primaryId = first ?? null;
        }
      }),

    toggle: (id, additive = false) =>
      set((state) => {
        if (state.selectedIds.has(id)) {
          state.selectedIds.delete(id);
          if (state.primaryId === id) {
            const [first] = state.selectedIds;
            state.primaryId = first ?? null;
          }
        } else {
          if (!additive) {
            state.selectedIds.clear();
          }
          state.selectedIds.add(id);
          state.primaryId = id;
        }
      }),

    clear: () =>
      set((state) => {
        state.selectedIds.clear();
        state.primaryId = null;
      }),

    has: (id) => get().selectedIds.has(id),
    count: () => get().selectedIds.size,
  }))
);
