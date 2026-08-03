// src/store/debug/affineTelemetry.ts
const ROLLING_WINDOW_MS = 10 * 60_000; // 10 minutos

interface AffineStats {
  refits: number;
  reuses: number;
  degraded: number;
  windowStart: number;
  lastMaxErrorM: number;
  /** Peor error de fit observado en la ventana — más informativo que
   * "último" cuando hay muchos tiles distintos (Fase 5 robustecida). */
  worstMaxErrorM: number;
  lastExtentWidthM: number;
  lastExtentHeightM: number;
  lastEpsg: string;
}

const statsByEpsg = new Map<string, AffineStats>();

function freshStats(epsg: string): AffineStats {
  return {
    refits: 0,
    reuses: 0,
    degraded: 0,
    windowStart: Date.now(),
    lastMaxErrorM: 0,
    worstMaxErrorM: 0,
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

/** Llamar cuando se reutiliza un ajuste vigente (tile o plano local). */
export function recordAffineReuse(epsg: string): void {
  getOrCreate(epsg).reuses++;
}

/** Llamar cuando se calcula un ajuste nuevo (fit de un tile o del plano local). */
export function recordAffineRefit(epsg: string, maxErrorM: number, extentWidthM: number, extentHeightM: number): void {
  const s = getOrCreate(epsg);
  s.refits++;
  s.lastMaxErrorM = maxErrorM;
  s.worstMaxErrorM = Math.max(s.worstMaxErrorM, maxErrorM);
  s.lastExtentWidthM = extentWidthM;
  s.lastExtentHeightM = extentHeightM;
}

/**
 * Cuenta ajustes que, incluso tras la corrección cuadrática (y en UTM,
 * tras el refinamiento adaptativo hasta el nivel máximo), siguen por
 * encima de MAX_ACCEPTABLE_ERROR_M. Debería ser ~0 en uso normal — si
 * aparece sostenido en producción, revisar la zona UTM configurada (la
 * linealización asume escala urbana) o si el proyecto excede varias
 * zonas UTM.
 */
export function recordAffineDegraded(epsg: string): void {
  getOrCreate(epsg).degraded++;
}

export interface AffineStatsSnapshot {
  epsg: string;
  refits: number;
  reuses: number;
  degraded: number;
  reuseRatio: number;
  lastMaxErrorM: number;
  worstMaxErrorM: number;
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
    const degraded = stale ? 0 : s.degraded;
    const worstMaxErrorM = stale ? 0 : s.worstMaxErrorM;
    out.push({
      epsg,
      refits,
      reuses,
      degraded,
      reuseRatio: refits + reuses > 0 ? reuses / (refits + reuses) : 0,
      lastMaxErrorM: s.lastMaxErrorM,
      worstMaxErrorM,
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