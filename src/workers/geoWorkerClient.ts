import { invoke } from '@tauri-apps/api/core';
import type { FeatureCollection, Polygon as GeoJsonPolygon } from 'geojson';
import type { SubdivisionOptions, SubdivisionResult, ManzanoLoteMethod } from '../geo/subdivision/types';
import type { LotResult } from '../geo/math/polygonEngine';
import type { Street } from '../store/entities/streetStore';
import type { RoundaboutParams } from '../geo/roundabout/roundaboutEngine';
import type { CornerMode } from '../geo/roads/ringFillet';
import type { RoadNetworkNet } from '../geo/roads/types';
import type { Pt } from '../geo/math/polygonEngine';

// ─── Runtime nativo (obligatorio desde 2.7) ───────────────────────────

function requireNativeRuntime(): void {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
    throw new Error(
      'GeoUrban requiere el motor nativo (Rust/GEOS), disponible solo en la app de escritorio (Tauri). ' +
        'Esta build no incluye motor de geometría JS — la versión web congelada vive en el branch web-version.',
    );
  }
}

function toNativeSubdivisionOptions(options: SubdivisionOptions) {
  return {
    method: options.method,
    targetAreaM2: options.targetAreaM2 ?? null,
    frontMinM: options.frontMinM ?? null,
    dirAx: options.dirAx ?? null,
    dirAy: options.dirAy ?? null,
    frenteSeg: options.frenteSeg ?? null,
    auxSeg: options.auxSeg ?? null,
    cutLine: options.cutLine ?? null,
  };
}

function toNativeDirPref(dirPref?: { ax: number; ay: number }) {
  return dirPref ? { ax: dirPref.ax, ay: dirPref.ay } : null;
}

// ─── Operaciones nativas ───────────────────────────────────────────────

async function subdivideNative(
  polygon: GeoJsonPolygon,
  options: SubdivisionOptions,
): Promise<SubdivisionResult> {
  const result = await invoke<SubdivisionResult>('subdivide', {
    coordinates: polygon.coordinates as unknown as Array<Array<[number, number]>>,
    options: toNativeSubdivisionOptions(options),
  });
  return result;
}

async function subdivideManzanoNative(
  ring: [number, number][],
  method: ManzanoLoteMethod,
  targetAreaM2: number,
  frontMinM: number,
  dirPref?: { ax: number; ay: number },
): Promise<LotResult[]> {
  const lots = await invoke<LotResult[]>('subdivide_manzano', {
    ring,
    method,
    targetAreaM2,
    frontMinM,
    dirPref: toNativeDirPref(dirPref),
  });
  return lots;
}

async function subdivideManzanoBatchNative(
  manzanos: Array<{
    id: string | number;
    ring: [number, number][];
    method: ManzanoLoteMethod;
    targetAreaM2: number;
    frontMinM: number;
    dirPref?: { ax: number; ay: number };
  }>,
): Promise<Array<{ id: string | number; lots: LotResult[] }>> {
  const results = await invoke<Array<{ id: string | number; lots: LotResult[] }>>(
    'subdivide_manzano_batch',
    {
      manzanos: manzanos.map((m) => ({
        id: m.id,
        ring: m.ring,
        method: m.method,
        targetAreaM2: m.targetAreaM2,
        frontMinM: m.frontMinM,
        dirPref: toNativeDirPref(m.dirPref),
      })),
    },
  );
  return results;
}

async function computeManzanosNative(
  parcels: FeatureCollection,
  roadNetwork: FeatureCollection,
): Promise<FeatureCollection> {
  const parcelRings = parcels.features.map((f) => {
    const geom = f.geometry as GeoJsonPolygon;
    return geom.coordinates as unknown as Pt[][];
  });
  const roadRings = roadNetwork.features.map((f) => {
    const geom = f.geometry as GeoJsonPolygon;
    return geom.coordinates[0] as unknown as Pt[];
  });
  const fragments = await invoke<Array<{ origParcelIndex: number; rings: Pt[][] }>>(
    'compute_manzanos_cmd',
    { parcels: parcelRings, roadNetwork: roadRings },
  );
  const result: FeatureCollection = {
    type: 'FeatureCollection',
    features: fragments.map((frag) => ({
      type: 'Feature',
      properties: { origParcelIndex: frag.origParcelIndex },
      geometry: { type: 'Polygon', coordinates: frag.rings } as GeoJsonPolygon,
    })) as never[],
  };
  return result;
}

async function computeRoadNetworkNetNative(
  streets: Street[],
  roundabouts: RoundaboutParams[],
  cornerMode: CornerMode,
): Promise<RoadNetworkNet> {
  const net = await invoke<RoadNetworkNet>('compute_road_network_net_cmd', {
    streets,
    roundabouts,
    cornerMode,
  });
  return net;
}

async function matchFragmentsBatchNative(
  items: MatchFragmentsBatchItem[],
): Promise<MatchFragmentsBatchResultItem[]> {
  const results = await invoke<MatchFragmentsBatchResultItem[]>('match_fragments_batch', {
    items: items.map((it) => ({
      groupIdx: it.groupIdx,
      fragments: it.fragments,
      memberRings: it.memberRings,
    })),
  });
  return results;
}

// ─── API pública ───────────────────────────────────────────────────────

