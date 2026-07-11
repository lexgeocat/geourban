import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import Map from 'ol/Map.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { extend as extendExtent, Extent } from 'ol/extent.js';
import { refreshSourceMetrics } from '../geo/metrics';
import { useSelectionStore } from './selectionStore';
import { useHistoryStore } from './historyStore';
import { mergePolygonsInWorker, validateTopologyInWorker } from '../workers/geoWorkerClient';
import type { FeatureCollection } from 'geojson';
import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';

const geoJsonFormat = new GeoJSON();

type CursorCoords = { x: number; y: number } | null;

export type ViewConfig = {
  /** Centro del mapa en [lng, lat] (EPSG:4326) */
  center: [number, number];
  zoom: number;
};

type MapState = {
  mapInstance: Map | null;
  drawSource: VectorSource | null;
  cursorCoords: CursorCoords;
  zoom: number;
  viewConfig: ViewConfig;
  setMap: (map: Map | null) => void;
  setDrawSource: (src: VectorSource | null) => void;
  /** Recibe GeoJSON array serializado desde historyStore y reemplaza features */
  restoreDrawFeatures: (geojson: any) => void;
  setCursorCoords: (coords: CursorCoords) => void;
  setZoom: (zoom: number) => void;
  setViewConfig: (config: ViewConfig) => void;
  fitToExtent: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  /** Borra las features seleccionadas (de drawSource) y refresca metricas */
  deleteSelected: () => number;
  /** Borra UNA feature concreta (por id OL) */
  deleteFeatureById: (id: string | number) => boolean;
  /**
   * Fusiona los features seleccionados (polígonos) en uno solo, vía worker JSTS.
   * Devuelve el id del feature resultante o null si no se pudo.
   */
  mergeSelected: () => Promise<string | number | null>;
  /**
   * Valida la topologia de todos los features del drawSource via worker.
   * Devuelve el resultado del analisis.
   */
  validateProjectTopology: () => Promise<{ valid: boolean; issues: string[] }>;
};

export const useMapStore = create<MapState>()(
  immer((set, get) => ({
    mapInstance: null,
    drawSource: null,
    cursorCoords: null,
    zoom: 17,
    viewConfig: { center: [-68.3, -16.65], zoom: 17 },
    setMap: (map) =>
      set((state) => {
        // @ts-expect-error – immer draft vs OL class instance
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
        featureProjection: 'EPSG:3857',
      });
      src.clear();
      src.addFeatures(features as any);
      refreshSourceMetrics(src);
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
      // Itera todas las capas vectoriales y calcula el extent combinado
      const layers = map.getLayers().getArray();
      let fullExtent: Extent | null = null;
      for (const layer of layers) {
        const src = (layer as any).getSource?.();
        if (!src || typeof src.getExtent !== 'function') continue;
        const ext = src.getExtent();
        if (!ext || ext[0] === Infinity || ext[0] === -Infinity) continue;
        if (!fullExtent) fullExtent = [...ext] as Extent;
        else extendExtent(fullExtent, ext);
      }
      if (fullExtent) {
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
      const src = get().drawSource;
      if (!src) return 0;
      const selectedIds = useSelectionStore.getState().selectedIds;
      if (selectedIds.size === 0) return 0;

      let removed = 0;
      const toRemove: string[] = [];
      src.forEachFeature((f) => {
        const id = f.getId();
        if (id !== undefined && selectedIds.has(id as string | number)) {
          toRemove.push(id as string);
          removed++;
        }
      });
      toRemove.forEach((id) => src.removeFeature(src.getFeatureById(id)));
      useSelectionStore.getState().clear();
      src.changed();
      if (removed > 0) {
        useHistoryStore.getState().pushState(src.getFeatures());
      }
      return removed;
    },
    deleteFeatureById: (id) => {
      const src = get().drawSource;
      if (!src) return false;
      const feat = src.getFeatureById(id);
      if (!feat) return false;
      src.removeFeature(feat);
      useSelectionStore.getState().remove(id);
      src.changed();
      useHistoryStore.getState().pushState(src.getFeatures());
      return true;
    },
    mergeSelected: async () => {
      const src = get().drawSource;
      if (!src) return null;
      const selectedIds = useSelectionStore.getState().selectedIds;
      if (selectedIds.size < 2) return null;

      // Recolectar features seleccionadas
      const selectedFeatures: Feature<Geometry>[] = [];
      selectedIds.forEach((id) => {
        const f = src.getFeatureById(id) as Feature<Geometry> | null;
        if (f) selectedFeatures.push(f);
      });
      if (selectedFeatures.length < 2) return null;

      // Serializar a FeatureCollection GeoJSON
      const collection: FeatureCollection = {
        type: 'FeatureCollection',
        features: selectedFeatures.map((f) => geoJsonFormat.writeFeatureObject(f)),
      };

      const merged = await mergePolygonsInWorker(collection);
      if (!merged.features.length) return null;

      // Eliminar las originales
      selectedFeatures.forEach((f) => src.removeFeature(f));
      useSelectionStore.getState().clear();

      // Insertar el resultado como un nuevo feature OL
      const newId = `merged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const olFeats = geoJsonFormat.readFeatures(merged, { featureProjection: 'EPSG:3857' });
      if (olFeats.length === 0) return null;
      const target = olFeats[0] as Feature<Geometry>;
      target.setId(newId);
      target.set('mergedFrom', Array.from(selectedIds));
      target.set('mergedAt', new Date().toISOString());
      src.addFeature(target);
      refreshSourceMetrics(src);
      src.changed();
      useHistoryStore.getState().pushState(src.getFeatures());
      return newId;
    },
    validateProjectTopology: async () => {
      const src = get().drawSource;
      if (!src) return { valid: true, issues: [] };
      const collection: FeatureCollection = {
        type: 'FeatureCollection',
        features: src.getFeatures().map((f) => geoJsonFormat.writeFeatureObject(f)),
      };
      return validateTopologyInWorker(collection);
    },
  }))
);
