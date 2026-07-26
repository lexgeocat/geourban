import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import Map from 'ol/Map.js';
import VectorSource from 'ol/source/Vector.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { extend as extendExtent, intersects as extentIntersects, Extent } from 'ol/extent.js';
import { refreshSourceMetrics, updateFeatureMetrics } from '../geo/metrics';
import { clipHalfPlane, pointInPoly, polyArea, type Pt } from '../geo/polygonEngine';
import { useSelectionStore } from './selectionStore';
import { useStreetStore, type Street } from './streetStore';
import { useRoundaboutStore, type Roundabout } from './roundaboutStore';
import { useManzanoStore } from './manzanoStore';
import { useLayersStore } from './layersRegistryStore';
import { useRecomputeStatusStore } from './recomputeStatusStore';
import {
  validateTopologyInWorker,
  computeManzanosInWorker,
  subdivideManzanoInWorker,
  findOverlapsInWorker,
  findGapsInWorker,
} from '../workers/geoWorkerClient';
import { useTopologyWarningsStore } from './topologyWarningsStore';
import type { FeatureCollection, Feature as GeoJSONFeature } from 'geojson';
import Feature from 'ol/Feature.js';
import PolygonGeom from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';
import { runCommand } from '../commands/CommandStack';
import { DeleteFeaturesCommand } from '../commands/DeleteFeaturesCommand';
import { ensureKind, getFeatureKind, getLotStatus, setLotStatus } from '../core/objectModel';
import type { ManzanoLoteMethod } from '../geo/subdivisionAlgorithms';
import { buildRoadNetworkRings } from '../geo/roadNetworkEngine';
import { roundRingReflex } from '../geo/ringFillet';

const geoJsonFormat = new GeoJSON();

type CursorCoords = { x: number; y: number; isProjected?: boolean } | null;

export type ViewConfig = {
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
  restoreDrawFeatures: (geojson: any) => void;
  setCursorCoords: (coords: CursorCoords) => void;
  setZoom: (zoom: number) => void;
  setViewConfig: (config: ViewConfig) => void;
  fitToExtent: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  deleteSelected: () => number;
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

interface RoadElementFingerprint {
  hash: string;
  extent: Extent;
}

/** Fase 6, punto 3: fingerprint por elemento vial — permite acotar el
 *  recompute a la región que cambió, no al bbox de TODA la red vial. */
let lastRoadFingerprints = new globalThis.Map<string, RoadElementFingerprint>();

export function resetIncrementalRoadTracking(): void {
  lastRoadFingerprints = new globalThis.Map();
}

function streetFingerprint(s: Street): string {
  return `${s.start[0]},${s.start[1]}|${s.end[0]},${s.end[1]}|${s.widthM}|${s.sideWidthM}|${(s.waypoints ?? []).map((w) => `${w[0]},${w[1]}`).join(';')}`;
}

function streetApproxExtent(s: Street): Extent {
  const half = s.widthM / 2 + Math.max(0, s.sideWidthM ?? 0) + 2;
  const pts: Array<[number, number]> = [s.start, ...(s.waypoints ?? []), s.end];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX - half, minY - half, maxX + half, maxY + half];
}

function roundaboutFingerprint(r: Roundabout): string {
  return `${r.center[0]},${r.center[1]}|${r.radiusM}|${r.sides}|${r.rotation}|${r.roadWidthM}|${r.sidewalkWidthM}`;
}

function roundaboutApproxExtent(r: Roundabout): Extent {
  const half = r.radiusM + r.roadWidthM + Math.max(0, r.sidewalkWidthM) + 2;
  return [r.center[0] - half, r.center[1] - half, r.center[0] + half, r.center[1] + half];
}

function resolveManzanaLayerId(): string | undefined {
  const reg = useLayersStore.getState();
  if (reg.activeLayerId) {
    const active = reg.getById(reg.activeLayerId);
    if (active) return active.id;
  }
  return reg.getLayerForKind('manzana')?.id;
}

