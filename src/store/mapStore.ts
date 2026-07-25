import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import Map from 'ol/Map.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { extend as extendExtent, intersects as extentIntersects, Extent } from 'ol/extent.js';
import { refreshSourceMetrics, updateFeatureMetrics } from '../geo/metrics';
import { clipHalfPlane, pointInPoly, polyArea, type Pt } from '../geo/polygonEngine';
import { useSelectionStore } from './selectionStore';
import { useStreetStore } from './streetStore';
import { useRoundaboutStore } from './roundaboutStore';
import { useManzanoStore } from './manzanoStore';
import { useLayersStore } from './layersRegistryStore';
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

/** Extent combinado de un conjunto de anillos (para el chequeo broad-phase
 *  de H-LOT-2 más abajo). */
function ringsExtent(rings: Pt[][]): Extent | null {
  let result: Extent | null = null;
  for (const ring of rings) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!isFinite(minX)) continue;
    const e: Extent = [minX, minY, maxX, maxY];
    if (!result) result = e;
    else extendExtent(result, e);
  }
  return result;
}

/** Resuelve el layerId para una manzana nueva (capa activa, o la primera
 *  capa registrada para kind 'manzana'). Duplica intencionalmente la
 *  lógica de resolveLayerId() de AddFeatureCommand.ts en vez de
 *  importarla, para no crear un ciclo de imports
 *  (mapStore → commands/AddFeatureCommand → commands/Command → mapStore). */
function resolveManzanaLayerId(): string | undefined {
  const reg = useLayersStore.getState();
  if (reg.activeLayerId) {
    const active = reg.getById(reg.activeLayerId);
    if (active) return active.id;
  }
  return reg.getLayerForKind('manzana')?.id;
}

/**
 * Cuerpo real de recomputeManzanos() — ver wrapper debounced más abajo.
 * Reconstruye TODOS los fragmentos de manzano desde las parcelas
 * originales (origParcelId/origPts), cortando contra el estado COMPLETO
 * actual de calles+rotondas.
 */
async function recomputeManzanosImmediate(): Promise<void> {
  const src = useMapStore.getState().drawSource;
  if (!src) return;

  const streets = useStreetStore.getState().streets;
  const roundabouts = useRoundaboutStore.getState().roundabouts;
  if (streets.length === 0 && roundabouts.length === 0) return;

  type OriginGroup = { origId: string; origPts: Pt[]; members: Array<Feature<Geometry>> };
  const groups = new globalThis.Map<string, OriginGroup>();

  // H-LOT-2/3 (Fase 0): las features kind='lote' con lotGroupId son hijas
  // de una manzana ya lotizada — quedan afuera del escaneo de orígenes,
  // pero las guardamos acá agrupadas por lotGroupId para poder limpiarlas
  // más abajo si su manzana "padre" se reconstruye o ya no existe.
  const lotsByGroupId = new globalThis.Map<string, Array<Feature<Geometry>>>();

  src.forEachFeature((f) => {
    const feature = f as Feature<Geometry>;
    const geom = feature.getGeometry();
    if (!geom || geom.getType() !== 'Polygon') return;

    const kind = getFeatureKind(feature);
    if (kind !== 'lote' && kind !== 'manzana') return;

    if (kind === 'lote') {
      const gid = feature.get('lotGroupId') as string | undefined;
      if (gid) {
        if (!lotsByGroupId.has(gid)) lotsByGroupId.set(gid, []);
        lotsByGroupId.get(gid)!.push(feature);
        return;
      }
    }

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

  // H-LOT-2 (Fase 0): grupos de lotes cuya manzana "padre" ya NO existe
  // como feature (el usuario corrió "Generar todos", que borra la
  // manzana). Sin un origen vivo no hay forma de re-cortarlos con
  // precisión (eso queda para una fase posterior de regeneración
  // automática); acá, siguiendo el mínimo del diagnóstico, se eliminan
  // si su extent se solapa con la red vial nueva, para no dejarlos
  // huérfanos y superpuestos a la calle. Los grupos cuya manzana SÍ
  // sigue viva se resuelven más abajo, dentro del loop principal.
  const roadExtentForOrphans = ringsExtent(roadRings);
  if (roadExtentForOrphans) {
    for (const [gid, lots] of lotsByGroupId) {
      if (src.getFeatureById(gid) != null) continue; // manzana viva: la maneja el loop principal
      let lotsExtent: Extent | null = null;
      for (const lot of lots) {
        const g = lot.getGeometry();
        if (!g) continue;
        const e = g.getExtent();
        if (!lotsExtent) lotsExtent = [...e] as Extent;
        else extendExtent(lotsExtent, e);
      }
      if (lotsExtent && extentIntersects(lotsExtent, roadExtentForOrphans)) {
        for (const lot of lots) {
          if (src.getFeatureById(lot.getId() as string | number) != null) {
            src.removeFeature(lot);
          }
        }
      }
    }
  }

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

    const untouched =
      fragments.length === 1 && polyArea(fragments[0]) >= polyArea(group.origPts) * 0.999;

    // H-LOT-3 (Fase 0): si el origen SÍ cambió (no está "untouched"), un
    // miembro manzana de este grupo puede tener lotes hijos vivos
    // (RecomputeManzanoLotsCommand no borra la manzana al lotizar) — esos
    // lotes quedarían huérfanos/superpuestos en cuanto reemplacemos la
    // manzana por los fragmentos nuevos. Se eliminan acá. Si está
    // "untouched" no se toca nada: la manzana (y sus lotes, si los
    // tiene) siguen siendo geométricamente válidos.
    if (!untouched) {
      for (const m of group.members) {
        const mid = m.getId();
        if (mid == null) continue;
        const childLots = lotsByGroupId.get(String(mid));
        if (!childLots) continue;
        for (const lot of childLots) {
          if (src.getFeatureById(lot.getId() as string | number) != null) {
            src.removeFeature(lot);
          }
        }
      }
    }

    for (const m of group.members) src.removeFeature(m);

    if (untouched) {
      const orig = group.members[0];
      orig.setGeometry(new PolygonGeom([closeGeoRing(fragments[0])]));
      orig.set('kind', 'lote', true);
      orig.set('origParcelId', group.origId, true);
      orig.set('origPts', group.origPts, true);
      src.addFeature(orig);
      updateFeatureMetrics(orig as Feature<Geometry>);
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
            // Fase 0 (§4): ya no se escribe `type` — `kind` es la única
            // fuente de verdad (ver core/objectModel.ts).
            colorIdx: i % 10,
            createdAt: new Date().toISOString(),
            origParcelId: group.origId,
            origPts: group.origPts,
          },
          'manzana',
        ),
      );
      // Fase 0 (§4): asignar layerId explícito — antes las manzanas de
      // este flujo dependían exclusivamente del fallback `type==='manzana'`
      // del match de WebGL (DrawLayerRenderer.buildWebglStyle), que ya no
      // existe.
      const lid = resolveManzanaLayerId();
      if (lid) newFeat.set('layerId', lid);
      src.addFeature(newFeat);
      updateFeatureMetrics(newFeat as Feature<Geometry>);
    });
  });

  // H-LOT-10 (Fase 0): purga manzanoStore de ids que ya no existen en
  // drawSource — los fragmentos nuevos siempre reciben id nuevo
  // (`${origId}-mzn-${i}`), así que el manzano viejo queda huérfano en
  // methods/rotateDir/geomSnapshots/openCards si no se poda acá.
  const aliveManzanoIds = new Set<string>();
  src.forEachFeature((f) => {
    if (getFeatureKind(f as Feature<Geometry>) === 'manzana') {
      const id = f.getId();
      if (id != null) aliveManzanoIds.add(String(id));
    }
  });
  useManzanoStore.getState().pruneToIds(aliveManzanoIds);

  src.changed();
}

