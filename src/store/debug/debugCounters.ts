const ROLLING_WINDOW_MS = 60_000;

let telemetryEnabled = false;

export function setDebugTelemetryEnabled(v: boolean): void {
  telemetryEnabled = v;
}

function isEnabled(): boolean {
  return telemetryEnabled;
}

interface RollingCounter {
  count: number;
  windowStart: number;
}

function makeRollingCounter(): RollingCounter {
  return { count: 0, windowStart: Date.now() };
}

const setStyleCalls = makeRollingCounter();
const syncLayerSetCalls = makeRollingCounter();
const syncGizmoCalls = makeRollingCounter();

function bump(counter: RollingCounter): void {
  const now = Date.now();
  if (now - counter.windowStart >= ROLLING_WINDOW_MS) {
    counter.count = 0;
    counter.windowStart = now;
  }
  counter.count++;
}

function peek(counter: RollingCounter): number {
  const now = Date.now();
  if (now - counter.windowStart >= ROLLING_WINDOW_MS) {
    counter.count = 0;
    counter.windowStart = now;
  }
  return counter.count;
}

export function recordSetStyleCall(): void {
  if (!isEnabled()) return;
  bump(setStyleCalls);
}
export function recordSyncLayerSetCall(): void {
  if (!isEnabled()) return;
  bump(syncLayerSetCalls);
}
export function recordSyncGizmoCall(): void {
  if (!isEnabled()) return;
  bump(syncGizmoCalls);
}

let webglLayerCount = 0;
export function recordWebglLayerCount(n: number): void {
  if (!isEnabled()) return;
  webglLayerCount = n;
}

const PR_SAMPLE_MAX = 120;
const postrenderSamples: number[] = [];
let postrenderLastMs = 0;

const splitSamples = new globalThis.Map<string, number[]>();

export function recordPostrenderSplit(label: string, ms: number): void {
  if (!isEnabled()) return;
  let arr = splitSamples.get(label);
  if (!arr) {
    arr = [];
    splitSamples.set(label, arr);
  }
  arr.push(ms);
  if (arr.length > PR_SAMPLE_MAX) arr.shift();
}

export function readPostrenderSplit(): Record<string, number> {
  if (!isEnabled()) return {};
  const out: Record<string, number> = {};
  for (const [label, arr] of splitSamples) {
    out[label] = arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  return out;
}

const labelCacheHits = makeRollingCounter();
const labelCacheMisses = makeRollingCounter();

export function recordLabelCacheHit(): void {
  if (!isEnabled()) return;
  bump(labelCacheHits);
}
export function recordLabelCacheMiss(): void {
  if (!isEnabled()) return;
  bump(labelCacheMisses);
}

export function recordPostrenderDuration(ms: number): void {
  if (!isEnabled()) return;
  postrenderLastMs = ms;
  postrenderSamples.push(ms);
  if (postrenderSamples.length > PR_SAMPLE_MAX) postrenderSamples.shift();
}

export interface DebugCountersSnapshot {
  setStyleCallsPerMin: number;
  syncLayerSetCallsPerMin: number;
  syncGizmoCallsPerMin: number;
  webglLayerCount: number;
  postrenderLastMs: number;
  postrenderAvgMs: number;
  labelCacheHitsPerMin: number;
  labelCacheMissesPerMin: number;
}

export function readDebugCounters(): DebugCountersSnapshot {
  if (!isEnabled()) {
    return {
      setStyleCallsPerMin: 0,
      syncLayerSetCallsPerMin: 0,
      syncGizmoCallsPerMin: 0,
      webglLayerCount: 0,
      postrenderLastMs: 0,
      postrenderAvgMs: 0,
      labelCacheHitsPerMin: 0,
      labelCacheMissesPerMin: 0,
    };
  }
  const avg = postrenderSamples.length > 0
    ? postrenderSamples.reduce((a, b) => a + b, 0) / postrenderSamples.length
    : 0;
  return {
    setStyleCallsPerMin: peek(setStyleCalls),
    syncLayerSetCallsPerMin: peek(syncLayerSetCalls),
    syncGizmoCallsPerMin: peek(syncGizmoCalls),
    webglLayerCount,
    postrenderLastMs,
    postrenderAvgMs: avg,
    labelCacheHitsPerMin: peek(labelCacheHits),
    labelCacheMissesPerMin: peek(labelCacheMisses),
  };
}