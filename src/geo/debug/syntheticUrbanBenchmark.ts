// src/geo/debug/syntheticUrbanBenchmark.ts
//
// Fase 6.1 — loader + harness de benchmark que alimenta
// `generateSyntheticUrbanLayout()` al pipeline REAL de producción:
//
//   1. Reset limpio de stores (mismo criterio que undoRedoBenchmark.ts).
//   2. Perímetro sintético → restoreDrawFeatures() (kind 'perimetro').
//   3. Calles/rotondas → streetStore/roundaboutStore vía addXWithId().
//   4. recomputeManzanos() real: GEOS union de la red vial + difference
//      contra el perímetro (Fase 2.3) → manzanos de geometría irregular.
//   5. Pasada INCREMENTAL (agrega una avenida más) para estresar la
//      reconciliación de fragmentos contra los manzanos ya existentes
//      (Fase 2.4) — no solo la construcción desde cero.
//   6. subdivideManzanoBatchInWorker() sobre TODOS los manzanos
//      resultantes, con chequeo de degeneración (Fase 2.2 a escala real,
//      con geometría irregular real, no fixtures de mano).
//
// Requiere runtime Tauri (invoca el motor nativo real, igual que
// undoRedoBenchmark.ts y spatialIndexBenchmark.ts).

import Polygon from 'ol/geom/Polygon.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type VectorSource from 'ol/source/Vector.js';
import type { FeatureCollection } from 'geojson';

import { useMapStore } from '../../store/map/mapStore';
import { useStreetStore } from '../../store/entities/streetStore';
import { useRoundaboutStore } from '../../store/entities/roundaboutStore';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import { useManzanoStore } from '../../store/entities/manzanoStore';
import { useCommandStack } from '../../commands/core/CommandStack';
import { recomputeManzanos, resetIncrementalRoadTracking } from '../recomputeManzanos';
import { getFeatureKind, ensureKind } from '../../core/objectModel';
import { polyArea, type Pt } from '../math/polygonEngine';
import { subdivideManzanoBatchInWorker } from '../../workers/geoWorkerClient';
import type { ManzanoLoteMethod } from '../subdivision/types';
import {
  generateSyntheticUrbanLayout,
  SYNTHETIC_URBAN_LAYOUT_DEFAULTS,
  type SyntheticUrbanLayoutOptions,
  type SyntheticUrbanLayoutResult,
  type SyntheticStreetEntry,
} from './syntheticUrbanLayout';

// ─── GeoJSON del/de los perímetro(s) sintéticos ────────────────────────

function perimetersToFeatureCollection(perimeters: Pt[][]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: perimeters.map((ring, i) => ({
      type: 'Feature',
      id: `synthetic-urban-perimeter-${i}`,
      properties: ensureKind({ label: `Sitio sintético ${i + 1}` }, 'perimetro'),
      geometry: { type: 'Polygon', coordinates: [ring.map(([x, y]) => [x, y])] },
    })) as never[],
  };
}

// ─── Stats de manzanos resultantes ─────────────────────────────────────

interface ManzanoStats {
  count: number;
  area: { min: number; max: number; avg: number; totalM2: number };
  vertices: { minVertices: number; maxVertices: number; avgVertices: number };
}

function collectManzanoStats(drawSource: VectorSource): ManzanoStats {
  let count = 0;
  let minArea = Infinity, maxArea = 0, totalArea = 0;
  let minV = Infinity, maxV = 0, totalV = 0;

  drawSource.forEachFeature((f) => {
    const feat = f as Feature<Geometry>;
    if (getFeatureKind(feat) !== 'manzana') return;
    const geom = feat.getGeometry();
    if (!(geom instanceof Polygon)) return;
    const ring = (geom.getCoordinates()[0] ?? []) as number[][];
    if (ring.length < 4) return;

    const areaM2 = (feat.get('areaM2') as number | undefined) ?? polyArea(ring.map((c) => [c[0], c[1]] as Pt));
    count++;
    minArea = Math.min(minArea, areaM2);
    maxArea = Math.max(maxArea, areaM2);
    totalArea += areaM2;

    const v = ring.length - 1;
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
    totalV += v;
  });

  return {
    count,
    area: { min: count > 0 ? minArea : 0, max: maxArea, avg: count > 0 ? totalArea / count : 0, totalM2: totalArea },
    vertices: {
      minVertices: count > 0 ? minV : 0,
      maxVertices: maxV,
      avgVertices: count > 0 ? totalV / count : 0,
    },
  };
}

