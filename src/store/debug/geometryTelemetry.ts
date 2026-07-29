const ROLLING_WINDOW_MS = 60_000;
const MAX_RECENT_EVENTS = 50;
const MAX_TRACKED_CONTEXTS = 100;

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
    /* telemetría nunca debe romper al caller */
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
    bumpContext(context);
    recentEvents.push({ context, detail, at: Date.now() });
    if (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift();
    console.warn('[geometry-sanitize]', JSON.stringify({ context, ...detail }));
    forwardToMainIfWorker(context, detail);
  } catch {
    /* la telemetría nunca debe hacer caer al caller */
  }
}

export interface GeometryTelemetrySnapshot {
  countsByContext: Record<string, number>;
  recentEvents: GeometrySanitizeEvent[];
}

export function readGeometryTelemetry(): GeometryTelemetrySnapshot {
  const now = Date.now();
  const countsByContext: Record<string, number> = {};
  for (const [ctx, c] of countersByContext) {
    countsByContext[ctx] = now - c.windowStart >= ROLLING_WINDOW_MS ? 0 : c.count;
  }
  return { countsByContext, recentEvents: recentEvents.slice(-10) };
}

/** Solo para tests. */
export function _resetGeometryTelemetryForTests(): void {
  countersByContext.clear();
  recentEvents.length = 0;
}