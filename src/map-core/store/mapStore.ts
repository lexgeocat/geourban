import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import Map from 'ol/Map.js';
import VectorSource from 'ol/source/Vector.js';
import VectorLayer from 'ol/layer/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type Polygon from 'ol/geom/Polygon.js';
import { extend as extendExtent, type Extent } from 'ol/extent.js';
import { refreshSourceMetrics } from '@georef-engine/metrics';
import { DISPLAY_PROJECTION } from '@georef-engine/crs/projections';
import { getOrCreateSpatialIndex } from '@kernel/spatial-index/spatialIndex';
import { useSelectionStore } from '@selection-engine/store/selectionStore';
import { runCommand } from '@kernel/command/CommandStack';
import { DeleteFeaturesCommand } from '@drawing-engine/commands/DeleteFeaturesCommand';
import { toast } from '@shared-ui/store/toastStore';
import { reloadRustSpatialIndex } from '@kernel/spatial-index/rustSpatialIndex';
import { setDrawContext, clearDrawContext } from '@kernel/command/commandContext';

const geoJsonFormat = new GeoJSON();

type CursorCoords = { x: number; y: number; isProjected?: boolean } | null;

export type ViewConfig = {
  center: [number, number];
  zoom: number;
};

function isFiniteExtent(ext: Extent | null | undefined): ext is Extent {
  if (!ext || ext.length !== 4) return false;
  return ext.every((v) => Number.isFinite(v));
}

type MapState = {
  mapInstance: Map | null;
  drawSource: VectorSource | null;
  cursorCoords: CursorCoords;
  zoom: number;
  viewConfig: ViewConfig;
  setMap: (map: Map | null) => void;
  setDrawSource: (src: VectorSource | null) => void;
  restoreDrawFeatures: (geojson: unknown) => void;
  setCursorCoords: (coords: CursorCoords) => void;
  setZoom: (zoom: number) => void;
  setViewConfig: (config: ViewConfig) => void;
  fitToExtent: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  deleteSelected: () => number;
  deleteFeatureById: (id: string | number) => boolean;
};

export const useMapStore = create<MapState>()(
  immer((set, get) => ({
    mapInstance: null,
    drawSource: null,
    cursorCoords: null,
    zoom: 19,
    viewConfig: { center: [-68.3, -16.65], zoom: 19 },
    setMap: (map) =>
      set((state) => {
        // @ts-expect-error — immer draft vs OL class instance
        state.mapInstance = map;
      }),
    setDrawSource: (src) =>
      set((state) => {
        state.drawSource = src;
      }),
    restoreDrawFeatures: (geojson) => {
      const src = get().drawSource;
      if (!src) return;
      const features = geoJsonFormat.readFeatures(geojson, {
        dataProjection: DISPLAY_PROJECTION,
        featureProjection: DISPLAY_PROJECTION,
      }) as Feature<Geometry>[];
      const finiteFeatures: Feature<Geometry>[] = [];
      let droppedCount = 0;
      for (const f of features) {
        const geom = f.getGeometry();
        if (geom && isFiniteExtent(geom.getExtent())) {
          finiteFeatures.push(f);
        } else {
          droppedCount++;
        }
      }
      if (droppedCount > 0) {
        console.warn(
          `restoreDrawFeatures: se descartaron ${droppedCount} feature(s) con geometría no-finita.`
        );
      }

      src.clear();
      src.addFeatures(finiteFeatures);
      getOrCreateSpatialIndex().load(finiteFeatures as unknown as Feature<Polygon>[]);
      void reloadRustSpatialIndex(finiteFeatures);
      refreshSourceMetrics(src);
      src.changed();
      useSelectionStore.getState().clear();
    },
    setCursorCoords: (coords) =>
      set((state) => {
        state.cursorCoords = coords;
      }),
    setZoom: (zoom) =>
      set((state) => {
        state.zoom = zoom;
      }),
    setViewConfig: (config) =>
      set((state) => {
        state.viewConfig = config;
      }),
    fitToExtent: () => {
      const map = get().mapInstance;
      if (!map) return;
      const layers = map.getLayers().getArray();
      let fullExtent: Extent | null = null;
      for (const layer of layers) {
        if (!(layer instanceof VectorLayer)) continue;
        const src = layer.getSource?.();
        if (!src || typeof src.getExtent !== 'function') continue;
        const ext = src.getExtent();
        if (!isFiniteExtent(ext)) continue;
        if (!fullExtent) fullExtent = [...ext] as Extent;
        else extendExtent(fullExtent, ext);
      }
      if (fullExtent && isFiniteExtent(fullExtent)) {
        map
          .getView()
          .fit(fullExtent, { size: map.getSize(), maxZoom: 18, padding: [40, 40, 40, 40] });
      }
    },
    zoomIn: () => {
      const map = get().mapInstance;
      if (!map) return;
      const view = map.getView();
      const z = view.getZoom();
      if (z !== undefined) view.animate({ zoom: z + 1, duration: 200 });
    },
    zoomOut: () => {
      const map = get().mapInstance;
      if (!map) return;
      const view = map.getView();
      const z = view.getZoom();
      if (z !== undefined) view.animate({ zoom: z - 1, duration: 200 });
    },
    deleteSelected: () => {
      const selectedIds = Array.from(useSelectionStore.getState().selectedIds);
      if (selectedIds.length === 0) return 0;
      const cmd = new DeleteFeaturesCommand(selectedIds);
      void runCommand(cmd);
      if (cmd.skippedLockedCount > 0) {
        toast(
          `${cmd.skippedLockedCount} elemento(s) no se borraron por estar en una capa bloqueada.`,
          {
            variant: 'warning',
            durationMs: 5000,
          }
        );
      }
      if (cmd.skippedNotEditingCount > 0) {
        toast(
          `${cmd.skippedNotEditingCount} elemento(s) no se borraron: activá edición en su capa (panel de Capas).`,
          {
            variant: 'warning',
            durationMs: 5000,
          }
        );
      }
      return selectedIds.length - cmd.skippedCount;
    },
    deleteFeatureById: (id) => {
      const cmd = new DeleteFeaturesCommand([id]);
      void runCommand(cmd);
      if (cmd.skippedLockedCount > 0) {
        toast(
          `${cmd.skippedLockedCount} elemento(s) no se borraron por estar en una capa bloqueada.`,
          {
            variant: 'warning',
            durationMs: 5000,
          }
        );
      }
      if (cmd.skippedNotEditingCount > 0) {
        toast(
          `${cmd.skippedNotEditingCount} elemento(s) no se borraron: activá edición en su capa (panel de Capas).`,
          {
            variant: 'warning',
            durationMs: 5000,
          }
        );
      }
      return cmd.skippedCount === 0;
    },
  }))
);

useMapStore.subscribe((state, prev) => {
  if (state.mapInstance === prev.mapInstance && state.drawSource === prev.drawSource) {
    return;
  }
  if (state.drawSource) {
    setDrawContext({
      drawSource: state.drawSource,
      getMap: () => useMapStore.getState().mapInstance,
    });
  } else {
    clearDrawContext();
  }
});
