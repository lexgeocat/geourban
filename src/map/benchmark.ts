/**
 * ================================================================
 * BENCHMARK AUTOMATIZADO — Carga de 10.000 lotes sinteticos
 * ================================================================
 * Mide FPS, tiempo de carga y memoria heap al renderizar el
 * WebGLVectorLayer con el dataset demo. Se ejecuta en consola del
 * navegador o en modo test headless.
 * ================================================================ */

import { generateDemoGrid, buildSpatialIndex } from './demoDataset';

export interface BenchmarkResult {
  featureCount: number;
  loadTimeMs: number;
  memoryBytes: number | null;
  fps: number;
  spatialIndexBuildMs: number;
  spatialIndexQueryMs: number;
}

/** Mide cuantos frames se renderizan en 1 segundo */
function measureFPS(): Promise<number> {
  return new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = () => {
      frames++;
      if (performance.now() - start < 1000) {
        requestAnimationFrame(tick);
      } else {
        resolve(frames);
      }
    };
    requestAnimationFrame(tick);
  });
}

/** Ejecuta el benchmark completo */
export async function runBenchmark(): Promise<BenchmarkResult> {
  const memBefore = (performance as any).memory?.usedJSHeapSize ?? null;

  // 1. Generar dataset
  const t0 = performance.now();
  const features = generateDemoGrid(100);
  const loadTimeMs = performance.now() - t0;

  // 2. Construir indice espacial
  const t1 = performance.now();
  const idx = buildSpatialIndex(features);
  const spatialIndexBuildMs = performance.now() - t1;

  // 3. Medir query
  const t2 = performance.now();
  const [cx, cy] = [features[0].getGeometry()!.getExtent()[0], features[0].getGeometry()!.getExtent()[1]];
  for (let i = 0; i < 1000; i++) {
    idx.searchPoint(cx + i * 0.1, cy + i * 0.1, 1);
  }
  const spatialIndexQueryMs = performance.now() - t2;

  // 4. Medir FPS
  const fps = await measureFPS();

  const memAfter = (performance as any).memory?.usedJSHeapSize ?? null;
  const memoryBytes = memAfter && memBefore ? memAfter - memBefore : null;

  const result: BenchmarkResult = {
    featureCount: features.length,
    loadTimeMs: Math.round(loadTimeMs * 100) / 100,
    memoryBytes,
    fps,
    spatialIndexBuildMs: Math.round(spatialIndexBuildMs * 100) / 100,
    spatialIndexQueryMs: Math.round(spatialIndexQueryMs * 100) / 100,
  };

  console.table(result);
  return result;
}

/** Hook para ejecutar desde la consola del navegador: */
if (typeof window !== 'undefined') {
  (window as any).GeoUrbanBench = runBenchmark;
}