/** Fase 4: análogo a resolveManzanaLayerId, para lotes creados por la
 *  re-lotización automática dentro de recomputeManzanosImmediate. Se
 *  duplica en vez de importar de commands/AddFeatureCommand.ts por el
 *  mismo motivo que resolveManzanaLayerId (evitar el ciclo de imports
 *  mapStore → commands/AddFeatureCommand → commands/Command → mapStore). */
function resolveLoteLayerId(): string | undefined {
  const reg = useLayersStore.getState();
  if (reg.activeLayerId) {
    const active = reg.getById(reg.activeLayerId);
    if (active) return active.id;
  }
  return reg.getLayerForKind('lote')?.id;
}

/** H-VIA-4: corre en segundo plano, sin bloquear la UI ni el debounce de
 *  recompute. No se `await`ea desde el caller — es "fire and forget"
 *  intencional, el resultado se refleja vía topologyWarningsStore y un
 *  badge en StatusBar. */
async function runBackgroundTopologyCheck(src: VectorSource): Promise<void> {
  useTopologyWarningsStore.getState().setChecking(true);
  try {
    const features = src.getFeatures();
    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features: features.map((f) =>
        geoJsonFormat.writeFeatureObject(f, {
          featureProjection: 'EPSG:3857',
          dataProjection: 'EPSG:3857',
        })
      ),
    };
    const [overlaps, gaps] = await Promise.all([
      findOverlapsInWorker(collection),
      findGapsInWorker(collection),
    ]);

    // Fase 3, punto 6: mapear cada índice de overlap de vuelta a un id
    // de manzana (o lotGroupId, si el feature involucrado es un lote)
    // para que ManzanoPanel pueda marcar la tarjeta afectada, no solo
    // mostrar un contador global en StatusBar.
    const affected = new Set<string>();
    const attributeToManzano = (idx: number) => {
      const f = features[idx] as Feature<Geometry> | undefined;
      if (!f) return;
      const kind = getFeatureKind(f);
      if (kind === 'manzana') {
        const id = f.getId();
        if (id != null) affected.add(String(id));
      } else if (kind === 'lote') {
        const gid = f.get('lotGroupId') as string | undefined;
        if (gid) affected.add(gid);
      }
    };
    for (const o of overlaps) {
      attributeToManzano(o.indexA);
      attributeToManzano(o.indexB);
    }

    useTopologyWarningsStore.getState().setResults(overlaps.length, gaps.features.length, affected);
  } catch (err) {
    console.error('Validación topológica automática falló', err);
    useTopologyWarningsStore.getState().setChecking(false);
  }
}

/** Wrapper público — antes solo lo llamaba recomputeManzanosImmediate
 *  (trazado vial, Fase 2). Ahora también lo llaman SubdivideCommand,
 *  RecomputeManzanoLotsCommand y GenerateLotsCommand (Fase 3, punto 6),
 *  para que el badge de topología se mantenga al día sin importar qué
 *  operación tocó el drawSource. */
export function checkTopologyInBackground(): void {
  const src = useMapStore.getState().drawSource;
  if (!src) return;
  void runBackgroundTopologyCheck(src);
}

