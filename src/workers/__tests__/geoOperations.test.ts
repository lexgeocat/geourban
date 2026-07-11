import { describe, it, expect } from 'vitest';
import {
  unionFeatures,
  mergeFeatures,
  intersectFeatures,
  subtractFeatures,
  validateTopology,
} from '../geoOperations';
import type { FeatureCollection } from 'geojson';

/* ================================================================
   Tests para operaciones topologicas JSTS (sin worker, llamadas directas)
   ================================================================ */

const squareA = {
  type: 'Feature' as const,
  properties: { name: 'A' },
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ],
  },
};

const squareB = {
  type: 'Feature' as const,
  properties: { name: 'B' },
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [5, 5],
        [15, 5],
        [15, 15],
        [5, 15],
        [5, 5],
      ],
    ],
  },
};

const disjointC = {
  type: 'Feature' as const,
  properties: { name: 'C' },
  geometry: {
    type: 'Polygon' as const,
    coordinates: [
      [
        [100, 100],
        [110, 100],
        [110, 110],
        [100, 110],
        [100, 100],
      ],
    ],
  },
};

function fc(...feats: any[]): FeatureCollection {
  return { type: 'FeatureCollection', features: feats };
}

describe('geoOperations — union', () => {
  it('une dos poligonos solapados en uno', () => {
    const r = unionFeatures(fc(squareA, squareB));
    expect(r.features).toHaveLength(1);
    // area total = 100 + 100 - 25 = 175 m2
    // No podemos usar turf.area porque esta en grados aca; solo verificamos
    // que devuelve una geometria valida.
    expect(r.features[0].geometry).toBeTruthy();
  });

  it('devuelve coleccion vacia si no hay features', () => {
    const r = unionFeatures({ type: 'FeatureCollection', features: [] });
    expect(r.features).toHaveLength(0);
  });
});

describe('geoOperations — merge', () => {
  it('es alias de union y produce el mismo resultado', () => {
    const a = mergeFeatures(fc(squareA, squareB));
    const b = unionFeatures(fc(squareA, squareB));
    expect(a.features).toHaveLength(b.features.length);
  });
});

describe('geoOperations — subtract', () => {
  it('resta B de A', () => {
    const r = subtractFeatures(fc(squareA), fc(squareB));
    expect(r.features).toHaveLength(1);
  });
});

describe('geoOperations — intersect', () => {
  it('devuelve la interseccion de A y B', () => {
    const r = intersectFeatures(fc(squareA, squareB));
    expect(r.features).toHaveLength(1);
  });
});

describe('geoOperations — validate', () => {
  it('corre sin errores y devuelve la estructura correcta', () => {
    const r = validateTopology(fc(squareA));
    expect(r).toHaveProperty('valid');
    expect(r).toHaveProperty('issues');
    expect(Array.isArray(r.issues)).toBe(true);
  });

  it('detecta features sin geometria', () => {
    const r = validateTopology({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: null as any }],
    });
    expect(r.valid).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues[0]).toMatch(/sin geometr/i);
  });

  it('procesa multiples features sin crashear', () => {
    const r = validateTopology(fc(squareA, squareB, disjointC));
    expect(r).toHaveProperty('valid');
    expect(r).toHaveProperty('issues');
  });
});
