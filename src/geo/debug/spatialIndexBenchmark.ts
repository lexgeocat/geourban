// src/geo/debug/spatialIndexBenchmark.ts
//
// Fase 4.1/4.2 (auditoria-para-mejora.md §6, Fase 4) — mide la consulta de
// viewport del lado JS (RBush, src/map/spatialIndex.ts) contra el índice
// nativo rstar (Rust vía Tauri, src-tauri/src/geo_bridge.rs). El dato
// decide el umbral (4.2): con cuántas features conviene pagar el `invoke`
// en vez de resolver en el RBush local.
//
// No toca el índice global de la app: usa instancias standalone del
// `SpatialIndex` JS y el estado nativo solo para benchmark. El estado
// nativo es multi-slot (`geo_bridge::SpatialIndexState`): este benchmark
// usa el slot `"benchmark"` y jamás compite con el slot `"viewport"` que
// la Fase 4.1 cableará al render real.
//
// Requiere runtime Tauri (invoca el índice nativo vía invoke).

import GeoJSON from 'ol/format/GeoJSON.js';
import type Feature from 'ol/Feature.js';
import type Polygon from 'ol/geom/Polygon.js';
import { SpatialIndex } from '../../map/spatialIndex';
import { generateSyntheticManzanos } from './syntheticDataset';
import {
  spatialIndexLoadInWorker,
  spatialIndexQueryInWorker,
  spatialIndexClearInWorker,
  type SpatialIndexItem,
} from '../../workers/geoWorkerClient';

const BENCHMARK_SLOT = 'benchmark';

export interface SpatialIndexBenchmarkResult {
  datasetSize: number;
  featureCount: number;
  jsLoadMs: number;
  nativeLoadMs: number;
  jsQueryAvgMs: number;
  nativeQueryAvgMs: number;
  /** Búsqueda pura dentro de Rust (queryMs que reporta el comando, sin IPC ni serialización). */
  nativeSearchAvgMs: number;
  jsHitCount: number;
  nativeHitCount: number;
  parityOk: boolean;
  queryRounds: number;
}

const QUERY_ROUNDS = 5;
const VIEWPORT_FRACTION = 0.2;

const geoJsonFormat = new GeoJSON();

interface QueryRect {
  label: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function makeQueryRects(extent: [number, number, number, number]): QueryRect[] {
  const [minX, minY, maxX, maxY] = extent;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const vwX = spanX * VIEWPORT_FRACTION;
  const vwY = spanY * VIEWPORT_FRACTION;
  const cx = minX + spanX / 2;
  const cy = minY + spanY / 2;
  return [
    { label: 'centro', minX: cx - vwX / 2, minY: cy - vwY / 2, maxX: cx + vwX / 2, maxY: cy + vwY / 2 },
    { label: 'esquina', minX, minY, maxX: minX + vwX, maxY: minY + vwY },
    { label: 'banda-central', minX: cx - vwX / 8, minY, maxX: cx + vwX / 8, maxY },
  ];
}

export async function runSpatialIndexBenchmark(datasetSize: number): Promise<SpatialIndexBenchmarkResult> {
  const { collection, extent, count } = generateSyntheticManzanos(datasetSize);
  // Mismo parseo que restoreDrawFeatures (mapStore.ts): sin reproyección,
  // el dataset ya está en el plano interno del proyecto (EPSG:3857).
  const features = geoJsonFormat.readFeatures(collection, {
    dataProjection: 'EPSG:3857',
    featureProjection: 'EPSG:3857',
  }) as Feature<Polygon>[];

  // Índice JS standalone (no toca el singleton global de la app).
  const jsIndex = new SpatialIndex();
  const t0 = performance.now();
  jsIndex.load(features);
  const jsLoadMs = performance.now() - t0;
  const jsTotal = jsIndex.size;

  // Índice nativo: bulk-load con los bboxes de los mismos features.
  const items: SpatialIndexItem[] = [];
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const geom = f.getGeometry();
    if (!geom) continue;
    const id = f.getId();
    if (id === undefined) continue;
    const e = geom.getExtent();
    items.push({ id, minX: e[0], minY: e[1], maxX: e[2], maxY: e[3] });
  }
  const t1 = performance.now();
  const nativeLoaded = await spatialIndexLoadInWorker(items, BENCHMARK_SLOT);
  const nativeLoadMs = performance.now() - t1;

  const rects = makeQueryRects(extent);
  let jsQueryAvgMs = 0;
  let nativeQueryAvgMs = 0;
  let nativeSearchAvgMs = 0;
  let jsHitCount = 0;
  let nativeHitCount = 0;
  // Ambos índices deben haber cargado la misma cantidad de features.
  let parityOk = jsTotal === nativeLoaded;

  try {
    for (const rect of rects) {
      let jsTotalMs = 0;
      let jsHits: string[] = [];
      for (let r = 0; r < QUERY_ROUNDS; r++) {
        const q0 = performance.now();
        const hits = jsIndex.search(rect.minX, rect.minY, rect.maxX, rect.maxY);
        jsTotalMs += performance.now() - q0;
        jsHits = hits.map((f) => String(f.getId()));
      }
      jsQueryAvgMs += jsTotalMs / QUERY_ROUNDS;
      jsHitCount += jsHits.length;

      let nativeTotalMs = 0;
      let nativeSearchTotalMs = 0;
      let nativeHits: string[] = [];
      for (let r = 0; r < QUERY_ROUNDS; r++) {
        const q0 = performance.now();
        const result = await spatialIndexQueryInWorker(rect.minX, rect.minY, rect.maxX, rect.maxY, BENCHMARK_SLOT);
        nativeTotalMs += performance.now() - q0;
        nativeSearchTotalMs += result.queryMs;
        nativeHits = result.ids.map((id) => String(id));
      }
      nativeQueryAvgMs += nativeTotalMs / QUERY_ROUNDS;
      nativeSearchAvgMs += nativeSearchTotalMs / QUERY_ROUNDS;
      nativeHitCount += nativeHits.length;

      const jsSorted = [...jsHits].sort();
      const nativeSorted = [...nativeHits].sort();
      if (jsSorted.length !== nativeSorted.length || jsSorted.some((v, i) => v !== nativeSorted[i])) {
        parityOk = false;
      }
    }
  } finally {
    await spatialIndexClearInWorker(BENCHMARK_SLOT);
  }

  return {
    datasetSize,
    featureCount: count,
    jsLoadMs,
    nativeLoadMs,
    jsQueryAvgMs: jsQueryAvgMs / rects.length,
    nativeQueryAvgMs: nativeQueryAvgMs / rects.length,
    nativeSearchAvgMs: nativeSearchAvgMs / rects.length,
    jsHitCount,
    nativeHitCount,
    parityOk,
    queryRounds: QUERY_ROUNDS * rects.length,
  };
}

export async function runSpatialIndexBenchmarkSuite(
  sizes: number[] = [10_000, 100_000, 500_000],
): Promise<SpatialIndexBenchmarkResult[]> {
  const results: SpatialIndexBenchmarkResult[] = [];
  for (const size of sizes) results.push(await runSpatialIndexBenchmark(size));
  return results;
}
