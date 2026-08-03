const ROLLING_WINDOW_MS = 60_000;
const MAX_RECENT_EVENTS = 50;
const MAX_TRACKED_CONTEXTS = 100;

let telemetryEnabled = false;

export function setGeometryTelemetryEnabled(v: boolean): void {
  telemetryEnabled = v;
}

function isEnabled(): boolean {
  return telemetryEnabled;
}

export interface GeometrySanitizeEvent {
  context: string;
  detail: Record<string, unknown>;
  at: number;
}

interface ContextCounter {
  count: number;
  windowStart: number;
}

const countersByContext = new Map<string, ContextCounter>();
const recentEvents: GeometrySanitizeEvent[] = [];

const isWorkerScope = typeof window === 'undefined' && typeof self !== 'undefined';

function forwardToMainIfWorker(context: string, detail: Record<string, unknown>): void {
  if (!isWorkerScope) return;
  try {
    (self as unknown as { postMessage: (msg: unknown) => void }).postMessage({
      __geoTelemetry: true,
      context,
      detail,
    });
  } catch {
  }
}

function bumpContext(context: string): void {
  const now = Date.now();
  let c = countersByContext.get(context);
  if (!c) {
    if (countersByContext.size >= MAX_TRACKED_CONTEXTS) {

      countersByContext.clear();
    }
    c = { count: 0, windowStart: now };
    countersByContext.set(context, c);
  }
  if (now - c.windowStart >= ROLLING_WINDOW_MS) {
    c.count = 0;
    c.windowStart = now;
  }
  c.count++;
}

export function recordGeometrySanitizeEvent(context: string, detail: Record<string, unknown> = {}): void {
  try {
    if (isEnabled()) {
      bumpContext(context);
      recentEvents.push({ context, detail, at: Date.now() });
      if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift();
    }
    if (import.meta.env.DEV) {
      console.warn('[geometry-sanitize]', JSON.stringify({ context, ...detail }));
    }
    forwardToMainIfWorker(context, detail);
  } catch {
  }
}

export interface GeometryTelemetrySnapshot {
  countsByContext: Record<string, number>;
  recentEvents: GeometrySanitizeEvent[];
}

export function readGeometryTelemetry(): GeometryTelemetrySnapshot {
  if (!isEnabled()) {
    return { countsByContext: {}, recentEvents: [] };
  }
  const now = Date.now();
  const countsByContext: Record<string, number> = {};
  for (const [ctx, c] of countersByContext) {
    countsByContext[ctx] = now - c.windowStart >= ROLLING_WINDOW_MS ? 0 : c.count;
  }
  return { countsByContext, recentEvents: recentEvents.slice(-10) };
}

export function _resetGeometryTelemetryForTests(): void {
  countersByContext.clear();
  recentEvents.length = 0;
}