/**
 * Cuerpo real de recomputeManzanos() — ver wrapper debounced más abajo.
 *
 * Fase 4 (ver diagnostico-motores-lotizacion-vial.md): además de
 * reconstruir los fragmentos de manzano contra el estado actual de
 * calles+rotondas, esta versión:
 *
 *  1. Acota el viaje al worker a los orígenes cuyo extent intersecta el
 *     extent de la red vial (broad-phase barato antes del union+difference
 *     caro) — orígenes lejos de cualquier calle/rotonda no pueden haber
 *     sido afectados y se dejan completamente intactos.
 *  2. Si un origen tenía lotes vivos (lotStatus 'subdivided') antes del
 *     recorte, intenta re-lotizar automáticamente el fragmento resultante
 *     con el mismo método/dirección/área que tenía guardado.
 *  3. Si el recorte partió ese origen en 2+ fragmentos (reparto de área
 *     ambiguo) o la re-lotización automática no generó lotes, marca el/los
 *     fragmento(s) como lotStatus 'pending' — el usuario los regenera a
 *     mano desde ManzanoPanel (badge "⏳ pendiente de re-lotizar").
 *
 * NOTA (hallazgo colateral, no resuelto acá): la clasificación "untouched"
 * compara el fragmento nuevo contra `origPts` (el polígono ORIGINAL sin
 * cortar), no contra la geometría actual del manzano. Esto significa que
 * un manzano que ya fue cortado alguna vez por una calle SIEMPRE se
 * re-clasifica como "no tocado" en cualquier recompute posterior (aunque
 * la calle nueva esté en la otra punta del proyecto y su extent no
 * intersecte), y se regenera con id nuevo cada vez — es la causa raíz de
 * H-VIA-11. El acotamiento espacial de este pase ayuda para orígenes
 * genuinamente lejos de TODA la red vial, pero no resuelve esto: requiere
 * diffing incremental contra lo que cambió (no contra el estado completo),
 * que queda fuera del alcance de esta fase.
 */
