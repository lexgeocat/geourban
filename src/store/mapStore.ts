import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import Map from 'ol/Map.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { extend as extendExtent, Extent } from 'ol/extent.js';
import { refreshSourceMetrics } from '../geo/metrics';
import { clipPolygonByAllStreets, type Pt, clipHalfPlane } from '../geo/polygonEngine';
import { getStreetOuterSegments } from '../geo/curveClipping';
import { computeStreetFillets, type StreetFillet, filletArcPoints } from '../geo/streetEngine';
import { useSelectionStore } from './selectionStore';
import { useStreetStore } from './streetStore';
import { validateTopologyInWorker } from '../workers/geoWorkerClient';
import type { FeatureCollection } from 'geojson';
import Feature from 'ol/Feature.js';
import PolygonGeom from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';
import { runCommand } from '../commands/CommandStack';
import { DeleteFeaturesCommand } from '../commands/DeleteFeaturesCommand';
import { MergeFeaturesCommand } from '../commands/MergeFeaturesCommand';
import { ensureKind, getFeatureKind } from '../core/objectModel';

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
  mergeSelected: () => Promise<string | number | null>;
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
    mergeSelected: async () => {
      const selectedIds = Array.from(useSelectionStore.getState().selectedIds);
      if (selectedIds.length < 2) return null;
      const result = await runCommand(new MergeFeaturesCommand(selectedIds));
      if (!result.ok) return null;
      // Tras la ejecución, el nuevo id es el del feature seleccionado.
      return useSelectionStore.getState().primaryId;
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

export function recomputeManzanos() {
  const src = useMapStore.getState().drawSource;
  if (!src) return;

  const streets = useStreetStore.getState().streets;
  if (streets.length === 0) return;

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

  const streetSegments = streets.flatMap((s) => getStreetOuterSegments(s));

  const fillets = computeStreetFillets(streets, { outer: true });
  const filletPolys: Pt[][] = [];
  for (const fillet of fillets) {
    const arcPts = filletArcPoints(fillet, 16);
    if (arcPts.length < 3) continue;
    const closed = [...arcPts];
    if (closed[0][0] !== closed[closed.length - 1][0] || closed[0][1] !== closed[closed.length - 1][1]) {
      closed.push(closed[0]);
    }
    filletPolys.push(closed);
  }

  for (const group of groups.values()) {
    const manzanos = clipPolygonByAllStreets(group.origPts, streetSegments);
    const unchanged = manzanos.length === 1 && manzanos[0] === group.origPts;

    for (const m of group.members) src.removeFeature(m);

    if (unchanged) {
      const closedRing = [...group.origPts];
      if (
        closedRing[0][0] !== closedRing[closedRing.length - 1][0] ||
        closedRing[0][1] !== closedRing[closedRing.length - 1][1]
      ) {
        closedRing.push([closedRing[0][0], closedRing[0][1]]);
      }
      const orig = group.members[0];
      orig.setGeometry(new PolygonGeom([closedRing]));
      orig.set('kind', 'lote', true);
      orig.set('origParcelId', group.origId, true);
      orig.set('origPts', group.origPts, true);
      src.addFeature(orig);
      continue;
    }

    let manzanosConFillets = manzanos;
    for (const filletPoly of filletPolys) {
      const newManzanos: Pt[][] = [];
      for (const mzn of manzanosConFillets) {
        let current = mzn;
        const n = filletPoly.length;
        for (let i = 0; i < n; i++) {
          const a = filletPoly[i];
          const b = filletPoly[(i + 1) % n];
          const center = filletPoly[0];
          const side = (b[0] - a[0]) * (center[1] - a[1]) - (b[1] - a[1]) * (center[0] - a[0]);
          current = clipHalfPlane(current, a, b, side > 0 ? 1 : -1);
          if (current.length < 3) break;
        }
        if (current.length >= 3) newManzanos.push(current);
      }
      manzanosConFillets = newManzanos;
    }

    for (let i = 0; i < manzanosConFillets.length; i++) {
      const ring = manzanosConFillets[i];
      if (ring.length < 3) continue;
      const closedRing = [...ring];
      if (
        closedRing[0][0] !== closedRing[closedRing.length - 1][0] ||
        closedRing[0][1] !== closedRing[closedRing.length - 1][1]
      ) {
        closedRing.push([closedRing[0][0], closedRing[0][1]]);
      }
      const newGeom = new PolygonGeom([closedRing]);
      const newFeat = new Feature({ geometry: newGeom });
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
    }
  }

  refreshSourceMetrics(src);
  src.changed();
}
