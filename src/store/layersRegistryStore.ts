import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Layer } from '../core/objectModel';

type LayerState = {
  /** Lista de capas ordenadas por z-index (índice en array = z-index) */
  layers: Layer[];
  /** Índice para búsqueda rápida por id */
  index: Map<string, number>; // id -> posición en array
  /** Capa activa: las features nuevas se asignan a esta */
  activeLayerId: string | null;

  /* ---------- Mutations ---------- */
  /** Añade una nueva capa al final (z-index más alto) */
  add: (layer: Omit<Layer, 'zIndex'>) => void;
  /** Elimina una capa por id */
  remove: (id: string) => void;
  /** Actualiza parcialmente una capa existente */
  update: (patch: Partial<Layer> & { id: string }) => void;
  /** Cambia el orden de una o más capas */
  reorder: (ids: string[], position: number) => void;
  /** Alterna el estado de bloqueo de una capa */
  toggleLock: (id: string) => void;
  /** Alterna el estado de visibilidad de una capa */
  toggleVisibility: (id: string) => void;
  /** Selecciona la capa activa (las features nuevas se asignan a esta) */
  setActiveLayer: (id: string | null) => void;

  /* ---------- Queries ---------- */
  /** Obtiene una capa por id (undefined si no existe) */
  getById: (id: string) => Layer | undefined;
  /** Obtiene todas las capas visibles en orden */
  getVisible: () => Layer[];
  /** Obtiene el número de capas */
  count: () => number;
  /** Verifica si alguna capa con el tipo dado está visible */
  hasKindVisible: (kind: string) => boolean;
  /** Obtiene la primera capa que coincida con el kind dado */
  getLayerForKind: (kind: string) => Layer | undefined;
};

export const useLayersStore = create<LayerState>()(
  immer((set, get) => ({
    layers: [
      /* Capas por defecto para migración de proyectos existentes */
      {
        id: 'lots',
        name: 'Lotes',
        kind: 'lote',
        zIndex: 0,
        color: 'var(--cad-accent-blue)',
        visible: true,
        locked: false,
        opacity: 1,
      },
      {
        id: 'manzanas',
        name: 'Manzanos',
        kind: 'manzana',
        zIndex: 1,
        color: 'var(--cad-accent-orange)',
        visible: true,
        locked: false,
        opacity: 1,
      },
      {
        id: 'streets',
        name: 'Viales',
        kind: 'calle',
        zIndex: 2,
        color: 'var(--cad-accent-purple)',
        visible: true,
        locked: false,
        opacity: 1,
      },
    ],
    index: new Map([
      ['lots', 0],
      ['manzanas', 1],
      ['streets', 2],
    ]),
    activeLayerId: null,

    /* ---------- Mutations ---------- */
    add: (layer) =>
      set((state) => {
        const newZIndex = state.layers.length; // Próximo índice disponible
        const newLayer = { ...layer, zIndex: newZIndex };
        state.layers.push(newLayer);
        // Actualizar el mapa de índices
        state.index = new Map(state.layers.map((l, idx) => [l.id, idx]));
      }),

    remove: (id) =>
      set((state) => {
        const index = state.index.get(id);
        if (index === undefined) return;
        // Eliminar del array
        state.layers.splice(index, 1);
        // Reconstruir el índice
        state.index = new Map(
          state.layers.map((layer, idx) => [layer.id, idx])
        );
      }),

    update: (patch) =>
      set((state) => {
        const index = state.index.get(patch.id);
        if (index === undefined) return;
        // Actualizar las propiedades
        Object.assign(state.layers[index], patch);
        // Si cambió zIndex, necesitamos reordenar
        if ('zIndex' in patch) {
          // Ordenar por zIndex
          state.layers.sort((a, b) => a.zIndex - b.zIndex);
          // Actualizar índices
          state.index = new Map(
            state.layers.map((layer, idx) => [layer.id, idx])
          );
        }
      }),

    reorder: (ids, position) =>
      set((state) => {
        // Filtrar los IDs que realmente existen
        const existingIds = ids.filter((id) => state.index.has(id));
        if (existingIds.length === 0) return;

        // Sacar esas capas del array
        const layersToMove = existingIds
          .map((id) => state.layers[state.index.get(id)!])
          .filter((layer): layer is Layer => layer !== undefined);

        // Eliminar del array original
        state.layers = state.layers.filter(
          (layer) => !existingIds.includes(layer.id)
        );

        // Insertar en la posición especificada
        const before = state.layers.slice(0, position);
        const after = state.layers.slice(position);
        state.layers = [...before, ...layersToMove, ...after];

        // Actualizar z-index basado en nueva posición
        state.layers.forEach((layer, idx) => {
          layer.zIndex = idx;
        });

        // Actualizar el mapa de índices
        state.index = new Map(
          state.layers.map((layer, idx) => [layer.id, idx])
        );
      }),

    toggleLock: (id) =>
      set((state) => {
        const index = state.index.get(id);
        if (index === undefined) return;
        state.layers[index].locked = !state.layers[index].locked;
      }),

    toggleVisibility: (id) =>
      set((state) => {
        const index = state.index.get(id);
        if (index === undefined) return;
        state.layers[index].visible = !state.layers[index].visible;
      }),

    setActiveLayer: (id) =>
      set((state) => {
        state.activeLayerId = id;
      }),

    /* ---------- Queries ---------- */
    getById: (id) => {
      const index = get().index.get(id);
      return index !== undefined ? get().layers[index] : undefined;
    },

    getVisible: () => {
      return get().layers
        .filter((layer) => layer.visible)
        .sort((a, b) => a.zIndex - b.zIndex); // Ya deberían estar ordenados
    },

    count: () => {
      return get().layers.length;
    },

    hasKindVisible: (kind) => {
      return get().layers.some(
        (layer) => layer.visible && layer.kind === kind
      );
    },

    getLayerForKind: (kind) => {
      return get().layers.find((layer) => layer.kind === kind);
    },
  }))
);