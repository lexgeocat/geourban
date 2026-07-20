import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import Map from 'ol/Map.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { extend as extendExtent, Extent } from 'ol/extent.js';
import { refreshSourceMetrics } from '../geo/metrics';
import { clipHalfPlane, pointInPoly, polyArea, type Pt } from '../geo/polygonEngine';
import { useSelectionStore } from './selectionStore';
import { useStreetStore } from './streetStore';
import { useRoundaboutStore } from './roundaboutStore';
import { validateTopologyInWorker, computeManzanosInWorker } from '../workers/geoWorkerClient';
import type { FeatureCollection, Feature as GeoJSONFeature } from 'geojson';
import Feature from 'ol/Feature.js';
import PolygonGeom from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';
import { runCommand } from '../commands/CommandStack';
import { DeleteFeaturesCommand } from '../commands/DeleteFeaturesCommand';
import { ensureKind, getFeatureKind } from '../core/objectModel';
import { buildRoadNetworkRings } from '../geo/roadNetworkEngine';
import { roundRingReflex } from '../geo/ringFillet';

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
      const selectedIds = Array.from(useSelectionStore.getState().selectedIds);
      if (selectedIds.length === 0) return 0;
      void runCommand(new DeleteFeaturesCommand(selectedIds));
      return selectedIds.length;
    },
    deleteFeatureById: (id) => {
      void runCommand(new DeleteFeaturesCommand([id]));
      return true;
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

function closeGeoRing(ring: Pt[]): Pt[] {
  const f = ring[0], l = ring[ring.length - 1];
  if (Math.abs(f[0] - l[0]) > 1e-9 || Math.abs(f[1] - l[1]) > 1e-9) return [...ring, [f[0], f[1]]];
  return ring;
}

export async function recomputeManzanos(): Promise<void> {
  const src = useMapStore.getState().drawSource;
  if (!src) return;

  const streets = useStreetStore.getState().streets;
  const roundabouts = useRoundaboutStore.getState().roundabouts;
  if (streets.length === 0 && roundabouts.length === 0) return;

  type OriginGroup = { origId: string; origPts: Pt[]; members: Array<Feature<Geometry>> };
  const groups = new globalThis.Map<string, OriginGroup>();

  src.forEachFeature((f) => {
    const feature = f as Feature<Geometry>;
    const geom = feature.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return;

    const kind = getFeatureKind(feature);
    if (kind !== 'lote' && kind !== 'manzana') return;
    if (kind === 'lote' && feature.get('lotGroupId')) return;

    let origId = feature.get('origParcelId') as string | undefined;
    let origPts = feature.get('origPts') as Pt[] | undefined;

    if (!origPts) {
      const coords = (geom as PolygonGeom).getCoordinates();
      if (!coords[0] || coords[0].length < 4) return;
      origPts = coords[0].map((c: number[]) => [c[0], c[1]] as Pt);
    }
    if (!origId) {
      const fid = feature.getId();
      origId = fid != null ? String(fid) : `parcel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    let group = groups.get(origId);
    if (!group) {
      group = { origId, origPts, members: [] };
      groups.set(origId, group);
    }
    group.members.push(feature);
  });

  if (groups.size === 0) return;

  // Red vial completa unida en UNA sola operación booleana — el resultado
  // no depende del orden en que las calles se agregaron, y un cruce de 3+
  // vías (o una vía atravesando una rotonda) sale correcto sin casos
  // especiales, a diferencia del recorte secuencial anterior.
  const roadRings = buildRoadNetworkRings(streets, roundabouts);
  if (roadRings.length === 0) return; // nada que recortar todavía

  const roadNetworkFC: FeatureCollection = {
    type: 'FeatureCollection',
    features: roadRings.map((ring) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closeGeoRing(ring)] },
    })) as never[],
  };

  const parcelIndexToGroup: OriginGroup[] = Array.from(groups.values());
  const parcelsFC: FeatureCollection = {
    type: 'FeatureCollection',
    features: parcelIndexToGroup.map((group) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closeGeoRing(group.origPts)] },
    })) as never[],
  };

  let result: FeatureCollection;
  try {
    result = await computeManzanosInWorker(parcelsFC, roadNetworkFC);
  } catch (err) {
    console.error('recomputeManzanos: fallo la unión/diferencia de la red vial', err);
    return;
  }

  const fragmentsByGroup = new globalThis.Map<number, Pt[][]>();
  result.features.forEach((f: GeoJSONFeature) => {
    const idx = f.properties?.origParcelIndex as number | undefined;
    if (idx == null || f.geometry?.type !== 'Polygon') return;
    const ring = (f.geometry.coordinates[0] as number[][]).map((c) => [c[0], c[1]] as Pt);
    if (ring.length < 4) return;
    if (!fragmentsByGroup.has(idx)) fragmentsByGroup.set(idx, []);
    fragmentsByGroup.get(idx)!.push(ring);
  });

  parcelIndexToGroup.forEach((group, idx) => {
    const fragments = fragmentsByGroup.get(idx) ?? [];
    for (const m of group.members) src.removeFeature(m);

    const untouched =
      fragments.length === 1 && polyArea(fragments[0]) >= polyArea(group.origPts) * 0.999;

    if (untouched) {
      const orig = group.members[0];
      orig.setGeometry(new PolygonGeom([closeGeoRing(fragments[0])]));
      orig.set('kind', 'lote', true);
      orig.set('origParcelId', group.origId, true);
      orig.set('origPts', group.origPts, true);
      src.addFeature(orig);
      return;
    }

    fragments.forEach((ring, i) => {
      const rounded = roundRingReflex(ring);
      if (rounded.length < 4) return;
      const newFeat = new Feature({ geometry: new PolygonGeom([rounded]) });
      newFeat.setId(`${group.origId}-mzn-${i}`);
      newFeat.setProperties(
        ensureKind(
          {
            type: 'manzana',
            colorIdx: i % 10,
            createdAt: new Date().toISOString(),
            origParcelId: group.origId,
            origPts: group.origPts,
          },
          'manzana',
        ),
      );
      src.addFeature(newFeat);
    });
  });

  refreshSourceMetrics(src);
  src.changed();
}
