import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BaseMapId } from '../../map/baseMaps';


type PanelKey = 'properties';


/** Tabs del ribbon estilo ArcGIS Pro. Cada tab tiene un id y un label. */
export type RibbonTabId = 'map' | 'edit' | 'insert' | 'view';


/** Ids de paneles (subsecciones dentro del ribbon). */
export type RibbonPanelId =
  | 'navigation'
  | 'draw'
  | 'modify'
  | 'edit'
  | 'subdivision'
  | 'layers'
  | 'view';


type UiShellState = {
  baseMap: BaseMapId;
  panelVisibility: Record<PanelKey, boolean>;
  /** Offset de la grilla CAD, usado tanto para render (cadGridLayer) como para gridSnap.ts. */
  gridOrigin: [number, number];
  statsPanelVisible: boolean;
  /** Toggle "Cotas" del ribbon de Vista. A diferencia de "Lotes"/"Calles"
   *  (que ahora se derivan de layersRegistryStore.hasKindVisible), este no
   *  está atado a ninguna capa real del registro — por eso sigue viviendo
   *  como un flag simple de UI. */
  measurementsVisible: boolean;
  /** Ribbon state */
  activeTab: RibbonTabId;
  /** Tabs contraídos: solo se ve la franja de tabs (no los paneles). */
  ribbonCollapsed: boolean;
  setBaseMap: (id: BaseMapId) => void;
  setPanelVisibility: (key: PanelKey, visible: boolean) => void;
  setGridOrigin: (o: [number, number]) => void;
  setStatsPanelVisible: (v: boolean) => void;
  setMeasurementsVisible: (v: boolean) => void;
  setActiveTab: (id: RibbonTabId) => void;
  setRibbonCollapsed: (v: boolean) => void;
};


/**
 * Antes `layerStore.ts` (hook `useLayerStore`) — renombrado en la Fase 1
 * del plan de optimización porque su nombre difería en una sola letra de
 * `layersRegistryStore.ts` (hook `useLayersStore`), que es el registro
 * REAL de capas (Layer[], color, locked, zIndex, etc). Este store acá es
 * solo preferencias de UI/ribbon/mapa base — nunca contuvo el modelo de
 * datos de capas.
 *
 * También se eliminó `workVisibility` (booleans lots/streets/measurements):
 * duplicaba lo que ya expresa `layersRegistryStore.layers[].visible` con
 * más granularidad, y requería lógica de sincronización manual en
 * LayerPanel.tsx y Map.tsx (ver plan-optimizacion-geourban.md, §2.3).
 * "Lotes"/"Calles" ahora se derivan con `layersRegistryStore.hasKindVisible()`
 * directamente donde se necesitan (TopBar.tsx, Map.tsx).
 */
export const useUiShellStore = create<UiShellState>()(
  immer((set) => ({
    baseMap: 'cad' as BaseMapId,
    panelVisibility: {
      properties: false,
    },
    gridOrigin: [0, 0],
    statsPanelVisible: false,
    measurementsVisible: true,
    activeTab: 'map',
    ribbonCollapsed: false,
    setBaseMap: (id) =>
      set((state) => {
        state.baseMap = id;
      }),
    setPanelVisibility: (key, visible) =>
      set((state) => {
        state.panelVisibility[key] = visible;
      }),
    setGridOrigin: (o) =>
      set((state) => {
        state.gridOrigin = o;
      }),
    setStatsPanelVisible: (v) =>
      set((state) => {
        state.statsPanelVisible = v;
      }),
    setMeasurementsVisible: (v) =>
      set((state) => {
        state.measurementsVisible = v;
      }),
    setActiveTab: (id) =>
      set((state) => {
        state.activeTab = id;
      }),
    setRibbonCollapsed: (v) =>
      set((state) => {
        state.ribbonCollapsed = v;
      }),
  }))
);
