// Fixtures de paridad TS <-> Rust para `subdivideManzanoCabeceraCuerpo`.
// Mismas coordenadas que `crates/geourban-geo/src/subdivision_cabecera_cuerpo.rs`
// (modulo parity_tests) — si agregás una acá, agregala allá.
//
// Anillos en EPSG:3857 (metros) para que `areaM2` / `frontM` / `depthM`
// caigan en el mismo rango numérico que devuelve el motor.

import type { Pt } from '../../math/polygonEngine';

export interface ParityFixture {
  /** Identificador legible, también usado como nombre de test. */
  name: string;
  /** Anillo cerrado o abierto (la implementación cierra si hace falta). */
  ring: Pt[];
  targetAreaM2: number;
  frontMinM: number;
  /** Si está presente, fuerza la dirección principal; si no, se autodetecta. */
  dirPref?: { ax: number; ay: number };
}

const close = (ring: Pt[]): Pt[] => {
  if (ring.length < 2) return ring.slice();
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  return ring.slice();
};

export const PARITY_FIXTURES: ParityFixture[] = [
  {
    // Manzano rectangular 100x60 m, área 6000 m². target 600 m² ≈ 10 lotes.
    // Eje principal alineado al eje X (autodetección debería elegir algo cercano).
    name: 'rectangulo_100x60_target_600',
    ring: close([
      [0, 0],
      [100, 0],
      [100, 60],
      [0, 60],
    ]),
    targetAreaM2: 600,
    frontMinM: 10,
  },
  {
    // Manzano rectangular angosto 200x40 m, área 8000 m². target 400 m².
    // Caso "narrow" que ejercita `is_narrow`/reparto por mitad.
    name: 'rectangulo_angosto_200x40_target_400',
    ring: close([
      [0, 0],
      [200, 0],
      [200, 40],
      [0, 40],
    ]),
    targetAreaM2: 400,
    frontMinM: 10,
  },
  {
    // Manzano trapezoidal irregular 80x80 con esquina sesgada.
    // target 500 m², dirPref forzada en (1,0) (eje X).
    name: 'trapecio_80x80_dir_x',
    ring: close([
      [0, 0],
      [80, 0],
      [80, 80],
      [20, 80],
    ]),
    targetAreaM2: 500,
    frontMinM: 12,
    dirPref: { ax: 1, ay: 0 },
  },
  {
    // Manzano chico 40x40, área 1600 m². target 200 m². Ejercita min-area
    // y el camino "cabeza + cuerpo" con muchos lotes.
    name: 'cuadrado_40x40_target_200',
    ring: close([
      [0, 0],
      [40, 0],
      [40, 40],
      [0, 40],
    ]),
    targetAreaM2: 200,
    frontMinM: 8,
  },
  {
    // Manzano en forma de L, ~50x50 con corte de 20x20. Área ≈ 2100 m².
    // target 300 m², dirPref en (0,1) (eje Y).
    name: 'forma_L_dir_y',
    ring: close([
      [0, 0],
      [50, 0],
      [50, 30],
      [30, 30],
      [30, 50],
      [0, 50],
    ]),
    targetAreaM2: 300,
    frontMinM: 10,
    dirPref: { ax: 0, ay: 1 },
  },
];
