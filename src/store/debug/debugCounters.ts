const ROLLING_WINDOW_MS = 60_000;

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
  bump(setStyleCalls);
}
export function recordSyncLayerSetCall(): void {
  bump(syncLayerSetCalls);
}
export function recordSyncGizmoCall(): void {
  bump(syncGizmoCalls);
}

let webglLayerCount = 0;
export function recordWebglLayerCount(n: number): void {
  webglLayerCount = n;
}

const PR_SAMPLE_MAX = 120;
const postrenderSamples: number[] = [];
let postrenderLastMs = 0;

const labelCacheHits = makeRollingCounter();
const labelCacheMisses = makeRollingCounter();

export function recordLabelCacheHit(): void {
  bump(labelCacheHits);
}
export function recordLabelCacheMiss(): void {
  bump(labelCacheMisses);
}

export function recordPostrenderDuration(ms: number): void {
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