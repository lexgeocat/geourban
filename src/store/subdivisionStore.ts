import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { SubdivisionMethod, SubdivisionOptions } from '../geo/subdivisionAlgorithms';

/* ================================================================
   SUBDIVISION STORE
   ================================================================
   Estado UI de la herramienta de subdivisión: dialog abierto/cerrado,
   método seleccionado, opciones del formulario, polígono target.
   ================================================================ */

type SubdivisionState = {
  isOpen: boolean;
  targetFeatureId: string | number | null;
  method: SubdivisionMethod;
  options: SubdivisionOptions;
  preview: { count: number; warnings: string[] } | null;
  loading: boolean;
  errorMessage: string | null;

  open: (targetFeatureId: string | number, method?: SubdivisionMethod) => void;
  close: () => void;
  setMethod: (m: SubdivisionMethod) => void;
  setOption: <K extends keyof SubdivisionOptions>(k: K, v: SubdivisionOptions[K]) => void;
  setPreview: (p: { count: number; warnings: string[] } | null) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  reset: () => void;
};

const DEFAULT_OPTIONS: SubdivisionOptions = {
  method: 'auto',
  targetAreaM2: 250,
  frontMinM: 12,
};

export const useSubdivisionStore = create<SubdivisionState>()(
  immer((set) => ({
    isOpen: false,
    targetFeatureId: null,
    method: 'auto',
    options: { ...DEFAULT_OPTIONS },
    preview: null,
    loading: false,
    errorMessage: null,

    open: (targetFeatureId, method = 'auto') =>
      set((state) => {
        state.isOpen = true;
        state.targetFeatureId = targetFeatureId;
        state.method = method;
        state.options = { ...DEFAULT_OPTIONS, method };
        state.preview = null;
        state.loading = false;
        state.errorMessage = null;
      }),

    close: () =>
      set((state) => {
        state.isOpen = false;
      }),

    setMethod: (m) =>
      set((state) => {
        state.method = m;
        state.options.method = m;
        state.preview = null;
        state.errorMessage = null;
      }),

    setOption: (k, v) =>
      set((state) => {
        (state.options as any)[k] = v;
        state.preview = null;
        state.errorMessage = null;
      }),

    setPreview: (p) =>
      set((state) => {
        state.preview = p;
      }),

    setLoading: (v) =>
      set((state) => {
        state.loading = v;
      }),

    setError: (msg) =>
      set((state) => {
        state.errorMessage = msg;
        state.loading = false;
      }),

    reset: () =>
      set((state) => {
        state.isOpen = false;
        state.targetFeatureId = null;
        state.method = 'auto';
        state.options = { ...DEFAULT_OPTIONS };
        state.preview = null;
        state.loading = false;
        state.errorMessage = null;
      }),
  }))
);
