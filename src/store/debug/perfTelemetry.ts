// ─── Roundtrip por tipo de request al geo worker ─────────────────────

interface RequestStat {
  count: number;
  lastMs: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
}

const workerStats = new Map<string, RequestStat>();

export function recordWorkerRoundtrip(type: string, ms: number): void {
  let s = workerStats.get(type);
  if (!s) {
    s = { count: 0, lastMs: 0, totalMs: 0, minMs: Infinity, maxMs: 0 };
    workerStats.set(type, s);
  }
  s.count++;
  s.lastMs = ms;
  s.totalMs += ms;
  s.minMs = Math.min(s.minMs, ms);
  s.maxMs = Math.max(s.maxMs, ms);
}

export interface WorkerStatSnapshot {
  type: string;
  count: number;
  lastMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

export function readWorkerStats(): WorkerStatSnapshot[] {
  return Array.from(workerStats.entries())
    .map(([type, s]) => ({
      type,
      count: s.count,
      lastMs: s.lastMs,
      avgMs: s.count > 0 ? s.totalMs / s.count : 0,
      minMs: s.minMs === Infinity ? 0 : s.minMs,
      maxMs: s.maxMs,
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

// ─── Snapshot de undo (GeoJSON completo — ver AddStreetCommand/AddRoundaboutCommand) ──

interface SnapshotStat {
  lastBytes: number;
  lastMs: number;
  count: number;
  totalBytes: number;
}

const snapshotStat: SnapshotStat = { lastBytes: 0, lastMs: 0, count: 0, totalBytes: 0 };

export function recordUndoSnapshot(bytes: number, ms: number): void {
  snapshotStat.lastBytes = bytes;
  snapshotStat.lastMs = ms;
  snapshotStat.count++;
  snapshotStat.totalBytes += bytes;
}

export function readUndoSnapshotStats(): SnapshotStat {
  return { ...snapshotStat };
}

// ─── Carga de proyecto (restoreDrawFeatures) ──────────────────────────

interface LoadStat {
  lastMs: number;
  lastFeatureCount: number;
  lastBytes: number;
}

const loadStat: LoadStat = { lastMs: 0, lastFeatureCount: 0, lastBytes: 0 };

export function recordProjectLoad(ms: number, featureCount: number, bytes: number): void {
  loadStat.lastMs = ms;
  loadStat.lastFeatureCount = featureCount;
  loadStat.lastBytes = bytes;
}

export function readProjectLoadStats(): LoadStat {
  return { ...loadStat };
}

export function estimateGeoJsonBytes(geojson: unknown, featureCount: number): number {
  if (typeof geojson === 'string') return geojson.length * 2;
  if (featureCount > 5000) return featureCount * 220;
  return JSON.stringify(geojson).length * 2;
}

// ─── Memoria de heap JS (Chrome/Chromium-based only — API no estándar) ─

export interface HeapSnapshot {
  usedMB: number;
  totalMB: number;
  limitMB: number;
  available: boolean;
}

export function readHeapSnapshot(): HeapSnapshot {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (!mem) return { usedMB: 0, totalMB: 0, limitMB: 0, available: false };
  const MB = 1024 * 1024;
  return {
    usedMB: mem.usedJSHeapSize / MB,
    totalMB: mem.totalJSHeapSize / MB,
    limitMB: mem.jsHeapSizeLimit / MB,
    available: true,
  };
}

export function _resetPerfTelemetryForTests(): void {
  workerStats.clear();
  snapshotStat.lastBytes = 0;
  snapshotStat.lastMs = 0;
  snapshotStat.count = 0;
  snapshotStat.totalBytes = 0;
  loadStat.lastMs = 0;
  loadStat.lastFeatureCount = 0;
  loadStat.lastBytes = 0;
}