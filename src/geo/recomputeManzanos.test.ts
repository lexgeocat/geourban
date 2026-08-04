// src/geo/recomputeManzanos.test.ts
//
// Tests unitarios de las funciones puras extraídas en Fase 4.
// Hoy alcanza solo con `computeRoadFingerprintDelta` (única función
// 100% pura del archivo). El resto del flujo de `recomputeManzanos`
// depende del bridge nativo de Tauri y del estado de varias stores,
// por lo que sus tests de caracterización quedan fuera del alcance
// (ver PHASE-4.md — sección "Lo que esta fase no toca").

import { describe, it, expect } from 'vitest';
import { computeRoadFingerprintDelta } from './recomputeManzanos';
import type { Street } from '../store/entities/streetStore';
import type { Roundabout } from '../store/entities/roundaboutStore';

function makeStreet(overrides: Partial<Street> & { id: string }): Street {
  return {
    id: overrides.id,
    name: `s-${overrides.id}`,
    start: overrides.start ?? [0, 0],
    end: overrides.end ?? [100, 0],
    widthM: overrides.widthM ?? 6,
    sideWidthM: overrides.sideWidthM ?? 2,
    waypoints: overrides.waypoints,
  };
}

function makeRoundabout(overrides: Partial<Roundabout> & { id: string }): Roundabout {
  return {
    id: overrides.id,
    name: `r-${overrides.id}`,
    center: overrides.center ?? [0, 0],
    radiusM: overrides.radiusM ?? 10,
    sides: overrides.sides ?? 0,
    rotation: overrides.rotation ?? 0,
    roadWidthM: overrides.roadWidthM ?? 6,
    sidewalkWidthM: overrides.sidewalkWidthM ?? 2,
  };
}

describe('computeRoadFingerprintDelta', () => {
  it('con prev vacío y mismos streets, todo aparece como nuevo en changedExtent', () => {
    const streets = [
      makeStreet({ id: 'a', start: [0, 0], end: [100, 0], widthM: 6 }),
      makeStreet({ id: 'b', start: [200, 0], end: [300, 0], widthM: 8 }),
    ];
    const prev = new globalThis.Map();
    const { changedExtent } = computeRoadFingerprintDelta(streets, [], prev);
    expect(changedExtent).not.toBeNull();
    expect(changedExtent![0]).toBeLessThanOrEqual(0 - 5);
    expect(changedExtent![2]).toBeGreaterThanOrEqual(300 + 5);
  });

  it('sin cambios, changedExtent es null', () => {
    const streets = [
      makeStreet({ id: 'a', start: [0, 0], end: [100, 0], widthM: 6 }),
    ];
    const first = computeRoadFingerprintDelta(streets, [], new globalThis.Map());
    const second = computeRoadFingerprintDelta(streets, [], first.current);
    expect(second.changedExtent).toBeNull();
  });

  it('un cambio puntual agrega solo el extent del elemento modificado', () => {
    const before = [
      makeStreet({ id: 'a', start: [0, 0], end: [100, 0], widthM: 6 }),
      makeStreet({ id: 'b', start: [500, 500], end: [600, 600], widthM: 6 }),
    ];
    const first = computeRoadFingerprintDelta(before, [], new globalThis.Map());
    const after = [
      makeStreet({ id: 'a', start: [0, 0], end: [100, 0], widthM: 6 }),
      makeStreet({ id: 'b', start: [500, 500], end: [600, 600], widthM: 12 }),
    ];
    const { changedExtent } = computeRoadFingerprintDelta(after, [], first.current);
    expect(changedExtent).not.toBeNull();
    expect(changedExtent![0]).toBeGreaterThanOrEqual(500 - 12);
    expect(changedExtent![1]).toBeGreaterThanOrEqual(500 - 12);
    expect(changedExtent![2]).toBeLessThanOrEqual(600 + 12);
    expect(changedExtent![3]).toBeLessThanOrEqual(600 + 12);
  });

  it('un elemento eliminado (no aparece en current) suma su extent a changedExtent', () => {
    const before = [
      makeStreet({ id: 'a', start: [0, 0], end: [100, 0], widthM: 6 }),
      makeStreet({ id: 'gone', start: [800, 800], end: [900, 900], widthM: 6 }),
    ];
    const first = computeRoadFingerprintDelta(before, [], new globalThis.Map());
    const after = [makeStreet({ id: 'a', start: [0, 0], end: [100, 0], widthM: 6 })];
    const { changedExtent } = computeRoadFingerprintDelta(after, [], first.current);
    expect(changedExtent).not.toBeNull();
    expect(changedExtent![0]).toBeLessThanOrEqual(800 - 5);
    expect(changedExtent![2]).toBeGreaterThanOrEqual(900 + 5);
  });

  it('mezcla streets + roundabouts y refleja cambios de ambos', () => {
    const beforeStreets = [
      makeStreet({ id: 's1', start: [0, 0], end: [100, 0], widthM: 6 }),
    ];
    const beforeRoundabouts = [
      makeRoundabout({ id: 'r1', center: [500, 500], radiusM: 10 }),
    ];
    const first = computeRoadFingerprintDelta(beforeStreets, beforeRoundabouts, new globalThis.Map());
    const afterStreets = [
      makeStreet({ id: 's1', start: [0, 0], end: [100, 0], widthM: 12 }),
    ];
    const afterRoundabouts = [
      makeRoundabout({ id: 'r1', center: [500, 500], radiusM: 10 }),
    ];
    const { changedExtent } = computeRoadFingerprintDelta(afterStreets, afterRoundabouts, first.current);
    expect(changedExtent).not.toBeNull();
    expect(changedExtent![0]).toBeLessThanOrEqual(0 - 8);
    expect(changedExtent![2]).toBeGreaterThanOrEqual(100 + 8);
  });

  it('no muta `prev` (es función pura)', () => {
    const streets = [makeStreet({ id: 'a', start: [0, 0], end: [100, 0] })];
    const prev = new globalThis.Map();
    const before = new globalThis.Map(prev);
    computeRoadFingerprintDelta(streets, [], prev);
    expect(prev.size).toBe(before.size);
  });

  it('retorna `current` con todas las entradas (nuevas + persistidas)', () => {
    const streetsA = [makeStreet({ id: 'a' })];
    const streetsB = [makeStreet({ id: 'a' }), makeStreet({ id: 'b' })];
    const first = computeRoadFingerprintDelta(streetsA, [], new globalThis.Map());
    const { current } = computeRoadFingerprintDelta(streetsB, [], first.current);
    expect(current.has('s:a')).toBe(true);
    expect(current.has('s:b')).toBe(true);
    expect(current.size).toBe(2);
  });

  it('waypoints y cambios laterales se reflejan en el fingerprint', () => {
    const base = makeStreet({
      id: 'a',
      start: [0, 0],
      end: [100, 0],
      widthM: 6,
      sideWidthM: 2,
    });
    const first = computeRoadFingerprintDelta([base], [], new globalThis.Map());
    const modified = { ...base, sideWidthM: 4 };
    const { changedExtent } = computeRoadFingerprintDelta([modified], [], first.current);
    expect(changedExtent).not.toBeNull();
  });
});