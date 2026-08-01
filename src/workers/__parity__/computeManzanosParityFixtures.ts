// Fixtures de paridad TS (JSTS, geoOperations.ts::computeManzanos) <-> Rust
// (GEOS, boolean_ops.rs::compute_manzanos). Mismos rectangulos se replican
// en tests/parity_compute_manzanos.rs.

import type { Pt } from '../../geo/math/polygonEngine';

export interface ComputeManzanosParityFixture {
  name: string;
  /** Cada parcela: anillo exterior unico (sin huecos). */
  parcelRings: Pt[][];
  /** Anillos de calles crudos, sin unir todavia. */
  roadRings: Pt[][];
}

function rect(x0: number, y0: number, x1: number, y1: number): Pt[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

export const COMPUTE_MANZANOS_PARITY_FIXTURES: ComputeManzanosParityFixture[] = [
  {
    name: 'single_road_bisects_square_parcel',
    parcelRings: [rect(0, 0, 100, 100)],
    roadRings: [rect(-10, 45, 110, 55)],
  },
  {
    // Dos calles cruzadas -> union en forma de "+" -> 4 fragmentos (MultiPolygon).
    name: 'two_perpendicular_roads_grid',
    parcelRings: [rect(0, 0, 100, 100)],
    roadRings: [rect(-10, 45, 110, 55), rect(45, -10, 55, 110)],
  },
  {
    name: 'road_outside_parcel_leaves_parcel_intact',
    parcelRings: [rect(0, 0, 50, 50)],
    roadRings: [rect(200, 200, 210, 260)],
  },
  {
    name: 'road_clips_a_single_corner',
    parcelRings: [rect(0, 0, 40, 40)],
    roadRings: [rect(30, 30, 50, 50)],
  },
  {
    name: 'two_parcels_one_shared_road',
    parcelRings: [rect(0, 0, 40, 40), rect(60, 0, 100, 40)],
    roadRings: [rect(38, -10, 62, 50)],
  },
];