const RECOMPUTE_DEBOUNCE_MS = 250;
let recomputeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let recomputeInFlight: Promise<void> | null = null;
let recomputeResolve: (() => void) | null = null;
let recomputeReject: ((err: unknown) => void) | null = null;

/**
 * Versión debounced de recomputeManzanosImmediate() — ver diagnóstico
 * H12. `recomputeManzanosImmediate()` reconstruye TODOS los fragmentos de
 * manzano contra el estado COMPLETO de calles/rotondas; si el usuario
 * traza varias calles en sucesión rápida, cada llamada directa repetiría
 * ese trabajo completo una vez por calle. Con el debounce, las llamadas
 * dentro de la ventana comparten UNA sola ejecución real — y la MISMA
 * Promise — así que cada llamador (`AddStreetCommand`/
 * `AddRoundaboutCommand`) puede seguir haciendo `await recomputeManzanos()`
 * de forma segura: se resuelve cuando el cómputo compartido corrió con el
 * estado más reciente.
 *
 * IMPORTANTE: por esto mismo, `AddStreetCommand`/`AddRoundaboutCommand`
 * fusionan (`coalesceInto`) instancias trazadas dentro de la ventana de
 * coalescing del CommandStack en una sola entrada de historial — si no,
 * dos comandos que comparten un recompute podrían capturar snapshots
 * "before" inconsistentes entre sí. Ver AddStreetCommand.ts.
 */
export function recomputeManzanos(): Promise<void> {
  if (!recomputeInFlight) {
    recomputeInFlight = new Promise<void>((resolve, reject) => {
      recomputeResolve = resolve;
      recomputeReject = reject;
    });
  }
  if (recomputeDebounceTimer) clearTimeout(recomputeDebounceTimer);
  recomputeDebounceTimer = setTimeout(() => {
    recomputeDebounceTimer = null;
    const resolve = recomputeResolve!;
    const reject = recomputeReject!;
    recomputeInFlight = null;
    recomputeResolve = null;
    recomputeReject = null;
    recomputeManzanosImmediate().then(resolve, reject);
  }, RECOMPUTE_DEBOUNCE_MS);
  return recomputeInFlight;
}