async function recomputeManzanosImmediate(): Promise<void> {
  const src = useMapStore.getState().drawSource;
  if (!src) return;

  const streets = useStreetStore.getState().streets;
  const roundabouts = useRoundaboutStore.getState().roundabouts;
  if (streets.length === 0 && roundabouts.length === 0) return;

  type OriginGroup = {
    origId: string;
    origPts: Pt[];
    members: Array<Feature<Geometry>>;
    /** Fase 4: método/dirección guardados en manzanoStore para el primer
     *  miembro con lotStatus 'subdivided' — se pierden en cuanto el
     *  feature original se reemplaza por fragmentos nuevos más abajo. */
    savedMethod: ManzanoLoteMethod | null;
    savedDirPref: { ax: number; ay: number } | undefined;
    wasSubdivided: boolean;
  };
  const groups = new globalThis.Map<string, OriginGroup>();
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
      group = { origId, origPts, members: [], savedMethod: null, savedDirPref: undefined, wasSubdivided: false };
      groups.set(origId, group);
    }
    group.members.push(feature);

    if (kind === 'manzana' && getLotStatus(feature) === 'subdivided') {
      group.wasSubdivided = true;
      const fid = feature.getId();
      if (fid != null && group.savedMethod === null) {
        group.savedMethod = useManzanoStore.getState().getMethod(fid);
        group.savedDirPref = useManzanoStore.getState().getRotateDir(fid);
      }
    }
  });

  if (groups.size === 0) return;

  const roadRings = buildRoadNetworkRings(streets, roundabouts);
  if (roadRings.length === 0) return;

  const roadExtentForOrphans = ringsExtent(roadRings);

  // Fase 6, punto 3: acotar el recompute a la región que REALMENTE
  // cambió desde la última pasada — antes se usaba el bbox de TODA la
  // red vial, que en un proyecto grande puede cubrir casi todo aunque
  // el cambio real sea una sola calle nueva en una esquina.
  const currentFingerprints = new globalThis.Map<string, RoadElementFingerprint>();
  for (const s of streets) {
    currentFingerprints.set(`s:${s.id}`, { hash: streetFingerprint(s), extent: streetApproxExtent(s) });
  }
  for (const rb of roundabouts) {
    currentFingerprints.set(`r:${rb.id}`, { hash: roundaboutFingerprint(rb), extent: roundaboutApproxExtent(rb) });
  }
  let changedExtent: Extent | null = null;
  for (const [key, fp] of currentFingerprints) {
    const prev = lastRoadFingerprints.get(key);
    if (!prev || prev.hash !== fp.hash) {
      if (changedExtent) extendExtent(changedExtent, fp.extent);
      else changedExtent = [...fp.extent] as Extent;
    }
  }
  for (const [key, prev] of lastRoadFingerprints) {
    if (!currentFingerprints.has(key)) {
      if (changedExtent) extendExtent(changedExtent, prev.extent);
      else changedExtent = [...prev.extent] as Extent;
    }
  }
  lastRoadFingerprints = currentFingerprints;

  // H-LOT-2 (Fase 0): huérfanos de manzanas ya borradas por "Generar todos".
  if (roadExtentForOrphans) {
    for (const [gid, lots] of lotsByGroupId) {
      if (src.getFeatureById(gid) != null) continue;
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

  // Fase 4, punto 4: acotamiento espacial — ver nota de cabecera sobre
  // sus límites reales.
  const allGroups = Array.from(groups.values());
  const parcelIndexToGroup: OriginGroup[] = roadExtentForOrphans
    ? allGroups.filter((g) => {
        const ext = ringsExtent([g.origPts]);
        if (ext == null) return false;
        if (changedExtent && !extentIntersects(ext, changedExtent)) return false;
        return extentIntersects(ext, roadExtentForOrphans);
      })
    : allGroups;

  if (parcelIndexToGroup.length === 0) return;

  const roadNetworkFC: FeatureCollection = {
    type: 'FeatureCollection',
    features: roadRings.map((ring) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closeGeoRing(ring)] },
    })) as never[],
  };

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

  const targetAreaM2 = useManzanoStore.getState().targetAreaM2;
  const frontMinM = useManzanoStore.getState().frontMinM;

  for (let idx = 0; idx < parcelIndexToGroup.length; idx++) {
    const group = parcelIndexToGroup[idx];
    const fragments = fragmentsByGroup.get(idx) ?? [];

    const untouched =
      fragments.length === 1 && polyArea(fragments[0]) >= polyArea(group.origPts) * 0.999;

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
      orig.unset('lotStatus', true);
      orig.set('origParcelId', group.origId, true);
      orig.set('origPts', group.origPts, true);
      src.addFeature(orig);
      updateFeatureMetrics(orig as Feature<Geometry>);
      continue;
    }

    const newFragmentIds: string[] = [];
    fragments.forEach((ring, i) => {
      const rounded = roundRingReflex(ring);
      if (rounded.length < 4) return;
      const newFeat = new Feature({ geometry: new PolygonGeom([rounded]) });
      const newId = `${group.origId}-mzn-${i}`;
      newFeat.setId(newId);
      newFeat.setProperties(
        ensureKind(
          {
            colorIdx: i % 10,
            createdAt: new Date().toISOString(),
            origParcelId: group.origId,
            origPts: group.origPts,
          },
          'manzana',
        ),
      );
      const lid = resolveManzanaLayerId();
      if (lid) newFeat.set('layerId', lid);
      src.addFeature(newFeat);
      updateFeatureMetrics(newFeat as Feature<Geometry>);
      newFragmentIds.push(newId);
    });

    // Fase 4, puntos 1-2: qué hacer con el/los fragmento(s) de un origen
    // que SÍ tenía lotes vivos antes del corte.
    if (group.wasSubdivided && group.savedMethod) {
      if (newFragmentIds.length === 1) {
        const fragId = newFragmentIds[0];
        const fragFeat = src.getFeatureById(fragId) as Feature<Geometry> | null;
        const fragGeom = fragFeat?.getGeometry();

        if (fragFeat && fragGeom instanceof PolygonGeom) {
          const ring = ((fragGeom.getCoordinates()[0] ?? []) as number[][]).map(
            (c) => [c[0], c[1]] as Pt,
          );
          try {
            const lots = await subdivideManzanoInWorker(
              ring,
              group.savedMethod,
              targetAreaM2,
              frontMinM,
              group.savedDirPref,
            );
            let created = 0;
            lots.forEach((lot, i) => {
              if (lot.pts.length < 3) return;
              const closedRing = [...lot.pts];
              if (
                closedRing[0][0] !== closedRing[closedRing.length - 1][0] ||
                closedRing[0][1] !== closedRing[closedRing.length - 1][1]
              ) {
                closedRing.push([closedRing[0][0], closedRing[0][1]]);
              }
              const lotFeat = new Feature({ geometry: new PolygonGeom([closedRing]) });
              const lotId = `lot-${fragId}-${Date.now()}-${i}`;
              lotFeat.setId(lotId);
              lotFeat.setProperties(
                ensureKind(
                  {
                    subdivision: group.savedMethod,
                    lotGroupId: fragId,
                    label: lot.isRemnant ? `Remanente ${i + 1}` : `Lote ${i + 1}`,
                    areaM2: lot.areaM2,
                    frontM: lot.frontM,
                    depthM: lot.depthM,
                    isRemnant: lot.isRemnant,
                  },
                  'lote',
                ),
              );
              const lotLid = resolveLoteLayerId();
              if (lotLid) lotFeat.set('layerId', lotLid);
              src.addFeature(lotFeat);
              updateFeatureMetrics(lotFeat as Feature<Geometry>);
              created++;
            });
            setLotStatus(fragFeat, created > 0 ? 'subdivided' : 'pending');
            useManzanoStore.getState().setMethod(fragId, group.savedMethod);
            if (group.savedDirPref) useManzanoStore.getState().setRotateDir(fragId, group.savedDirPref);
          } catch (err) {
            console.error('recomputeManzanos: fallo la re-lotización automática', err);
            setLotStatus(fragFeat, 'pending');
          }
        } else if (fragFeat) {
          setLotStatus(fragFeat, 'pending');
        }
      } else if (newFragmentIds.length > 1) {
        // Corte ambiguo: el manzano se partió en 2+ piezas. No hay forma
        // confiable de repartir el área objetivo original entre ellas —
        // se marcan 'pending', el usuario decide método/área por fragmento
        // a mano en ManzanoPanel (se preserva el método que tenía, como
        // punto de partida).
        for (const fragId of newFragmentIds) {
          const fragFeat = src.getFeatureById(fragId) as Feature<Geometry> | null;
          setLotStatus(fragFeat, 'pending');
          useManzanoStore.getState().setMethod(fragId, group.savedMethod);
        }
      }
    }
  }

  const aliveManzanoIds = new Set<string>();
  src.forEachFeature((f) => {
    if (getFeatureKind(f as Feature<Geometry>) === 'manzana') {
      const id = f.getId();
      if (id != null) aliveManzanoIds.add(String(id));
    }
  });
  useManzanoStore.getState().pruneToIds(aliveManzanoIds);

  src.changed();
  void runBackgroundTopologyCheck(src);
}

const RECOMPUTE_DEBOUNCE_MS = 250;
let recomputeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let recomputeInFlight: Promise<void> | null = null;
let recomputeResolve: (() => void) | null = null;
let recomputeReject: ((err: unknown) => void) | null = null;

export function recomputeManzanos(): Promise<void> {
  if (!recomputeInFlight) {
    recomputeInFlight = new Promise<void>((resolve, reject) => {
      recomputeResolve = resolve;
      recomputeReject = reject;
    });
  }
  useRecomputeStatusStore.getState().setRunning(true);
  if (recomputeDebounceTimer) clearTimeout(recomputeDebounceTimer);
  recomputeDebounceTimer = setTimeout(() => {
    recomputeDebounceTimer = null;
    const resolve = recomputeResolve!;
    const reject = recomputeReject!;
    recomputeInFlight = null;
    recomputeResolve = null;
    recomputeReject = null;
    recomputeManzanosImmediate()
      .then(resolve, reject)
      .finally(() => useRecomputeStatusStore.getState().setRunning(false));
  }, RECOMPUTE_DEBOUNCE_MS);
  return recomputeInFlight;
}