import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import Map from 'ol/Map.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { extend as extendExtent, Extent } from 'ol/extent.js';
import { refreshSourceMetrics } from '../geo/metrics';
import { clipPolygonByAllStreets, type Pt } from '../geo/polygonEngine';
import { useSelectionStore } from './selectionStore';
import { useHistoryStore } from './historyStore';
import { useStreetStore } from './streetStore';
import { mergePolygonsInWorker, validateTopologyInWorker } from '../workers/geoWorkerClient';
import type { FeatureCollection } from 'geojson';
import Feature from 'ol/Feature.js';
import PolygonGeom from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';

const geoJsonFormat = new GeoJSON();

type CursorCoords = { x: number; y: number; isProjected?: boolean } | null;

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
    zoom: 19,
    viewConfig: { center: [-68.3, -16.65], zoom: 19 },
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
      const toRemove: Array<string | number> = [];
      src.forEachFeature((f) => {
        const id = f.getId();
        if (id !== undefined && selectedIds.has(id as string | number)) {
          toRemove.push(id as string | number);
          removed++;
        }
      });
      toRemove.forEach((id) => {
        const feat = src.getFeatureById(id);
        if (feat) src.removeFeature(feat);
      });
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

      const selectedFeatures: Feature<Geometry>[] = [];
      selectedIds.forEach((id) => {
        const f = src.getFeatureById(id) as Feature<Geometry> | null;
        if (f) selectedFeatures.push(f);
      });
      if (selectedFeatures.length < 2) return null;

      const collection: FeatureCollection = {
        type: 'FeatureCollection',
        features: selectedFeatures.map((f) =>
          geoJsonFormat.writeFeatureObject(f, {
            featureProjection: 'EPSG:3857',
            dataProjection: 'EPSG:3857',
          })
        ),
      };

      const merged = await mergePolygonsInWorker(collection);
      if (!merged.features.length) return null;

      // Construimos y validamos el feature resultante ANTES de tocar los
      // originales. Antes se borraban los originales primero y recien
      // despues se chequeaba si el resultado era legible -> si fallaba,
      // se perdian los poligonos de origen sin dejar nada en su lugar.
      const olFeats = geoJsonFormat.readFeatures(merged, {
        featureProjection: 'EPSG:3857',
        dataProjection: 'EPSG:3857',
      });
      if (olFeats.length === 0) return null;

      const target = olFeats[0] as Feature<Geometry>;
      if (target.getGeometry()?.getType() === 'MultiPolygon') {
        // Los poligonos seleccionados no son contiguos (no se tocan):
        // JSTS devuelve un MultiPolygon en vez de fusionarlos en un solo
        // anillo. metrics.ts no sabe calcular area/perimetro de un
        // MultiPolygon, asi que en vez de insertar un feature "mudo"
        // (sin cotas, sin aviso), tratamos esto como fusion fallida.
        return null;
      }

      const newId = `merged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      target.setId(newId);
      target.set('mergedFrom', Array.from(selectedIds));
      target.set('mergedAt', new Date().toISOString());

      // Recien ahora, con el resultado validado, reemplazamos los originales.
      selectedFeatures.forEach((f) => src.removeFeature(f));
      useSelectionStore.getState().clear();
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
        features: src.getFeatures().map((f) =>
          geoJsonFormat.writeFeatureObject(f, {
            featureProjection: 'EPSG:3857',
            dataProjection: 'EPSG:3857',
          })
        ),
      };
      return validateTopologyInWorker(collection);
    },
  }))
);

/**
 * Recomputa manzanos — recorta todos los polígonos del drawSource
 * por cada calle activa, generando los manzanos resultantes.
 * Port de LOTES_SAI recomputeManzanos() (polygon-engine.js:241-382).
 */
export function recomputeManzanos() {
  const src = useMapStore.getState().drawSource;
  if (!src) return;

  const streets = useStreetStore.getState().streets;
  if (streets.length === 0) return;

  // Obtener todos los polígonos del drawSource
  const polygonsToClip: Array<{ feature: Feature<Geometry>; pts: Pt[] }> = [];
  src.forEachFeature((f) => {
    const geom = f.getGeometry();
    if (!geom) return;
    if (geom.getType() !== 'Polygon') return;
    const coords = (geom as import('ol/geom/Polygon.js').default).getCoordinates();
    if (!coords[0] || coords[0].length < 4) return;
    const pts: Pt[] = coords[0].map((c: number[]) => [c[0], c[1]]);
    polygonsToClip.push({ feature: f as Feature<Geometry>, pts });
  });

  if (polygonsToClip.length === 0) return;

  const streetData = streets.map((s) => ({ start: s.start, end: s.end, widthM: s.widthM }));

  for (const { feature, pts } of polygonsToClip) {
    const manzanos = clipPolygonByAllStreets(pts, streetData);
    if (manzanos.length === 1 && manzanos[0] === pts) continue;

    src.removeFeature(feature);

    for (let i = 0; i < manzanos.length; i++) {
      const ring = manzanos[i];
      if (ring.length < 3) continue;
      const closedRing = [...ring];
      if (closedRing[0][0] !== closedRing[closedRing.length - 1][0] ||
          closedRing[0][1] !== closedRing[closedRing.length - 1][1]) {
        closedRing.push([closedRing[0][0], closedRing[0][1]]);
      }
      const newGeom = new PolygonGeom([closedRing]);
      const newFeat = new Feature({ geometry: newGeom });
      const origId = feature.getId();
      newFeat.setId(origId ? `${origId}-mzn-${i}` : `mzn-${Date.now()}-${i}`);
      newFeat.setProperties({
        type: 'manzana',
        colorIdx: i % 10,
        createdAt: new Date().toISOString(),
      });
      src.addFeature(newFeat);
    }
  }

  refreshSourceMetrics(src);
  src.changed();
  useHistoryStore.getState().pushState(src.getFeatures());
}
