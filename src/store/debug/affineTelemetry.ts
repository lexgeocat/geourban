// src/store/debug/affineTelemetry.ts
const ROLLING_WINDOW_MS = 10 * 60_000; // 10 minutos — misma ventana que nativeEngineTelemetry.ts

interface AffineStats {
  refits: number;
  reuses: number;
  windowStart: number;
  lastMaxErrorM: number;
  lastExtentWidthM: number;
  lastExtentHeightM: number;
  lastEpsg: string;
}

const statsByEpsg = new Map<string, AffineStats>();

function freshStats(epsg: string): AffineStats {
  return {
    refits: 0,
    reuses: 0,
    windowStart: Date.now(),
    lastMaxErrorM: 0,
    lastExtentWidthM: 0,
    lastExtentHeightM: 0,
    lastEpsg: epsg,
  };
}

function getOrCreate(epsg: string): AffineStats {
  let s = statsByEpsg.get(epsg);
  if (!s || Date.now() - s.windowStart >= ROLLING_WINDOW_MS) {
    s = freshStats(epsg);
    statsByEpsg.set(epsg, s);
  }
  return s;
}

/** Llamar cuando `affineCache.ts` reutiliza la matriz vigente (extent contenido, mismo EPSG). */
export function recordAffineReuse(epsg: string): void {
  getOrCreate(epsg).reuses++;
}

/** Llamar cuando `affineCache.ts` recalcula la matriz (Fase 5.2 — debería ser raro comparado con reuses). */
export function recordAffineRefit(epsg: string, maxErrorM: number, extentWidthM: number, extentHeightM: number): void {
  const s = getOrCreate(epsg);
  s.refits++;
  s.lastMaxErrorM = maxErrorM;
  s.lastExtentWidthM = extentWidthM;
  s.lastExtentHeightM = extentHeightM;
}

export interface AffineStatsSnapshot {
  epsg: string;
  refits: number;
  reuses: number;
  reuseRatio: number;
  lastMaxErrorM: number;
  lastExtentWidthM: number;
  lastExtentHeightM: number;
}

export function readAffineStats(): AffineStatsSnapshot[] {
  const now = Date.now();
  const out: AffineStatsSnapshot[] = [];
  for (const [epsg, s] of statsByEpsg) {
    const stale = now - s.windowStart >= ROLLING_WINDOW_MS;
    const refits = stale ? 0 : s.refits;
    const reuses = stale ? 0 : s.reuses;
    out.push({
      epsg,
      refits,
      reuses,
      reuseRatio: refits + reuses > 0 ? reuses / (refits + reuses) : 0,
      lastMaxErrorM: s.lastMaxErrorM,
      lastExtentWidthM: s.lastExtentWidthM,
      lastExtentHeightM: s.lastExtentHeightM,
    });
  }
  return out.sort((a, b) => a.epsg.localeCompare(b.epsg));
}

/** Solo para tests. */
export function _resetAffineTelemetryForTests(): void {
  statsByEpsg.clear();
}