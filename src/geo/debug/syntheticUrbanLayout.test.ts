// src/geo/debug/syntheticUrbanLayout.test.ts
import { describe, it, expect } from 'vitest';
import { generateSyntheticUrbanLayout, Mulberry32 } from './syntheticUrbanLayout';
import { polyArea } from '../math/polygonEngine';

describe('Mulberry32', () => {
  it('es determinista para la misma seed', () => {
    const a = new Mulberry32(42);
    const b = new Mulberry32(42);
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next());
  });

  it('produce valores en [0,1)', () => {
    const rng = new Mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generateSyntheticUrbanLayout', () => {
  it('es determinista para el mismo seed (mismo layout byte a byte)', () => {
    const a = generateSyntheticUrbanLayout({ targetBlockCount: 36, seed: 123 });
    const b = generateSyntheticUrbanLayout({ targetBlockCount: 36, seed: 123 });
    expect(a).toEqual(b);
  });

  it('genera calles con anchos dentro del rango configurado', () => {
    const layout = generateSyntheticUrbanLayout({
      targetBlockCount: 36, minStreetWidthM: 5, maxStreetWidthM: 9, diagonalAvenueCount: 0, seed: 1,
    });
    expect(layout.streets.length).toBeGreaterThan(0);
    for (const s of layout.streets) {
      expect(s.widthM).toBeGreaterThanOrEqual(5);
      expect(s.widthM).toBeLessThanOrEqual(9);
    }
  });

  it('genera avenidas diagonales con coordenadas finitas', () => {
    const layout = generateSyntheticUrbanLayout({ targetBlockCount: 25, diagonalAvenueCount: 3, seed: 5 });
    const avenues = layout.streets.filter((s) => s.name.startsWith('Avenida'));
    expect(avenues.length).toBeGreaterThan(0);
    for (const av of avenues) {
      expect(Number.isFinite(av.start[0])).toBe(true);
      expect(Number.isFinite(av.start[1])).toBe(true);
      expect(Number.isFinite(av.end[0])).toBe(true);
      expect(Number.isFinite(av.end[1])).toBe(true);
      expect(av.widthM).toBeGreaterThan(0);
    }
  });

  it('el perímetro es un anillo cerrado, simple (área positiva), sin vértices no-finitos', () => {
    const layout = generateSyntheticUrbanLayout({ targetBlockCount: 64, seed: 99 });
    for (const ring of layout.perimeters) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
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

  it('el perímetro sigue siendo simple incluso con jaggedness alto (radio nunca se invierte)', () => {
    const layout = generateSyntheticUrbanLayout({ targetBlockCount: 9, boundaryJaggedness: 500, seed: 17 });
    for (const ring of layout.perimeters) {
      expect(polyArea(ring)).toBeGreaterThan(0);
      for (const [x, y] of ring) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  });

  it('las rotondas generadas (si las hay) tienen parámetros válidos', () => {
    const layout = generateSyntheticUrbanLayout({ targetBlockCount: 100, roundaboutEvery: 3, seed: 11 });
    expect(layout.roundabouts.length).toBeGreaterThan(0);
    for (const rb of layout.roundabouts) {
      expect(rb.radiusM).toBeGreaterThan(0);
      expect(rb.sides === 0 || rb.sides >= 3).toBe(true);
      expect(Number.isFinite(rb.center[0])).toBe(true);
      expect(Number.isFinite(rb.center[1])).toBe(true);
    }
  });

  it('roundaboutEvery=0 no genera ninguna rotonda', () => {
    const layout = generateSyntheticUrbanLayout({ targetBlockCount: 100, roundaboutEvery: 0, seed: 11 });
    expect(layout.roundabouts.length).toBe(0);
  });

  it('respeta targetBlockCount aproximadamente vía gridCols*gridRows', () => {
    const layout = generateSyntheticUrbanLayout({ targetBlockCount: 200, seed: 2 });
    expect(layout.gridCols * layout.gridRows).toBeGreaterThanOrEqual(200);
    expect(layout.blockCountEstimate).toBe(layout.gridCols * layout.gridRows);
  });

  it('seeds distintos producen layouts distintos', () => {
    const a = generateSyntheticUrbanLayout({ targetBlockCount: 36, seed: 1 });
    const b = generateSyntheticUrbanLayout({ targetBlockCount: 36, seed: 2 });
    expect(a).not.toEqual(b);
  });
});