// src/geo/recomputeManzanos.ts
//
// Fase 5, punto 3: antes esta orquestación (recorte de manzanos contra
// la red vial + re-lotización automática + fingerprint incremental)
// vivía mezclada con la definición del store Zustand en
// store/map/mapStore.ts (~470 líneas). Es lógica de negocio pura sobre
// drawSource, no estado de UI — se separa acá; mapStore.ts queda con
// SOLO la definición del store.
import { extend as extendExtent, intersects as extentIntersects, type Extent } from 'ol/extent.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import Feature from 'ol/Feature.js';
import PolygonGeom from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';
import type VectorSource from 'ol/source/Vector.js';
import type { FeatureCollection, Feature as GeoJSONFeature } from 'geojson';

import { useMapStore } from '../store/map/mapStore';
import { refreshSourceMetrics, updateFeatureMetrics } from './metrics';
import { polyArea, type Pt } from './math/polygonEngine';
import { useStreetStore, type Street } from '../store/entities/streetStore';
import { useRoundaboutStore, type Roundabout } from '../store/entities/roundaboutStore';
import { useManzanoStore } from '../store/entities/manzanoStore';
import { useLayersStore } from '../store/entities/layersRegistryStore';
import { useRecomputeStatusStore } from '../store/ui/recomputeStatusStore';
import {
  computeManzanosInWorker,
  subdivideManzanoInWorker,
  findOverlapsInWorker,
  findGapsInWorker,
} from '../workers/geoWorkerClient';
import { useTopologyWarningsStore } from '../store/topologyWarningsStore';
import { ensureKind, getFeatureKind, getLotStatus, setLotStatus } from '../core/objectModel';
import type { ManzanoLoteMethod } from './subdivision/subdivisionAlgorithms';
import { buildRoadNetworkRings } from './roads/roadNetworkEngine';
import { roundRingReflex } from './roads/ringFillet';

const geoJsonFormat = new GeoJSON();

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

function currentOrOriginalExtent(
  members: Array<Feature<Geometry>>,
  fallbackPts: Pt[],
): Extent | null {
  let ext: Extent | null = null;
  for (const m of members) {
    const geom = m.getGeometry();
    if (!geom) continue;
    const e = geom.getExtent();
    if (!ext) ext = [...e] as Extent;
    else extendExtent(ext, e);
  }
  return ext ?? ringsExtent([fallbackPts]);
}

function fragmentsMatchCurrentMembers(
  members: Array<Feature<Geometry>>,
  fragments: Pt[][],
): boolean {
  if (members.length === 0 || members.length !== fragments.length) return false;
  const currentAreas: number[] = [];
  for (const m of members) {
    const g = m.getGeometry();
    if (!(g instanceof PolygonGeom)) return false;
    const ring = ((g.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt);
    if (ring.length < 3) return false;
    currentAreas.push(polyArea(ring));
  }
  const fragAreas = fragments.map((f) => polyArea(f));
  currentAreas.sort((a, b) => a - b);
  fragAreas.sort((a, b) => a - b);
  for (let i = 0; i < currentAreas.length; i++) {
    const c = currentAreas[i], f = fragAreas[i];
    const tol = Math.max(0.5, Math.max(c, f) * 2e-3);
    if (Math.abs(c - f) > tol) return false;
  }
  return true;
}

interface RoadElementFingerprint {
  hash: string;
  extent: Extent;
}

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

function resolveLoteLayerId(): string | undefined {
  const reg = useLayersStore.getState();
  if (reg.activeLayerId) {
    const active = reg.getById(reg.activeLayerId);
    if (active) return active.id;
  }
  return reg.getLayerForKind('lote')?.id;
}

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

/** Público — lo llaman SubdivideCommand, GenerateLotsCommand,
 *  RecomputeManzanoLotsCommand y `recomputeManzanosImmediate` acá abajo. */
export function checkTopologyInBackground(): void {
  const src = useMapStore.getState().drawSource;
  if (!src) return;
  void runBackgroundTopologyCheck(src);
}

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

  const allGroups = Array.from(groups.values());
  const parcelIndexToGroup: OriginGroup[] = roadExtentForOrphans
    ? allGroups.filter((g) => {
        const ext = currentOrOriginalExtent(g.members, g.origPts);
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

  const groupsNeedingRelotConfirm: OriginGroup[] = [];
  for (let idx = 0; idx < parcelIndexToGroup.length; idx++) {
    const group = parcelIndexToGroup[idx];
    const fragments = fragmentsByGroup.get(idx) ?? [];
    const untouched =
      fragments.length === 1 && polyArea(fragments[0]) >= polyArea(group.origPts) * 0.999;
    if (untouched) continue;
    if (fragmentsMatchCurrentMembers(group.members, fragments)) continue;
    if (group.wasSubdivided && group.savedMethod && fragments.length === 1) {
      groupsNeedingRelotConfirm.push(group);
    }
  }

  let allowAutoRelot = true;
  if (groupsNeedingRelotConfirm.length > 0) {
    const plural = groupsNeedingRelotConfirm.length > 1;
    const names = groupsNeedingRelotConfirm.map((g) => `Manzano ${g.origId}`).join(', ');
    allowAutoRelot = window.confirm(
      `El trazado nuevo va a recortar y regenerar automáticamente los lotes de ` +
      `${plural ? 'estos manzanos' : 'este manzano'}: ${names}.\n\n¿Continuar?\n\n` +
      'Si cancelás, el corte igual se aplica pero los lotes quedan pendientes de regenerar a mano.'
    );
  }

  for (let idx = 0; idx < parcelIndexToGroup.length; idx++) {
    const group = parcelIndexToGroup[idx];
    const fragments = fragmentsByGroup.get(idx) ?? [];

    const untouched =
      fragments.length === 1 && polyArea(fragments[0]) >= polyArea(group.origPts) * 0.999;

    if (!untouched && fragmentsMatchCurrentMembers(group.members, fragments)) {
      continue;
    }

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

    if (group.wasSubdivided && group.savedMethod) {
      if (newFragmentIds.length === 1 && allowAutoRelot) {
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
      } else if (newFragmentIds.length === 1 && !allowAutoRelot) {
        const fragId = newFragmentIds[0];
        const fragFeat = src.getFeatureById(fragId) as Feature<Geometry> | null;
        setLotStatus(fragFeat, 'pending');
        useManzanoStore.getState().setMethod(fragId, group.savedMethod);
      } else if (newFragmentIds.length > 1) {
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