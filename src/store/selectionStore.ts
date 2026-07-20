import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

/** Modo de selección dentro del modo "select" general. */
export type SelectMode = 'click' | 'rect' | 'lasso';

type SelectionState = {
  /** Set de ids (string | number) de features seleccionadas en drawSource */
  selectedIds: Set<string | number>;
  /** Ultimo id seleccionado (para que la UI resalte el "primario") */
  primaryId: string | number | null;
  /** Sub-modo de selección: click (default) | rect (drag-box) | lasso (polígono libre) */
  selectMode: SelectMode;

  setSelection: (ids: ArrayLike<string | number>, primary?: string | number | null) => void;
  add: (id: string | number) => void;
  remove: (id: string | number) => void;
  toggle: (id: string | number, additive?: boolean) => void;
  clear: () => void;
  has: (id: string | number) => boolean;
  count: () => number;

  setSelectMode: (m: SelectMode) => void;
};

export const useSelectionStore = create<SelectionState>()(
  immer((set, get) => ({
    selectedIds: new Set<string | number>(),
    primaryId: null,
    selectMode: 'click',

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

    setSelectMode: (m) =>
      set((state) => {
        state.selectMode = m;
      }),
  }))
);
