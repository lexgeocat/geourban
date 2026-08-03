const ROLLING_WINDOW_MS = 10 * 60_000; // 10 minutos — una sesión de uso real

export type NativeEngineOutcome = 'native' | 'fallback';

interface OpStats {
  native: number;
  fallback: number;
  windowStart: number;
}

const statsByOp = new Map<string, OpStats>();

function freshStats(): OpStats {
  return {
    native: 0,
    fallback: 0,
    windowStart: Date.now(),
  };
}

function getOrCreate(opType: string): OpStats {
  let s = statsByOp.get(opType);
  if (!s) {
    s = freshStats();
    statsByOp.set(opType, s);
  }
  if (Date.now() - s.windowStart >= ROLLING_WINDOW_MS) {
    s = freshStats();
    statsByOp.set(opType, s);
  }
  return s;
}

export function recordNativeEngineOutcome(opType: string, outcome: NativeEngineOutcome): void {
  const s = getOrCreate(opType);
  s[outcome]++;
}

export interface NativeEngineStatsSnapshot {
  opType: string;
  native: number;
  fallback: number;
}

export function readNativeEngineStats(): NativeEngineStatsSnapshot[] {
  return Array.from(statsByOp.entries())
    .map(([opType, s]) => ({
      opType,
      native: s.native,
      fallback: s.fallback,
    }))
    .sort((a, b) => a.opType.localeCompare(b.opType));
}

/** Solo para tests/depuración. */
export function _resetNativeEngineTelemetryForTests(): void {
  statsByOp.clear();
}