// ─── Estrés de subdivisión (Fase 2.2) ──────────────────────────────────

export interface SubdivisionStressStats {
  manzanoCount: number;
  totalLots: number;
  remnantLots: number;
  /** Lotes con área <= 0, no-finita, o vértices no-finitos — nunca
   * debería ser > 0; si lo es, es una regresión del motor de subdivisión. */
  degenerateLots: number;
  elapsedMs: number;
}

async function runSubdivisionStress(
  drawSource: VectorSource,
  targetAreaM2: number,
  frontMinM: number,
): Promise<SubdivisionStressStats> {
  const manzanos: Array<{ id: string | number; ring: Array<[number, number]> }> = [];
  drawSource.forEachFeature((f) => {
    const feat = f as Feature<Geometry>;
    if (getFeatureKind(feat) !== 'manzana') return;
    const id = feat.getId();
    if (id == null) return;
    const geom = feat.getGeometry();
    if (!(geom instanceof Polygon)) return;
    const ring = geom.getCoordinates()[0];
    if (!ring || ring.length < 4) return;
    manzanos.push({ id, ring: ring.map((c) => [c[0], c[1]] as [number, number]) });
  });

  const batchInput = manzanos.map(({ id, ring }) => ({
    id,
    ring,
    method: 'auto' as ManzanoLoteMethod,
    targetAreaM2,
    frontMinM,
  }));

  const t0 = performance.now();
  let totalLots = 0, remnantLots = 0, degenerateLots = 0;
  const CHUNK = 16;

  for (let start = 0; start < batchInput.length; start += CHUNK) {
    const chunk = batchInput.slice(start, start + CHUNK);
    const results = await subdivideManzanoBatchInWorker(chunk);
    for (const r of results) {
      for (const lot of r.lots) {
        totalLots++;
        if (lot.isRemnant) remnantLots++;
        const finite =
          Number.isFinite(lot.areaM2) && lot.areaM2 > 0 &&
          lot.pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (!finite) degenerateLots++;
      }
    }
  }

  return { manzanoCount: manzanos.length, totalLots, remnantLots, degenerateLots, elapsedMs: performance.now() - t0 };
}

// ─── Harness principal ──────────────────────────────────────────────────

export interface SyntheticUrbanBenchmarkOptions extends SyntheticUrbanLayoutOptions {
  /** Corre una segunda pasada agregando una avenida nueva, para medir el
   * costo INCREMENTAL (reconciliación de fragmentos, Fase 2.4) — no solo
   * la construcción desde cero. Default: true. */
  runIncrementalPass?: boolean;
  /** Corre subdivideManzanoBatch sobre todos los manzanos resultantes —
   * estrés real del motor de subdivisión (Fase 2.2). Default: true. */
  runSubdivisionStress?: boolean;
  targetAreaM2?: number;
  frontMinM?: number;
}

export interface SyntheticUrbanBenchmarkResult {
  layout: SyntheticUrbanLayoutResult;
  loadMs: number;
  initialRecomputeMs: number;
  manzanoCount: number;
  manzanoAreaStats: ManzanoStats['area'];
  fragmentCountsByVertex: ManzanoStats['vertices'];
  incrementalPass?: {
    addedStreetWidthM: number;
    recomputeMs: number;
    manzanoCountAfter: number;
    diffAddedCount: number;
    diffRemovedCount: number;
    diffModifiedCount: number;
  };
  subdivisionStress?: SubdivisionStressStats;
}

