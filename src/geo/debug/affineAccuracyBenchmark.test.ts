import { describe, it, expect } from 'vitest';
import { runAffineAccuracySuite } from './affineAccuracyBenchmark';
import { MAX_ACCEPTABLE_ERROR_M } from '../crs/affineCache';

describe('Fase 5.4 — validación de error acumulado (afín vs. referencia exacta, dataset sintético completo)', () => {
  it('el error máximo se mantiene dentro del margen aceptado (MAX_ACCEPTABLE_ERROR_M) en UTM y en plano local', () => {
    const results = runAffineAccuracySuite([500, 2_000], ['EPSG:32719']);

    expect(results.length).toBe(4); // 2 tamaños x (1 zona UTM + plano local)

    for (const r of results) {
      expect(r.vertexCount).toBeGreaterThan(0);
      expect(Number.isFinite(r.maxErrorM)).toBe(true);
      expect(r.maxErrorM).toBeLessThan(MAX_ACCEPTABLE_ERROR_M);
      expect(r.withinAcceptableError).toBe(true);
      expect(r.avgErrorM).toBeLessThanOrEqual(r.maxErrorM);
      expect(r.p95ErrorM).toBeLessThanOrEqual(r.maxErrorM);
      expect(r.p99ErrorM).toBeLessThanOrEqual(r.maxErrorM);
    }
  });

  it('reporta el flag informativo subMillimeter sin exigirlo como criterio de corte (documenta la brecha entre la redacción aspiracional y lo medido)', () => {
    const [utmResult] = runAffineAccuracySuite([1_000], ['EPSG:32719']);
    expect(utmResult.subMillimeter).toBe(utmResult.maxErrorM < 0.001);
  });
});