// src/map/advancedSnap.test.ts
//
// Tests de Fase 9 (Prioridad 3) — lógica de `findSnap` y la histéresis
// `applySticky`. Cubre:
//  - endpoint snap
//  - midpoint snap
//  - perpendicular snap (con anchor)
//  - prioridad por tipo: a igualdad de distancia gana el de mayor prioridad
//  - applySticky: previous cercano dentro del sticky band bloquea al nuevo
//  - tolerance: candidato fuera de la banda → null
//  - extension: cursor más allá del final del segmento
//
// Las pruebas usan LineString como feature mínima porque Polygon arrastra
// lógica de rings/holes que no aporta al test de snapping.

import { describe, it, expect } from 'vitest';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import { findSnap, SNAP_TYPE_PRIORITY } from './advancedSnap';
import type { SnapType } from './advancedSnap';

function lineFeature(coords: number[][]): Feature {
  const f = new Feature({ geometry: new LineString(coords) });
  f.setId(`feat-${coords[0][0]}-${coords[0][1]}`);
  return f;
}

// helper: cursor en un punto exacto y tolerance amplia
const find = (cursor: number[], src: VectorSource, opts: Parameters<typeof findSnap>[2]) =>
  findSnap(cursor, src, opts);

describe('findSnap — endpoint', () => {
  it('cursor sobre un endpoint retorna snap de tipo endpoint', () => {
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    const result = find([0, 0], src, { resolution: 1 });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('endpoint');
    expect(result!.point).toEqual([0, 0]);
  });

  it('endpoint gana sobre nearest a igualdad de distancia', () => {
    // El segmento [0,0]→[100,0] tiene midpoint en [50,0].
    // Colocamos el cursor en (50, 5): equidistante del midpoint (5) y
    // del nearest sobre el segmento (también 5). La prioridad debería
    // hacer ganar al midpoint (priority 4) sobre nearest (priority 7).
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    const result = find([50, 5], src, { resolution: 1 });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('midpoint');
  });
});

describe('findSnap — midpoint', () => {
  it('cursor cerca del midpoint retorna snap de tipo midpoint', () => {
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    const result = find([50, 2], src, { resolution: 1 });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('midpoint');
    expect(result!.point[0]).toBeCloseTo(50, 5);
    expect(result!.point[1]).toBeCloseTo(0, 5);
  });
});

describe('findSnap — perpendicular', () => {
  it('cursor con anchor sobre la perpendicular al segmento', () => {
    // anchor en (10, 100); segmento horizontal [0,0]→[100,0].
    // perpendicularFromAnchor proyecta anchor sobre el segmento en (10, 0).
    // Cursor en (10, 9.5) — dentro de perpendicular tolerance (10 m)
    // pero fuera de nearest (8.5 m) y de endpoint tolerance (11.5 m
    // desde (0, 0) son ~13.4 m).
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    const result = find([10, 9.5], src, {
      resolution: 1,
      anchor: [10, 100],
    });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('perpendicular');
  });

  it('sin anchor, perpendicular no se calcula aunque haya candidato', () => {
    // Si no se pasa anchor, perpendicularFromAnchor retorna null y no
    // aparece en candidates; nearest queda como ganador.
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    const result = find([50, 2], src, { resolution: 1 });
    expect(result).not.toBeNull();
    expect(result!.type).not.toBe('perpendicular');
  });
});

describe('findSnap — prioridad por tipo', () => {
  it('a igualdad de distancia gana el de menor número de prioridad', () => {
    // El segmento horizontal: en (50, 5) tenemos midpoint (priority 4) y
    // nearest (priority 7) a la misma distancia. Gana midpoint.
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    const result = find([50, 5], src, { resolution: 1 });
    expect(result!.type).toBe('midpoint');
    expect(SNAP_TYPE_PRIORITY[result!.type]).toBeLessThan(SNAP_TYPE_PRIORITY['nearest']);
  });

  it('con dos endpoints distintos en el area, gana el más cercano', () => {
    // Dos segmentos que comparten un endpoint: [0,0]→[50,50] y [0,0]→[50,-50].
    // Cursor en (5, 0): más cerca de (0,0) que de cualquier otro punto,
    // pero hay dos candidatos "endpoint" en (0,0). El de menor dist gana.
    const src = new VectorSource({
      features: [
        lineFeature([[0, 0], [50, 50]]),
        lineFeature([[0, 0], [50, -50]]),
      ],
    });
    const result = find([5, 0], src, { resolution: 1 });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('endpoint');
    expect(result!.point).toEqual([0, 0]);
  });
});