export async function runSyntheticUrbanBenchmark(
  opts: SyntheticUrbanBenchmarkOptions = {},
): Promise<SyntheticUrbanBenchmarkResult> {
  const drawSource = useMapStore.getState().drawSource;
  if (!drawSource) {
    throw new Error('drawSource no inicializado — asegurate de que <MapView/> esté montado.');
  }

  const t0 = performance.now();

  // Reset limpio — mismo criterio que runStreetUndoBenchmark.
  useStreetStore.getState().clearStreets();
  useRoundaboutStore.getState().clearRoundabouts();
  resetIncrementalRoadTracking();
  useManzanoStore.getState().resetAll();
  useLayersStore.getState().resetToEmpty();
  useCommandStack.getState().clear();

  const layout = generateSyntheticUrbanLayout(opts);

  useMapStore.getState().restoreDrawFeatures(perimetersToFeatureCollection(layout.perimeters));

  for (let i = 0; i < layout.streets.length; i++) {
    useStreetStore.getState().addStreetWithId(`synthetic-urban-street-${i}`, layout.streets[i]);
  }
  for (let i = 0; i < layout.roundabouts.length; i++) {
    useRoundaboutStore.getState().addRoundaboutWithId(`synthetic-urban-roundabout-${i}`, layout.roundabouts[i]);
  }

  const loadMs = performance.now() - t0;

  const r0 = performance.now();
  await recomputeManzanos();
  const initialRecomputeMs = performance.now() - r0;

  const initialStats = collectManzanoStats(drawSource);

  const result: SyntheticUrbanBenchmarkResult = {
    layout,
    loadMs,
    initialRecomputeMs,
    manzanoCount: initialStats.count,
    manzanoAreaStats: initialStats.area,
    fragmentCountsByVertex: initialStats.vertices,
  };

  // ── Pasada incremental — estresa la reconciliación de fragmentos
  //    (Fase 2.4): una avenida nueva atraviesa muchos manzanos ya
  //    existentes, que deben re-matchearse contra sus fragmentos previos
  //    por solapamiento de área en vez de recrearse desde cero. ──
  if (opts.runIncrementalPass ?? true) {
    const addedStreetWidthM = Math.max(opts.avenueWidthM ?? SYNTHETIC_URBAN_LAYOUT_DEFAULTS.avenueWidthM, 16);
    const midY = (layout.extent[1] + layout.extent[3]) / 2;
    const skew = (layout.extent[3] - layout.extent[1]) * 0.07;
    const extraStreet: SyntheticStreetEntry = {
      start: [layout.extent[0], midY],
      end: [layout.extent[2], midY + skew],
      widthM: addedStreetWidthM,
      sideWidthM: opts.sideWidthM ?? SYNTHETIC_URBAN_LAYOUT_DEFAULTS.sideWidthM,
      name: 'Avenida incremental sintética',
    };
    useStreetStore.getState().addStreetWithId(`synthetic-urban-street-${layout.streets.length}`, extraStreet);

    const ri0 = performance.now();
    const diff = await recomputeManzanos();
    const recomputeMs = performance.now() - ri0;

    const afterStats = collectManzanoStats(drawSource);

    result.incrementalPass = {
      addedStreetWidthM,
      recomputeMs,
      manzanoCountAfter: afterStats.count,
      diffAddedCount: diff.added.length,
      diffRemovedCount: diff.removed.length,
      diffModifiedCount: diff.modified.length,
    };
  }

  // ── Estrés de subdivisión sobre el estado FINAL (post-incremental si
  //    corrió) — geometría irregular real, no fixtures de mano. ──
  if (opts.runSubdivisionStress ?? true) {
    result.subdivisionStress = await runSubdivisionStress(
      drawSource,
      opts.targetAreaM2 ?? 250,
      opts.frontMinM ?? 12,
    );
  }

  return result;
}

export async function runSyntheticUrbanBenchmarkSuite(
  scales: SyntheticUrbanBenchmarkOptions[] = [
    { targetBlockCount: 25 },
    { targetBlockCount: 100 },
    { targetBlockCount: 400 },
  ],
): Promise<SyntheticUrbanBenchmarkResult[]> {
  const results: SyntheticUrbanBenchmarkResult[] = [];
  for (const scale of scales) results.push(await runSyntheticUrbanBenchmark(scale));
  return results;
}