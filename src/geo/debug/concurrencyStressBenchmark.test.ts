import { describe, it, expect } from 'vitest';
import { buildIrregularManzanoRings, sampleEventLoopStall } from './concurrencyStressBenchmark';
import { polyArea } from '../math/polygonEngine';

describe('buildIrregularManzanoRings', () => {
  it('es determinista para la misma seed', () => {
    const a = buildIrregularManzanoRings(16, 7);
    const b = buildIrregularManzanoRings(16, 7);
    expect(a).toEqual(b);
  });

  it('seeds distintas producen rings distintos', () => {
    const a = buildIrregularManzanoRings(16, 7);
    const b = buildIrregularManzanoRings(16, 8);
    expect(a).not.toEqual(b);
  });

  it('todos los rings son cerrados, finitos y con área positiva', () => {
    const rings = buildIrregularManzanoRings(64, 0x6a1d);
    expect(rings.length).toBe(64);
    for (const ring of rings) {
      expect(ring.length).toBeGreaterThanOrEqual(6);
      const [fx, fy] = ring[0];
      const [lx, ly] = ring[ring.length - 1];
      expect(fx).toBeCloseTo(lx, 6);
      expect(fy).toBeCloseTo(ly, 6);
      for (const [x, y] of ring) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
      expect(polyArea(ring)).toBeGreaterThan(0);
    }
  });

  it('los rings tienen entre 5 y 9 vértices únicos', () => {
    const rings = buildIrregularManzanoRings(32, 1);
    for (const ring of rings) {
      const unique = ring.length - 1;
      expect(unique).toBeGreaterThanOrEqual(5);
      expect(unique).toBeLessThanOrEqual(9);
    }
  });
});

describe('sampleEventLoopStall', () => {
  it('mide un gap máximo y frames en una ventana de muestreo', async () => {
    const s = await sampleEventLoopStall(120);
    expect(s.frames).toBeGreaterThanOrEqual(1);
    expect(s.maxGapMs).toBeGreaterThanOrEqual(0);
    expect(s.avgGapMs).toBeGreaterThanOrEqual(0);
  });
});