export async function computeManzanosInWorker(
  parcels: FeatureCollection,
  roadNetwork: FeatureCollection,
) {
  requireNativeRuntime();
  try {
    const nativeResult = await computeManzanosNative(parcels, roadNetwork);
    return nativeResult;
  } catch (err) {
    console.error('geoWorkerClient: "computeManzanos" falló en el motor nativo (sin fallback desde 2.7):', err);
    throw err;
  }
}

export async function subdivideInWorker(
  polygon: GeoJsonPolygon,
  options: SubdivisionOptions,
): Promise<SubdivisionResult> {
  requireNativeRuntime();
  try {
    const nativeResult = await subdivideNative(polygon, options);
    return nativeResult;
  } catch (err) {
    console.error('geoWorkerClient: "subdivide" falló en el motor nativo (sin fallback desde 2.7):', err);
    throw err;
  }
}

export async function subdivideManzanoInWorker(
  ring: [number, number][],
  method: ManzanoLoteMethod,
  targetAreaM2: number,
  frontMinM: number,
  dirPref?: { ax: number; ay: number },
): Promise<LotResult[]> {
  requireNativeRuntime();
  try {
    const nativeLots = await subdivideManzanoNative(ring, method, targetAreaM2, frontMinM, dirPref);
    return nativeLots;
  } catch (err) {
    console.error('geoWorkerClient: "subdivide_manzano" falló en el motor nativo (sin fallback desde 2.7):', err);
    throw err;
  }
}

export async function subdivideManzanoBatchInWorker(
  manzanos: Array<{
    id: string | number;
    ring: [number, number][];
    method: ManzanoLoteMethod;
    targetAreaM2: number;
    frontMinM: number;
    dirPref?: { ax: number; ay: number };
  }>,
): Promise<Array<{ id: string | number; lots: LotResult[] }>> {
  requireNativeRuntime();
  try {
    const results = await subdivideManzanoBatchNative(manzanos);
    return results;
  } catch (err) {
    console.error('geoWorkerClient: "subdivide_manzano_batch" falló en el motor nativo (sin fallback desde 2.7):', err);
    throw err;
  }
}

export async function computeRoadNetworkNetInWorker(
  streets: Street[],
  roundabouts: RoundaboutParams[],
  cornerMode: CornerMode,
  _timeoutMs = 6000,
): Promise<RoadNetworkNet> {
  requireNativeRuntime();
  try {
    const nativeNet = await computeRoadNetworkNetNative(streets, roundabouts, cornerMode);
    return nativeNet;
  } catch (err) {
    console.error('geoWorkerClient: "computeRoadNetworkNet" falló en el motor nativo (sin fallback desde 2.7):', err);
    throw err;
  }
}

export interface MatchFragmentsBatchItem {
  groupIdx: number;
  fragments: Pt[][];
  memberRings: Pt[][];
}
export interface MatchFragmentsBatchResultItem {
  groupIdx: number;
  assignments: Array<{ fragmentIdx: number; memberIdx: number | null; overlapArea: number }>;
}

export async function matchFragmentsBatchInWorker(
  items: MatchFragmentsBatchItem[],
  _timeoutMs = 8000,
): Promise<MatchFragmentsBatchResultItem[]> {
  if (items.length === 0) return [];
  requireNativeRuntime();
  try {
    const results = await matchFragmentsBatchNative(items);
    return results;
  } catch (err) {
    console.error('geoWorkerClient: "matchFragmentsBatch" falló en el motor nativo (sin fallback desde 2.7):', err);
    throw err;
  }
}

export interface SpatialIndexItem {
  id: string | number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialIndexQueryResult {
  ids: Array<string | number>;
  hitCount: number;
  queryMs: number;
}

async function spatialIndexLoadNative(items: SpatialIndexItem[], slot: string): Promise<number> {
  const count = await invoke<number>('spatial_index_load', {
    slot,
    items: items.map((it) => ({ id: it.id, minX: it.minX, minY: it.minY, maxX: it.maxX, maxY: it.maxY })),
  });
  return count;
}

async function spatialIndexUpsertBatchNative(items: SpatialIndexItem[], slot: string): Promise<number> {
  const count = await invoke<number>('spatial_index_upsert_batch', {
    slot,
    items: items.map((it) => ({ id: it.id, minX: it.minX, minY: it.minY, maxX: it.maxX, maxY: it.maxY })),
  });
  return count;
}

async function spatialIndexRemoveBatchNative(ids: Array<string | number>, slot: string): Promise<number> {
  const count = await invoke<number>('spatial_index_remove_batch', { slot, ids });
  return count;
}

async function spatialIndexQueryNative(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  slot: string,
): Promise<SpatialIndexQueryResult> {
  const result = await invoke<SpatialIndexQueryResult>('spatial_index_query', { slot, minX, minY, maxX, maxY });
  return result;
}

export async function spatialIndexLoadInWorker(items: SpatialIndexItem[], slot: string): Promise<number> {
  requireNativeRuntime();
  return spatialIndexLoadNative(items, slot);
}

export async function spatialIndexUpsertBatchInWorker(items: SpatialIndexItem[], slot: string): Promise<number> {
  requireNativeRuntime();
  return spatialIndexUpsertBatchNative(items, slot);
}

export async function spatialIndexRemoveBatchInWorker(ids: Array<string | number>, slot: string): Promise<number> {
  requireNativeRuntime();
  return spatialIndexRemoveBatchNative(ids, slot);
}

export async function spatialIndexQueryInWorker(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  slot: string,
): Promise<SpatialIndexQueryResult> {
  requireNativeRuntime();
  return spatialIndexQueryNative(minX, minY, maxX, maxY, slot);
}
