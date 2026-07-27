import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import {
  DEFAULT_LAYERS,
  UNASSIGNED_LAYER_ID,
  createUnassignedLayer,
  isLayerKind,
  type Layer,
  type LayerKind,
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
  /** Fase 7: "Aislar capa" — oculta todas las demás capas del registro y
   *  muestra solo `id`. Llamar de nuevo con el mismo id restaura la
   *  visibilidad previa a aislar. */
  isolatedLayerId: string | null;
  toggleIsolate: (id: string) => void;
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

  /* ---------- LayerKind queries (Fase 4) ---------- */
  /** Obtiene el LayerKind de una capa por id (null si no existe o es inválido) */
  getKind: (id: string) => LayerKind | null;
  /** Verifica si alguna capa tiene el kind dado */
  hasKind: (kind: LayerKind) => boolean;
  /** Obtiene el colorMode de una capa por id */
  getColorMode: (id: string) => 'solid' | 'colorIdx';
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
        const safeKind: LayerKind = isLayerKind(layer.kind) ? layer.kind : 'lote';
        const withDefaults: Layer = {
          ...layer,
          kind: safeKind,
          fillColor: layer.fillColor ?? layer.color,
          showLabel: layer.showLabel ?? true,
          showCota: layer.showCota ?? true,
          colorMode: (layer as any).colorMode ?? (safeKind === 'manzana' ? 'colorIdx' : 'solid'),
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
        if ('kind' in patch) {
          const safeKind: LayerKind = isLayerKind(patch.kind) ? patch.kind : 'lote';
          state.layers[index].kind = safeKind;
          state.layers[index].colorMode = safeKind === 'manzana' ? 'colorIdx' : 'solid';
        }
        if ('zIndex' in patch) {
          state.layers.sort((a, b) => a.zIndex - b.zIndex);
          state.index = new Map(
            state.layers.map((layer, idx) => [layer.id, idx])
          );
        }
        if (patch.locked === true && state.activeLayerId === patch.id) {
          state.activeLayerId = null;
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
        const nextLocked = !state.layers[index].locked;
        state.layers[index].locked = nextLocked;
        if (nextLocked && state.activeLayerId === id) {
          state.activeLayerId = null;
        }
      }),

    toggleVisibility: (id) =>
      set((state) => {
        const index = state.index.get(id);
        if (index === undefined) return;
        state.layers[index].visible = !state.layers[index].visible;
      }),

    isolatedLayerId: null,
    isolatePrevVisibility: null as Record<string, boolean> | null,

    toggleIsolate: (id) =>
      set((state) => {
        if (state.isolatedLayerId === id) {
          const prev = (state as any).isolatePrevVisibility as Record<string, boolean> | null;
          if (prev) {
            for (const layer of state.layers) {
              if (prev[layer.id] !== undefined) layer.visible = prev[layer.id];
            }
          }
          state.isolatedLayerId = null;
          (state as any).isolatePrevVisibility = null;
          return;
        }
        const existing = (state as any).isolatePrevVisibility as Record<string, boolean> | null;
        const snapshot = existing ?? Object.fromEntries(state.layers.map((l) => [l.id, l.visible]));
        for (const layer of state.layers) layer.visible = layer.id === id;
        state.isolatedLayerId = id;
        (state as any).isolatePrevVisibility = snapshot;
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
        if (id) {
          const idx = state.index.get(id);
          if (idx !== undefined && state.layers[idx].locked) return;
        }
        state.activeLayerId = id;
      }),

    loadLayers: (layers, activeLayerId = null) =>
      set((state) => {
        const next = layers.length > 0
          ? layers.map((l) => ({
              ...l,
              kind: isLayerKind(l.kind) ? l.kind : 'lote',
              colorMode: ((l as any).colorMode as string) === 'colorIdx'
                ? 'colorIdx' as const
                : (isLayerKind(l.kind) && l.kind === 'manzana' ? 'colorIdx' as const : 'solid' as const),
            }))
          : DEFAULT_LAYERS.map((l) => ({ ...l }));
        state.layers = next;
        state.index = new Map(next.map((l, idx) => [l.id, idx]));
        const candidate = activeLayerId ? next.find((l) => l.id === activeLayerId) : undefined;
        state.activeLayerId = candidate && !candidate.locked ? activeLayerId : null;
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
      for (const f of orphans) f.set('layerId', UNASSIGNED_LAYER_ID);
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

    /* ---------- LayerKind queries (Fase 4) ---------- */
    getKind: (id) => {
      const index = get().index.get(id);
      if (index === undefined) return null;
      const k = get().layers[index].kind;
      return isLayerKind(k) ? k : null;
    },
    hasKind: (kind) => {
      return get().layers.some((l) => l.kind === kind);
    },
    getColorMode: (id) => {
      const index = get().index.get(id);
      if (index === undefined) return 'solid';
      return get().layers[index].colorMode;
    },
  }))
);