// Fixtures de paridad TS <-> Rust para subdivideManzanoExact / subdivideManzanoAuto
// (metodos 'exact' y 'modo2' del dispatcher subdivideManzano). Complementa
// parityFixtures.ts, que solo cubre 'auto' (subdivideManzanoCabeceraCuerpo).
// Mismas coordenadas se replican en tests/parity_exact_modo2.rs.

import type { Pt } from '../../math/polygonEngine';

export type ExactModo2Method = 'exact' | 'modo2';

export interface ExactModo2ParityFixture {
  name: string;
  method: ExactModo2Method;
  ring: Pt[];
  targetAreaM2: number;
  frontMinM: number;
  dirPref?: { ax: number; ay: number };
}

const close = (ring: Pt[]): Pt[] => {
  if (ring.length < 2) return ring.slice();
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  return ring.slice();
};

const RECT_100X60: Pt[] = close([[0, 0], [100, 0], [100, 60], [0, 60]]);
const RECT_ANGOSTO_200X40: Pt[] = close([[0, 0], [200, 0], [200, 40], [0, 40]]);
const TRAPECIO_80X80: Pt[] = close([[0, 0], [80, 0], [80, 80], [20, 80]]);
const CUADRADO_40X40: Pt[] = close([[0, 0], [40, 0], [40, 40], [0, 40]]);
const FORMA_L: Pt[] = close([[0, 0], [50, 0], [50, 30], [30, 30], [30, 50], [0, 50]]);

export const EXACT_MODO2_PARITY_FIXTURES: ExactModo2ParityFixture[] = [
  { name: 'exact_rectangulo_100x60_target_600', method: 'exact', ring: RECT_100X60, targetAreaM2: 600, frontMinM: 10 },
  { name: 'exact_rectangulo_angosto_200x40_target_400', method: 'exact', ring: RECT_ANGOSTO_200X40, targetAreaM2: 400, frontMinM: 10 },
  { name: 'exact_trapecio_80x80_dir_x', method: 'exact', ring: TRAPECIO_80X80, targetAreaM2: 500, frontMinM: 12, dirPref: { ax: 1, ay: 0 } },
  { name: 'exact_cuadrado_40x40_target_200', method: 'exact', ring: CUADRADO_40X40, targetAreaM2: 200, frontMinM: 8 },
  { name: 'exact_forma_L_dir_y', method: 'exact', ring: FORMA_L, targetAreaM2: 300, frontMinM: 10, dirPref: { ax: 0, ay: 1 } },

  { name: 'modo2_rectangulo_100x60_target_600', method: 'modo2', ring: RECT_100X60, targetAreaM2: 600, frontMinM: 10 },
  { name: 'modo2_rectangulo_angosto_200x40_target_400', method: 'modo2', ring: RECT_ANGOSTO_200X40, targetAreaM2: 400, frontMinM: 10 },
  { name: 'modo2_trapecio_80x80_dir_x', method: 'modo2', ring: TRAPECIO_80X80, targetAreaM2: 500, frontMinM: 12, dirPref: { ax: 1, ay: 0 } },
  { name: 'modo2_cuadrado_40x40_target_200', method: 'modo2', ring: CUADRADO_40X40, targetAreaM2: 200, frontMinM: 8 },
  { name: 'modo2_forma_L_dir_y', method: 'modo2', ring: FORMA_L, targetAreaM2: 300, frontMinM: 10, dirPref: { ax: 0, ay: 1 } },
];