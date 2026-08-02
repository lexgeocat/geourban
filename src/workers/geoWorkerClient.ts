// src/workers/geoWorkerClient.ts
//
// Fase 2.7 — motor de geometría 100% nativo (Rust/GEOS vía Tauri).
//
// El motor JS de referencia (jsts/polygon-clipping en el Web Worker) fue
// retirado tras validar la paridad en la app real con datos de producción
// (A/B con validación en sombra: 0 mismatches, 0 fallbacks). Desde acá
// todas las operaciones se resuelven con `invoke()` a la crate
// `geourban-geo`. Sin runtime Tauri no hay motor: la versión web quedó
// congelada en el branch `web-version`.

import { invoke } from '@tauri-apps/api/core';
import type { FeatureCollection, Polygon as GeoJsonPolygon } from 'geojson';
import type { SubdivisionOptions, SubdivisionResult, ManzanoLoteMethod } from '../geo/subdivision/types';
import type { LotResult } from '../geo/math/polygonEngine';
import type { Street } from '../store/entities/streetStore';
import type { RoundaboutParams } from '../geo/roundabout/roundaboutEngine';
import type { CornerMode } from '../geo/roads/ringFillet';
import type { RoadNetworkNet } from '../geo/roads/types';
import type { Pt } from '../geo/math/polygonEngine';
import { recordWorkerRoundtrip } from '../store/debug/perfTelemetry';
import { recordNativeEngineOutcome } from '../store/debug/nativeEngineTelemetry';

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
  const t0 = performance.now();
  try {
    const result = await invoke<SubdivisionResult>('subdivide', {
      coordinates: polygon.coordinates as unknown as Array<Array<[number, number]>>,
      options: toNativeSubdivisionOptions(options),
    });
    recordWorkerRoundtrip('subdivide:native', performance.now() - t0);
    return result;
  } catch (err) {
    recordWorkerRoundtrip('subdivide:native', performance.now() - t0);
    throw err;
  }
}

async function subdivideManzanoNative(
  ring: [number, number][],
  method: ManzanoLoteMethod,
  targetAreaM2: number,
  frontMinM: number,
  dirPref?: { ax: number; ay: number },
): Promise<LotResult[]> {
  const t0 = performance.now();
  try {
    const lots = await invoke<LotResult[]>('subdivide_manzano', {
      ring,
      method,
      targetAreaM2,
      frontMinM,
      dirPref: toNativeDirPref(dirPref),
    });
    recordWorkerRoundtrip('subdivideManzano:native', performance.now() - t0);
    return lots;
  } catch (err) {
    recordWorkerRoundtrip('subdivideManzano:native', performance.now() - t0);
    throw err;
  }
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
  const t0 = performance.now();
  try {
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
    recordWorkerRoundtrip('subdivideManzanoBatch:native', performance.now() - t0);
    return results;
  } catch (err) {
    recordWorkerRoundtrip('subdivideManzanoBatch:native', performance.now() - t0);
    throw err;
  }
}

async function computeManzanosNative(
  parcels: FeatureCollection,
  roadNetwork: FeatureCollection,
): Promise<FeatureCollection> {
  const t0 = performance.now();
  try {
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
    recordWorkerRoundtrip('computeManzanos:native', performance.now() - t0);
    return result;
  } catch (err) {
    recordWorkerRoundtrip('computeManzanos:native', performance.now() - t0);
    throw err;
  }
}

async function computeRoadNetworkNetNative(
  streets: Street[],
  roundabouts: RoundaboutParams[],
  cornerMode: CornerMode,
): Promise<RoadNetworkNet> {
  const t0 = performance.now();
  try {
    const net = await invoke<RoadNetworkNet>('compute_road_network_net_cmd', {
      streets,
      roundabouts,
      cornerMode,
    });
    recordWorkerRoundtrip('computeRoadNetworkNet:native', performance.now() - t0);
    return net;
  } catch (err) {
    recordWorkerRoundtrip('computeRoadNetworkNet:native', performance.now() - t0);
    throw err;
  }
}

async function matchFragmentsBatchNative(
  items: MatchFragmentsBatchItem[],
): Promise<MatchFragmentsBatchResultItem[]> {
  const t0 = performance.now();
  try {
    const results = await invoke<MatchFragmentsBatchResultItem[]>('match_fragments_batch', {
      items: items.map((it) => ({
        groupIdx: it.groupIdx,
        fragments: it.fragments,
        memberRings: it.memberRings,
      })),
    });
    recordWorkerRoundtrip('matchFragmentsBatch:native', performance.now() - t0);
    return results;
  } catch (err) {
    recordWorkerRoundtrip('matchFragmentsBatch:native', performance.now() - t0);
    throw err;
  }
}

// ─── API pública ───────────────────────────────────────────────────────

export async function computeManzanosInWorker(
  parcels: FeatureCollection,
  roadNetwork: FeatureCollection,
) {
  requireNativeRuntime();
  try {
    const nativeResult = await computeManzanosNative(parcels, roadNetwork);
    recordNativeEngineOutcome('computeManzanos', 'native');
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
    recordNativeEngineOutcome('subdivide', 'native');
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
    recordNativeEngineOutcome('subdivideManzano', 'native');
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
    recordNativeEngineOutcome('subdivideManzanoBatch', 'native');
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
    recordNativeEngineOutcome('computeRoadNetworkNet', 'native');
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
    recordNativeEngineOutcome('matchFragmentsBatch', 'native');
    return results;
  } catch (err) {
    console.error('geoWorkerClient: "matchFragmentsBatch" falló en el motor nativo (sin fallback desde 2.7):', err);
    throw err;
  }
}
