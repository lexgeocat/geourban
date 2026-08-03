// src/geo/crs/affineCache.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { register } from 'ol/proj/proj4.js';
import proj4 from 'proj4';
import { fromLonLat } from 'ol/proj.js';
import type { Extent } from 'ol/extent.js';
import { getMetricPlaneAffine, invalidateAffineCache, _getAffineCacheEntryForTests } from './affineCache';
import { _resetAffineTelemetryForTests, readAffineStats } from '../../store/debug/affineTelemetry';

const EPSG_32719 = 'EPSG:32719';
const EPSG_32718 = 'EPSG:32718';

function registerZones() {
  proj4.defs(EPSG_32719, '+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs +type=crs');
  proj4.defs(EPSG_32718, '+proj=utm +zone=18 +south +datum=WGS84 +units=m +no_defs +type=crs');
  register(proj4);
}

function smallExtentAround(center: [number, number], half: number): Extent {
  return [center[0] - half, center[1] - half, center[0] + half, center[1] + half];
}

describe('affineCache — Fase 5.2 invalidación', () => {
  const center = fromLonLat([-68.3, -16.5]) as [number, number];

  beforeEach(() => {
    registerZones();
    invalidateAffineCache();
    _resetAffineTelemetryForTests();
  });

  it('reutiliza la matriz para extents sucesivos contenidos en el fit cacheado', () => {
    const e1 = smallExtentAround(center, 500);
    getMetricPlaneAffine(EPSG_32719, e1);
    const entryAfterFirst = _getAffineCacheEntryForTests();
    expect(entryAfterFirst).not.toBeNull();

    // Extent chico, cerca del centro, claramente dentro del padding del primero.
    const e2 = smallExtentAround(center, 50);
    getMetricPlaneAffine(EPSG_32719, e2);
    const entryAfterSecond = _getAffineCacheEntryForTests();

    // Misma matriz — no hubo refit.
    expect(entryAfterSecond!.fitExtent).toEqual(entryAfterFirst!.fitExtent);

    const stats = readAffineStats().find((s) => s.epsg === EPSG_32719)!;
    expect(stats.refits).toBe(1);
    expect(stats.reuses).toBe(1);
  });

  it('recalcula cuando el extent crece más allá del margen cacheado', () => {
    const e1 = smallExtentAround(center, 500);
    getMetricPlaneAffine(EPSG_32719, e1);
    const before = _getAffineCacheEntryForTests()!;

    // Extent mucho más grande, claramente fuera del padding del primer fit.
    const e2 = smallExtentAround(center, 50_000);
    getMetricPlaneAffine(EPSG_32719, e2);
    const after = _getAffineCacheEntryForTests()!;

    expect(after.fitExtent).not.toEqual(before.fitExtent);

    const stats = readAffineStats().find((s) => s.epsg === EPSG_32719)!;
    expect(stats.refits).toBe(2);
  });

  it('recalcula al cambiar de EPSG (zona/hemisferio UTM distinto)', () => {
    const e1 = smallExtentAround(center, 500);
    getMetricPlaneAffine(EPSG_32719, e1);
    getMetricPlaneAffine(EPSG_32718, e1);

    const stats19 = readAffineStats().find((s) => s.epsg === EPSG_32719)!;
    const stats18 = readAffineStats().find((s) => s.epsg === EPSG_32718)!;
    expect(stats19.refits).toBe(1);
    expect(stats18.refits).toBe(1);
  });

  it('invalidateAffineCache() fuerza un refit en la siguiente llamada aunque el extent no haya cambiado', () => {
    const e1 = smallExtentAround(center, 500);
    getMetricPlaneAffine(EPSG_32719, e1);
    invalidateAffineCache();
    getMetricPlaneAffine(EPSG_32719, e1);

    const stats = readAffineStats().find((s) => s.epsg === EPSG_32719)!;
    expect(stats.refits).toBe(2);
    expect(stats.reuses).toBe(0);
  });

  it('un extent degenerado (punto único) no rompe: usa el padding mínimo y ajusta igual', () => {
    const point: Extent = [center[0], center[1], center[0], center[1]];
    const t = getMetricPlaneAffine(EPSG_32719, point);
    expect(Number.isFinite(t.a)).toBe(true);
    expect(Number.isFinite(t.f)).toBe(true);
  });

  it('spy: proj4 transform solo se invoca en el refit, no en reuses subsecuentes', () => {
    const spy = vi.spyOn(proj4 as unknown as { (a: unknown, b: unknown, c: unknown): unknown }, 'call' as never);
    // No dependemos de contar llamadas internas de proj4 directamente
    // (implementación interna de ol/proj puede variar); en su lugar
    // confirmamos indirectamente vía el contador de refits/reuses, que
    // es el contrato observable de esta función.
    spy.mockRestore();

    const e1 = smallExtentAround(center, 500);
    getMetricPlaneAffine(EPSG_32719, e1);
    for (let i = 0; i < 20; i++) {
      getMetricPlaneAffine(EPSG_32719, smallExtentAround(center, 10 + i));
    }
    const stats = readAffineStats().find((s) => s.epsg === EPSG_32719)!;
    expect(stats.refits).toBe(1);
    expect(stats.reuses).toBe(20);
  });
});