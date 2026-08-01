// ─────────────────────────────────────────────────────────────────────
// Reemplazo de computeManzanosWorkerEntry.ts completo — tipa
// correctamente contra FeatureCollection real de geojson.
// ─────────────────────────────────────────────────────────────────────
import { parentPort, workerData } from 'node:worker_threads';
import type { FeatureCollection, Polygon as GeoJsonPolygon } from 'geojson';
import type { Street } from '../../store/entities/streetStore';
import { polyArea, type Pt } from '../math/polygonEngine';
import { computeManzanosGuarded } from './computeManzanosGuarded';

interface WorkerInput {
  parcelRing: Pt[];
  streets: Street[];
}

function totalAreaOf(fc: FeatureCollection): number {
  let total = 0;
  for (const f of fc.features) {
    if (f.geometry?.type !== 'Polygon') continue;
    total += polyArea((f.geometry as GeoJsonPolygon).coordinates[0] as Pt[]);
  }
  return total;
}

function ringHasNonFinite(ring: Pt[]): boolean {
  return ring.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y));
}

try {
  const { parcelRing, streets } = workerData as WorkerInput;
  const out = computeManzanosGuarded(parcelRing, streets);

  const hasNonFinite = out.result.features.some((f) => {
    if (f.geometry?.type !== 'Polygon') return false;
    return ringHasNonFinite((f.geometry as GeoJsonPolygon).coordinates[0] as Pt[]);
  });

  parentPort?.postMessage({
    ok: true,
    fragmentCount: out.result.features.length,
    totalArea: totalAreaOf(out.result),
    hasNonFinite,
    skipped: out.skipped,
    reason: out.reason ?? null,
  });
} catch (err) {
  parentPort?.postMessage({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  });
}