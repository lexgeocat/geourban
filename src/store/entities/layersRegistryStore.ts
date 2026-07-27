import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import {
  DEFAULT_LAYERS,
  UNASSIGNED_LAYER_ID,
  createUnassignedLayer,
  type Layer,
} from '../../core/objectModel';

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
  /** Alterna la visibilidad de TODAS las capas cuyo `kind` esté incluido en
   *  `kinds` — reemplaza el antiguo `layerStore.workVisibility` (ver
   *  plan-optimizacion-geourban.md, Fase 1). Usado por los toggles
   *  "Lotes"/"Calles" del ribbon de Vista (TopBar.tsx). */
  toggleKindsVisibility: (kinds: string[]) => void;
  /** Selecciona la capa activa (las features nuevas se asignan a esta) */
  setActiveLayer: (id: string | null) => void;

  /** Fase 2 (persistencia): reemplaza TODO el registro — usado al abrir
   *  un proyecto guardado o al importar un `.geourban`. Si `layers` viene
   *  vacío (proyecto guardado antes de esta fase, o import de un formato
   *  sin capas propias como .geojson/.kml/.dxf), siembra los 5 defaults
   *  de fábrica — mismo criterio que la migración Dexie v1→v2 de
   *  `io/projectStore.ts`. */
  loadLayers: (layers: Layer[], activeLayerId?: string | null) => void;
  /** Vuelve el registro a los 5 defaults de fábrica ("Nuevo proyecto"). */
  resetToDefaults: () => void;
  /** Reconcilia features cuyo `layerId` no resuelve a ninguna capa del
   *  registro actual (capa borrada/inexistente tras cargar un proyecto)
   *  reasignándolas a una capa "Sin capa" visible, creada on-demand, en
   *  vez de dejarlas huérfanas con estilos genéricos silenciosos.
   *  Devuelve cuántas features se corrigieron. */
  reconcileOrphanFeatures: (features: Feature<Geometry>[]) => number;

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
    layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
    index: new Map(DEFAULT_LAYERS.map((l, idx) => [l.id, idx])),
    activeLayerId: null,

    /* ---------- Mutations ---------- */
    add: (layer) =>
      set((state) => {
        const newZIndex = state.layers.length;
        const withDefaults: Layer = {
          ...layer,
          fillColor: layer.fillColor ?? layer.color,
          showLabel: layer.showLabel ?? true,
          showCota: layer.showCota ?? true,
          zIndex: newZIndex,
        };
        state.layers.push(withDefaults);
        state.index = new Map(state.layers.map((l, idx) => [l.id, idx]));
      }),

    remove: (id) =>
      set((state) => {
        const index = state.index.get(id);
        if (index === undefined) return;
        state.layers.splice(index, 1);
        state.index = new Map(
          state.layers.map((layer, idx) => [layer.id, idx])
        );
      }),

    update: (patch) =>
      set((state) => {
        const index = state.index.get(patch.id);
        if (index === undefined) return;
        Object.assign(state.layers[index], patch);
        if ('zIndex' in patch) {
          state.layers.sort((a, b) => a.zIndex - b.zIndex);
          state.index = new Map(
            state.layers.map((layer, idx) => [layer.id, idx])
          );
        }
      }),

    reorder: (ids, position) =>
      set((state) => {
        const existingIds = ids.filter((id) => state.index.has(id));
        if (existingIds.length === 0) return;

        const layersToMove = existingIds
          .map((id) => state.layers[state.index.get(id)!])
          .filter((layer): layer is Layer => layer !== undefined);

        state.layers = state.layers.filter(
          (layer) => !existingIds.includes(layer.id)
        );

        const before = state.layers.slice(0, position);
        const after = state.layers.slice(position);
        state.layers = [...before, ...layersToMove, ...after];

        state.layers.forEach((layer, idx) => {
          layer.zIndex = idx;
        });

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

    toggleKindsVisibility: (kinds) =>
      set((state) => {
        const kindSet = new Set(kinds);
        const anyVisible = state.layers.some((l) => kindSet.has(l.kind) && l.visible);
        const next = !anyVisible;
        state.layers.forEach((l) => {
          if (kindSet.has(l.kind)) l.visible = next;
        });
      }),

    setActiveLayer: (id) =>
      set((state) => {
        state.activeLayerId = id;
      }),

    loadLayers: (layers, activeLayerId = null) =>
      set((state) => {
        const next = layers.length > 0
          ? layers.map((l) => ({ ...l }))
          : DEFAULT_LAYERS.map((l) => ({ ...l }));
        state.layers = next;
        state.index = new Map(next.map((l, idx) => [l.id, idx]));
        state.activeLayerId = activeLayerId && next.some((l) => l.id === activeLayerId)
          ? activeLayerId
          : null;
      }),

    resetToDefaults: () =>
      set((state) => {
        const next = DEFAULT_LAYERS.map((l) => ({ ...l }));
        state.layers = next;
        state.index = new Map(next.map((l, idx) => [l.id, idx]));
        state.activeLayerId = null;
      }),

    reconcileOrphanFeatures: (features) => {
      const validIds = new Set(get().layers.map((l) => l.id));
      const orphans = features.filter((f) => {
        const layerId = f.get('layerId') as string | undefined;
        return !!layerId && !validIds.has(layerId);
      });
      if (orphans.length === 0) return 0;

      if (!validIds.has(UNASSIGNED_LAYER_ID)) {
        set((state) => {
          state.layers.push(createUnassignedLayer(state.layers.length));
          state.index = new Map(state.layers.map((l, idx) => [l.id, idx]));
        });
      }
      for (const f of orphans) f.set('layerId', UNASSIGNED_LAYER_ID, true);
      return orphans.length;
    },

    /* ---------- Queries ---------- */
    getById: (id) => {
      const index = get().index.get(id);
      return index !== undefined ? get().layers[index] : undefined;
    },

    getVisible: () => {
      return get().layers
        .filter((layer) => layer.visible)
        .sort((a, b) => a.zIndex - b.zIndex);
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