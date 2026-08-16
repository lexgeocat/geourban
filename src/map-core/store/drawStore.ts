import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { useLeftSidebarStore } from '@app-shell/store/leftSidebarStore';

export type DrawMode =
  | 'select'
  | 'polygon' // Perímetro/Manzana/Lote — polígono libre
  | 'rectangle' // Perímetro/Manzana/Lote — rectángulo (drag)
  | 'line' // Línea normal (segmento simple, 2 puntos)
  | 'polyline' // Polilínea normal (multi-vértice)
  | 'circle' // Círculo normal (no vial)
  | 'point' // Punto normal
  | 'street' // Línea de vía (eje segmentado) — modo dominio
  | 'roundabout' // Círculo de rotonda (2 clics: centro → radio) — modo dominio
  | 'erase' // Borrar seleccionados
  | 'edit' // Edición de vértices de la selección
  | 'labelOrder' // Trazado de línea para ordenar etiquetas de manzanos/lotes/capa
  | 'none'; // Sin herramienta activa (UI state)

type DrawState = {
  mode: DrawMode;
  lastDrawnLineId: string | number | null;

  /* ----- Mutations ----- */
  setMode: (mode: DrawMode) => void;
  setLastDrawnLineId: (id: string | number | null) => void;
};

export const useDrawStore = create<DrawState>()(
  immer((set) => ({
    mode: 'select',
    lastDrawnLineId: null,

    setMode: (mode) => {
      if (mode === 'street') useLeftSidebarStore.getState().openTab('vias');
      if (mode === 'roundabout') useLeftSidebarStore.getState().openTab('rotondas');
      set((state) => {
        state.mode = mode;
      });
    },

    setLastDrawnLineId: (id) =>
      set((state) => {
        state.lastDrawnLineId = id;
      }),
  }))
);
