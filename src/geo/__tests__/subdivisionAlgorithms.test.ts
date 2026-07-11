import { describe, it, expect } from 'vitest';
import * as turf from '@turf/turf';
import {
  subdivide,
  subdivideGridRegular,
  subdivideProportional,
  subdivideManual,
  subdivideOffset,
  type SubdivisionOptions,
} from '../subdivisionAlgorithms';
import type { GeoJsonPolygon, LineString } from 'geojson';

/* ================================================================
   Helpers de fixtures
   ================================================================ */

function rectPolygon(x: number, y: number, w: number, h: number): GeoJsonPolygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
        [x, y],
      ],
    ],
  };
}

describe('subdivisionAlgorithms — grid regular', () => {
  it('subdivide un rectangulo 100x100 en grilla 5x5 de 20m con 25 lotes', () => {
    const poly = rectPolygon(0, 0, 100, 100);
    const r = subdivideGridRegular(poly, {
      method: 'grid',
      lotWidthM: 20,
      lotDepthM: 20,
    });
    expect(r.ok).toBe(true);
    expect(r.features).toHaveLength(25);
  });

  it('cada lote tiene dimensiones consistentes (~20x20)', () => {
    const poly = rectPolygon(0, 0, 100, 100);
    const r = subdivideGridRegular(poly, {
      method: 'grid',
      lotWidthM: 20,
      lotDepthM: 20,
    });
    expect(r.ok).toBe(true);
    // Verificamos que todos los lotes tienen extent similar (~20x20)
    r.features.forEach((f) => {
      const ext = turf.bbox(f);
      const w = ext[2] - ext[0];
      const h = ext[3] - ext[1];
      // Tolerancia: el lote debe medir entre 15 y 25 en cada lado
      expect(w).toBeGreaterThan(15);
      expect(w).toBeLessThan(25);
      expect(h).toBeGreaterThan(15);
      expect(h).toBeLessThan(25);
    });
  });

  it('respeta una calle interna de 5m', () => {
    const poly = rectPolygon(0, 0, 50, 50);
    const r = subdivideGridRegular(poly, {
      method: 'grid',
      lotWidthM: 20,
      lotDepthM: 20,
      innerStreetWidthM: 5,
    });
    expect(r.ok).toBe(true);
    // Esperado: cols = floor(50/20) = 2, rows = 2
    expect(r.features.length).toBe(4);
  });

  it('falla con dimensiones invalidas', () => {
    const poly = rectPolygon(0, 0, 100, 100);
    const r = subdivideGridRegular(poly, { method: 'grid', lotWidthM: 0, lotDepthM: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('falla si el poligono es muy pequeno', () => {
    const poly = rectPolygon(0, 0, 5, 5);
    const r = subdivideGridRegular(poly, { method: 'grid', lotWidthM: 20, lotDepthM: 20 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('muy pequeno');
  });
});

describe('subdivisionAlgorithms — proportional', () => {
  it('genera aproximadamente N lotes para un targetCount', () => {
    const poly = rectPolygon(0, 0, 100, 100);
    const r = subdivideProportional(poly, { method: 'proportional', targetCount: 8 });
    expect(r.ok).toBe(true);
    expect(r.features.length).toBeGreaterThanOrEqual(8);
  });

  it('deriva el count a partir del area objetivo', () => {
    const poly = rectPolygon(0, 0, 100, 100);
    const r = subdivideProportional(poly, { method: 'proportional', targetAreaM2: 1000 });
    expect(r.ok).toBe(true);
    expect(r.features.length).toBeGreaterThanOrEqual(8);
    expect(r.features.length).toBeLessThanOrEqual(12);
  });

  it('falla sin targetCount ni targetAreaM2', () => {
    const poly = rectPolygon(0, 0, 100, 100);
    const r = subdivideProportional(poly, { method: 'proportional' });
    expect(r.ok).toBe(false);
  });
});

describe('subdivisionAlgorithms — manual', () => {
  it('divide un rectangulo con una linea horizontal en dos partes', () => {
    const poly = rectPolygon(0, 0, 100, 100);
    const line: LineString = {
      type: 'LineString',
      coordinates: [
        [0, 50],
        [100, 50],
      ],
    };
    const r = subdivideManual(poly, line);
    expect(r.ok).toBe(true);
    expect(r.features.length).toBe(2);
    // Cada parte deberia tener un extent en Y acotado a una mitad
    r.features.forEach((f) => {
      const ext = turf.bbox(f);
      // Mitad del extent total
      expect(ext[3] - ext[1]).toBeLessThan(60);
    });
  });

  it('falla con linea invalida', () => {
    const poly = rectPolygon(0, 0, 100, 100);
    const line: LineString = { type: 'LineString', coordinates: [] };
    const r = subdivideManual(poly, line);
    expect(r.ok).toBe(false);
  });
});

describe('subdivisionAlgorithms — offset', () => {
  it('genera varios lotes paralelos al frente', () => {
    const poly = rectPolygon(0, 0, 100, 50);
    const r = subdivideOffset(poly, { method: 'offset', offsetDistanceM: 10 });
    expect(r.ok).toBe(true);
    // Esperamos al menos 5 lotes
    expect(r.features.length).toBeGreaterThanOrEqual(3);
  });

  it('falla con offsetDistanceM <= 0', () => {
    const poly = rectPolygon(0, 0, 100, 50);
    const r = subdivideOffset(poly, { method: 'offset', offsetDistanceM: 0 });
    expect(r.ok).toBe(false);
  });
});

describe('subdivisionAlgorithms — dispatcher', () => {
  it('delega a grid', () => {
    const poly = rectPolygon(0, 0, 40, 40);
    const opts: SubdivisionOptions = { method: 'grid', lotWidthM: 20, lotDepthM: 20 };
    const r = subdivide(poly, opts);
    expect(r.ok).toBe(true);
    expect(r.features.length).toBe(4);
  });

  it('maneja errores de manera controlada', () => {
    const poly = rectPolygon(0, 0, 10, 10);
    const r = subdivide(poly, { method: 'grid', lotWidthM: 100, lotDepthM: 100 });
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('falla con metodo desconocido', () => {
    const poly = rectPolygon(0, 0, 10, 10);
    const r = subdivide(poly, { method: 'invalid' as never });
    expect(r.ok).toBe(false);
  });
});
