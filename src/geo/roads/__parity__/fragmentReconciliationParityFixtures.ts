// Fixtures de paridad TS ↔ Rust para `matchFragmentsToMembers`.
// Mismas coordenadas se replican en
//   `src-tauri/crates/geourban-geo/tests/parity_fragment_reconciliation.rs`
// — si agregás una acá, agregala allá.
//
// Anillos en coordenadas métricas planas (EPSG:3857-like) para que
// `overlapArea` caiga en el mismo rango numérico que ambos motores.

import type { Pt } from '../../math/polygonEngine';

export interface FragRecParityFixture {
  /** Identificador legible, también usado como nombre de test. */
  name: string;
  /** Anillos de fragmentos (outer ring abierto). */
  fragments: Pt[][];
  /** Anillos de miembros (outer ring abierto). */
  memberRings: Pt[][];
}

/** Cuadrado abierto (4 vértices, sin cerrar). */
function sq(x0: number, y0: number, side: number): Pt[] {
  return [
    [x0, y0],
    [x0 + side, y0],
    [x0 + side, y0 + side],
    [x0, y0 + side],
  ];
}

export const FRAG_REC_PARITY_FIXTURES: FragRecParityFixture[] = [
  {
    // Fragmento idéntico al miembro → solapamiento 100%, asignación segura.
    name: 'caso_identidad',
    fragments: [sq(0, 0, 10)],
    memberRings: [sq(0, 0, 10)],
  },
  {
    // Fragmento superpuesto parcialmente (~81% de su propia área).
    // 9×9 = 81 de área, intersección con 10×10 en la esquina = 9×9 = 81.
    // ratio = 81/81 = 100% → match seguro.
    name: 'caso_parcial',
    fragments: [sq(1, 1, 9)],
    memberRings: [sq(0, 0, 10)],
  },
  {
    // Fragmento totalmente separado del miembro → overlap 0, sin match.
    name: 'caso_sin_match',
    fragments: [sq(0, 0, 10)],
    memberRings: [sq(100, 100, 10)],
  },
  {
    // Solapamiento muy chico: cuadrado 10×10 en (9.5, 9.5) vs. miembro
    // 10×10 en (0,0). Intersección = 0.5×0.5 = 0.25. Ratio = 0.25/100 =
    // 0.0025 → muy por debajo de MATCH_MIN_RATIO (0.35). Sin match.
    name: 'caso_bajo_umbral',
    fragments: [sq(9.5, 9.5, 10)],
    memberRings: [sq(0, 0, 10)],
  },
  {
    // 2 fragmentos, 2 miembros. Cada fragmento se solapa mayoritariamente
    // con un miembro distinto.
    // frag0 = (0,0)→10×10, member0 = (0,0)→10×10 → overlap perfecto.
    // frag1 = (30,30)→10×10, member1 = (30,30)→10×10 → overlap perfecto.
    name: 'caso_multi_fragmentos',
    fragments: [sq(0, 0, 10), sq(30, 30, 10)],
    memberRings: [sq(0, 0, 10), sq(30, 30, 10)],
  },
  {
    // 2 fragmentos compiten por 1 miembro (20×20).
    // frag_a = (0,0)→12×12 (overlap = 12×12 = 144 con miembro 20×20 en (0,0))
    // frag_b = (0,0)→8×8  (overlap = 8×8  = 64 con mismo miembro)
    // Greedy por mayor overlap → frag_a gana el miembro; frag_b queda sin asignar.
    name: 'caso_competencia',
    fragments: [sq(0, 0, 12), sq(0, 0, 8)],
    memberRings: [sq(0, 0, 20)],
  },
];
