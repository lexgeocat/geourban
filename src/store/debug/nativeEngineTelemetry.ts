const ROLLING_WINDOW_MS = 10 * 60_000; // 10 minutos — una sesión de uso real

export type NativeEngineOutcome = 'native' | 'fallback' | 'shadowMatch' | 'shadowMismatch';

interface OpStats {
  native: number;
  fallback: number;
  shadowMatch: number;
  shadowMismatch: number;
  lastMismatchDetail: string | null;
  lastMismatchAt: number | null;
  windowStart: number;
}

const statsByOp = new Map<string, OpStats>();

function freshStats(): OpStats {
  return {
    native: 0,
    fallback: 0,
    shadowMatch: 0,
    shadowMismatch: 0,
    lastMismatchDetail: null,
    lastMismatchAt: null,
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
    const detail = s.lastMismatchDetail;
    const detailAt = s.lastMismatchAt;
    s = freshStats();
    // Conservamos el último mismatch aunque rote la ventana — es la
    // señal más valiosa para depurar y no queremos perderla solo porque
    // pasaron 10 minutos.
    s.lastMismatchDetail = detail;
    s.lastMismatchAt = detailAt;
    statsByOp.set(opType, s);
  }
  return s;
}

export function recordNativeEngineOutcome(opType: string, outcome: NativeEngineOutcome, detail?: string): void {
  const s = getOrCreate(opType);
  s[outcome]++;
  if (outcome === 'shadowMismatch') {
    s.lastMismatchDetail = detail ?? null;
    s.lastMismatchAt = Date.now();
    console.warn(`[nativeEngine] shadow mismatch en "${opType}"${detail ? `: ${detail}` : ''}`);
  }
}

export interface NativeEngineStatsSnapshot {
  opType: string;
  native: number;
  fallback: number;
  shadowMatch: number;
  shadowMismatch: number;
  lastMismatchDetail: string | null;
  lastMismatchAt: number | null;
}

export function readNativeEngineStats(): NativeEngineStatsSnapshot[] {
  return Array.from(statsByOp.entries())
    .map(([opType, s]) => ({
      opType,
      native: s.native,
      fallback: s.fallback,
      shadowMatch: s.shadowMatch,
      shadowMismatch: s.shadowMismatch,
      lastMismatchDetail: s.lastMismatchDetail,
      lastMismatchAt: s.lastMismatchAt,
    }))
    .sort((a, b) => a.opType.localeCompare(b.opType));
}

/** Solo para tests/depuración. */
export function _resetNativeEngineTelemetryForTests(): void {
  statsByOp.clear();
}