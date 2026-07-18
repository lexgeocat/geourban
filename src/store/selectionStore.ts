import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { GeoUrbanFeatureKind } from '../core/objectModel';

/* ================================================================
   SELECTION STORE (Fase 4 — Selection Engine avanzada)
   ================================================================
   Mantiene el set de features seleccionadas (por id OL), el id del
   highlight source, el modo de selección (click/rect/lasso) y los
   filtros por `kind` que acotan qué tipos son elegibles al
   seleccionar por rectángulo o lazo.
   ================================================================ */

/** Modo de selección dentro del modo "select" general. */
export type SelectMode = 'click' | 'rect' | 'lasso';

/** Set serializado como objeto (inmutable-friendly en immer). */
type KindFilter = Record<GeoUrbanFeatureKind, boolean>;

const ALL_KINDS: GeoUrbanFeatureKind[] = [
  'lote',
  'manzana',
  'calle',
  'equipamiento',
  'area_verde',
  'linea',
  'texto',
  'cota',
];

function allKindsEnabled(): KindFilter {
  const o: Partial<KindFilter> = {};
  for (const k of ALL_KINDS) o[k] = true;
  return o as KindFilter;
}

type SelectionState = {
  /** Set de ids (string | number) de features seleccionadas en drawSource */
  selectedIds: Set<string | number>;
  /** Ultimo id seleccionado (para que la UI resalte el "primario") */
  primaryId: string | number | null;
  /** Sub-modo de selección: click (default) | rect (drag-box) | lasso (polígono libre) */
  selectMode: SelectMode;
  /** Filtro por `kind` — al menos uno tiene que estar activo. Si todos
   *  están en `true`, el filtro es no-op (todas las kinds pasan). */
  kindFilter: KindFilter;
  /** UI: panel de filtros visible */
  filterPanelVisible: boolean;

  setSelection: (ids: ArrayLike<string | number>, primary?: string | number | null) => void;
  add: (id: string | number) => void;
  remove: (id: string | number) => void;
  toggle: (id: string | number, additive?: boolean) => void;
  clear: () => void;
  has: (id: string | number) => boolean;
  count: () => number;

  setSelectMode: (m: SelectMode) => void;
  setKindEnabled: (k: GeoUrbanFeatureKind, enabled: boolean) => void;
  toggleKind: (k: GeoUrbanFeatureKind) => void;
  setAllKinds: (enabled: boolean) => void;
  /** Devuelve true si el kind está habilitado en el filtro. */
  isKindEnabled: (k: GeoUrbanFeatureKind) => boolean;
  setFilterPanelVisible: (v: boolean) => void;
  /** Test helper: ¿este id está seleccionado? (true si está en `selectedIds`) */
};

export const useSelectionStore = create<SelectionState>()(
  immer((set, get) => ({
    selectedIds: new Set<string | number>(),
    primaryId: null,
    selectMode: 'click',
    kindFilter: allKindsEnabled(),
    filterPanelVisible: false,

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
    setKindEnabled: (k, enabled) =>
      set((state) => {
        state.kindFilter[k] = enabled;
        // Si todos quedaron en false, los re-prendemos a true (no podemos
        // dejar al usuario sin poder seleccionar nada desde el filtro).
        const any = Object.values(state.kindFilter).some((v) => v);
        if (!any) state.kindFilter[k] = true;
      }),
    toggleKind: (k) =>
      set((state) => {
        state.kindFilter[k] = !state.kindFilter[k];
        const any = Object.values(state.kindFilter).some((v) => v);
        if (!any) state.kindFilter[k] = true;
      }),
    setAllKinds: (enabled) =>
      set((state) => {
        const o: Partial<KindFilter> = {};
        for (const k of ALL_KINDS) o[k] = enabled;
        state.kindFilter = o as KindFilter;
      }),
    isKindEnabled: (k) => get().kindFilter[k] !== false,
    setFilterPanelVisible: (v) =>
      set((state) => {
        state.filterPanelVisible = v;
      }),
  }))
);

export const ALL_FEATURE_KINDS = ALL_KINDS;