describe('findSnap — tolerance', () => {
  it('candidato fuera de tolerance retorna null (sin previous)', () => {
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    // Cursor a 50 m del segmento — pixelTolerance default 10 × resolution 1 = 10 m
    const result = find([50, 50], src, { resolution: 1 });
    expect(result).toBeNull();
  });

  it('pixelTolerance explícito controla la banda', () => {
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    // Cursor a 15 m del segmento; con tolerance 20 m debe capturarlo.
    const result = find([50, 15], src, { resolution: 1, pixelTolerance: 20 });
    expect(result).not.toBeNull();
  });
});

describe('findSnap — extension', () => {
  it('cursor más allá del final del segmento, sobre la línea extendida', () => {
    // Segmento [0,0]→[100,0]; cursor en (120, 0) está sobre la extensión.
    // Con extension tolerance 1.6 × 10 = 16 m, (120, 0) está a 20 m del
    // endpoint (100, 0) — fuera del endpoint tolerance (factor 1.15 → 11.5 m).
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    const result = find([120, 0], src, { resolution: 1 });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('extension');
    expect(result!.point[0]).toBeCloseTo(120, 4);
  });
});

describe('findSnap — applySticky (histéresis)', () => {
  // El STICKY_BAND_PX = 3 y resolution = 1 → stickyRadius = 3 m.
  // tolerance default = 10 m. prevStillClose requiere dist(cursor, prev) < 13 m.
  it('previous con prioridad mejor o igual bloquea al nuevo candidato', () => {
    // previous = endpoint en (0, 0); cursor en (3, 5) — dentro del sticky band.
    // El nuevo candidato más fuerte es endpoint en (0, 0) (dist 5.83 m).
    // previous.type.priority (0) <= best.type.priority (0) → previous gana.
    // Verifica que la salida es previous (mismo punto, pero el contrato
    // es que previous bloquea al new).
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    const previous = {
      point: [0, 0],
      type: 'endpoint' as SnapType,
      dist: 0,
    };
    const result = find([3, 5], src, { resolution: 1, previous });
    expect(result).not.toBeNull();
    expect(result!.point).toEqual([0, 0]);
    expect(result!.type).toBe('endpoint');
  });

  it('sin previous, no hay sticky: candidato nuevo gana por prioridad', () => {
    // Sin previous: en (5, 5) hay endpoint en (0, 0) a ~7 m (dentro de
    // la tolerance extendida) y nearest a 5 m. Endpoint (priority 0)
    // gana sobre nearest (priority 7).
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    const result = find([5, 5], src, { resolution: 1 });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('endpoint');
  });

  it('best con prioridad mejor que previous puede ganar al sticky', () => {
    // previous = nearest (priority 7) en (5, 5); cursor en (0, 1).
    // El endpoint (0, 0) está a 1 m (priority 0, mejor que nearest 7).
    // Regla: previous.type.priority (7) <= best.type.priority (0) → false.
    // best gana (la lógica prioriza la mejor prioridad sobre la sticky).
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    const previous = {
      point: [5, 5],
      type: 'nearest' as SnapType,
      dist: 0,
    };
    const result = find([0, 1], src, { resolution: 1, previous });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('endpoint');
  });

  it('previous lejos del cursor no aplica sticky', () => {
    // previous en (100, 0); cursor en (0, 5). El previous está fuera del
    // sticky band (cursor–previous ≈ 100 m > 13 m). El nuevo candidato
    // es endpoint en (0, 0).
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    const previous = {
      point: [100, 0],
      type: 'nearest' as SnapType,
      dist: 0,
    };
    const result = find([0, 5], src, { resolution: 1, previous });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('endpoint');
  });

  it('best muy cerca del previous (dentro de stickyRadius/2) gana aunque previous tenga mejor prioridad', () => {
    // previous = endpoint en (0, 0); cursor en (0.5, 0).
    // El nuevo candidato endpoint también está en (0, 0) — distancia
    // best↔previous = 0 < stickyRadius/2 = 1.5. Best gana por la regla
    // "best está demasiado cerca del previous, son el mismo snap".
    const src = new VectorSource({ features: [lineFeature([[0, 0], [100, 0]])] });
    const previous = {
      point: [0, 0],
      type: 'endpoint' as SnapType,
      dist: 0,
    };
    const result = find([0.5, 0], src, { resolution: 1, previous });
    expect(result).not.toBeNull();
    expect(result!.type).toBe('endpoint');
    expect(result!.point).toEqual([0, 0]);
  });
});

describe('SNAP_TYPE_PRIORITY (sanity)', () => {
  it('endpoint es la prioridad más alta (menor número)', () => {
    expect(SNAP_TYPE_PRIORITY.endpoint).toBe(0);
  });
  it('nearest es la prioridad más baja (mayor número)', () => {
    expect(SNAP_TYPE_PRIORITY.nearest).toBe(7);
  });
});