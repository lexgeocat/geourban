// src/geo/debug/syntheticUrbanLayout.ts
//
// Fase 6.1 (auditoria-para-mejora.md) — generador de layout urbano
// sintético AVANZADO: grilla de calles con anchos variables, avenidas
// diagonales, rotondas (círculo y polígono) en algunas intersecciones,
// y un perímetro de sitio irregular (no el bbox exacto de la grilla).
//
// A diferencia de `syntheticDataset.ts` (Fase 0 — precomputa manzanos
// RECTANGULARES directamente como GeoJSON, sin pasar por el pipeline
// real), este generador produce ENTIDADES (calles, rotondas, perímetro)
// pensadas para alimentar el pipeline de producción real:
//   recomputeManzanos() → computeManzanosInWorker() [GEOS union+difference]
//     → matchFragmentsToMembers() [reconciliación] → subdivideManzanoBatch()
// de modo que las Fases 2.2 (subdivisión) y 2.3/2.4 (booleanas +
// reconciliación de fragmentos) tengan con qué probarse a escala real,
// con manzanos de geometría IRREGULAR (triángulos, trapecios, polígonos
// de borde recortado) — no solo rectángulos de grilla.
//
// Puro y determinista: mismo seed ⇒ mismo layout, byte a byte. Sin
// dependencias de stores de Zustand — el loader que sí toca stores
// (drawSource, streetStore, roundaboutStore) vive en
// `syntheticUrbanBenchmark.ts`, separado a propósito para poder testear
// la geometría con vitest sin levantar un Map de OpenLayers.

import type { Pt } from '../math/polygonEngine';
import type { Street } from '../../store/entities/streetStore';
import type { RoundaboutParams } from '../roundabout/roundaboutEngine';

// ─── PRNG determinista ──────────────────────────────────────────────
// Mismo algoritmo que `mulberry32.rs` (src-tauri/crates/geourban-geo/
// src/mulberry32.rs) — no hace falta bit-a-bit idéntico entre TS/Rust
// para este uso (solo consume el lado TS), pero mantener la misma
// familia de PRNG que ya usa el repo evita introducir una tercera
// convención de aleatoriedad determinista.
export class Mulberry32 {
  private a: number;
  constructor(seed: number) {
    this.a = seed >>> 0;
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }
}

export type SyntheticStreetEntry = Omit<Street, 'id' | 'name'> & { name: string };

export interface SyntheticUrbanLayoutOptions {
  /** Cantidad aproximada de manzanos en la grilla ortogonal principal. */
  targetBlockCount?: number;
  blockWidthM?: number;
  blockHeightM?: number;
  /** Ancho de calle mínimo/máximo — cada calle interior recibe un ancho
   * aleatorio (determinista) dentro de este rango. */
  minStreetWidthM?: number;
  maxStreetWidthM?: number;
  sideWidthM?: number;
  /** Ancho de las avenidas diagonales (más anchas que las calles internas). */
  avenueWidthM?: number;
  /** Cantidad de avenidas diagonales que cruzan TODA la grilla en ángulo
   * — generan fragmentos triangulares/trapezoidales al cortar los
   * manzanos de la grilla ortogonal (geometría irregular real). */
  diagonalAvenueCount?: number;
  /** 1 rotonda cada N intersecciones interiores (aprox). 0 = sin rotondas. */
  roundaboutEvery?: number;
  roundaboutRadiusM?: number;
  roundaboutRoadWidthM?: number;
  roundaboutSidewalkWidthM?: number;
  /** Amplitud (m) del jitter radial que irregulariza el borde del sitio.
   * 0 = perímetro perfectamente regular (octágono liso). */
  boundaryJaggedness?: number;
  /** Centro del layout en EPSG:3857 (unidades internas del proyecto). */
  center?: Pt;
  seed?: number;
}

export interface SyntheticUrbanLayoutResult {
  streets: SyntheticStreetEntry[];
  roundabouts: RoundaboutParams[];
  /** Anillo(s) exterior(es) — una "parcela madre" por elemento, cerrados, sin huecos. */
  perimeters: Pt[][];
  extent: [number, number, number, number];
  gridCols: number;
  gridRows: number;
  blockCountEstimate: number;
}

export const SYNTHETIC_URBAN_LAYOUT_DEFAULTS: Required<Omit<SyntheticUrbanLayoutOptions, 'center'>> = {
  targetBlockCount: 100,
  blockWidthM: 80,
  blockHeightM: 60,
  minStreetWidthM: 6,
  maxStreetWidthM: 14,
  sideWidthM: 2,
  avenueWidthM: 20,
  diagonalAvenueCount: 2,
  roundaboutEvery: 6,
  roundaboutRadiusM: 12,
  roundaboutRoadWidthM: 8,
  roundaboutSidewalkWidthM: 2,
  boundaryJaggedness: 6,
  seed: 0xc0ffee,
};

function closeRing(ring: Pt[]): Pt[] {
  const f = ring[0], l = ring[ring.length - 1];
  if (!f || !l) return ring;
  if (Math.abs(f[0] - l[0]) > 1e-9 || Math.abs(f[1] - l[1]) > 1e-9) return [...ring, [f[0], f[1]]];
  return ring;
}

/**
 * Perímetro irregular que envuelve `bbox` con margen: polígono radial
 * base (16 vértices) + jitter RADIAL por vértice (nunca angular), lo
 * que garantiza que el resultado sea siempre "star-shaped" respecto al
 * centro y por lo tanto simple (sin auto-intersecciones) — no hace
 * falta validar/sanear después. El interior de la grilla queda intacto;
 * lo irregular es el borde del sitio, que es el caso real más común
 * (parcela de forma libre, trazado interno regular).
 */
function buildIrregularPerimeter(
  bbox: [number, number, number, number],
  marginM: number,
  jaggedness: number,
  rng: Mulberry32,
): Pt[] {
  const [minX, minY, maxX, maxY] = bbox;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2 + marginM;
  const ry = (maxY - minY) / 2 + marginM;
  const maxR = Math.max(rx, ry, 1e-6);

  const N = 16;
  const ring: Pt[] = [];
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2;
    // Clamp a un mínimo positivo: por más jaggedness que se pida, el
    // radio nunca se invierte — así el polígono queda garantizado simple.
    const jitterR = Math.max(0.05, 1 + (jaggedness > 0 ? rng.range(-jaggedness, jaggedness) / maxR : 0));
    ring.push([cx + Math.cos(angle) * rx * jitterR, cy + Math.sin(angle) * ry * jitterR]);
  }
  return closeRing(ring);
}

/** Clip Liang-Barsky de la recta (origin + t*dir) contra `bbox`. Devuelve
 * los dos puntos de entrada/salida, o null si la recta no cruza el bbox. */
function lineExtentIntersection(
  origin: Pt,
  dir: Pt,
  bbox: [number, number, number, number],
): [Pt, Pt] | null {
  const [minX, minY, maxX, maxY] = bbox;
  let tMin = -Infinity, tMax = Infinity;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > tMax) return false; if (t > tMin) tMin = t; }
    else { if (t < tMin) return false; if (t < tMax) tMax = t; }
    return true;
  };
  if (!clip(-dir[0], origin[0] - minX)) return null;
  if (!clip(dir[0], maxX - origin[0])) return null;
  if (!clip(-dir[1], origin[1] - minY)) return null;
  if (!clip(dir[1], maxY - origin[1])) return null;
  if (tMin > tMax) return null;
  return [
    [origin[0] + dir[0] * tMin, origin[1] + dir[1] * tMin],
    [origin[0] + dir[0] * tMax, origin[1] + dir[1] * tMax],
  ];
}

/**
 * Genera un layout urbano sintético completo: grilla ortogonal con
 * anchos de calle variables, avenidas diagonales, rotondas (mezcla de
 * círculos y polígonos) en algunas intersecciones interiores, y un
 * perímetro de sitio irregular que envuelve todo con margen.
 * Determinista para el mismo `seed` — mismo layout byte a byte.
 */
export function generateSyntheticUrbanLayout(
  opts: SyntheticUrbanLayoutOptions = {},
): SyntheticUrbanLayoutResult {
  const cfg = { ...SYNTHETIC_URBAN_LAYOUT_DEFAULTS, ...opts };
  const center: Pt = opts.center ?? [0, 0];
  const rng = new Mulberry32(cfg.seed);

  const cols = Math.max(1, Math.round(Math.sqrt(cfg.targetBlockCount)));
  const rows = Math.max(1, Math.ceil(cfg.targetBlockCount / cols));

  const gridWidthM = cols * cfg.blockWidthM;
  const gridHeightM = rows * cfg.blockHeightM;
  const originX = center[0] - gridWidthM / 2;
  const originY = center[1] - gridHeightM / 2;
  const bbox: [number, number, number, number] = [originX, originY, originX + gridWidthM, originY + gridHeightM];

  const streets: SyntheticStreetEntry[] = [];
  let streetIdx = 0;
  const nextStreetName = (prefix: string) => `${prefix} sintética ${streetIdx++}`;

  // ── Calles horizontales interiores ──
  const hLines: number[] = [];
  for (let r = 1; r < rows; r++) hLines.push(originY + r * cfg.blockHeightM);
  for (const y of hLines) {
    streets.push({
      start: [originX, y],
      end: [originX + gridWidthM, y],
      widthM: rng.range(cfg.minStreetWidthM, cfg.maxStreetWidthM),
      sideWidthM: cfg.sideWidthM,
      name: nextStreetName('Calle H'),
    });
  }

  // ── Calles verticales interiores ──
  const vLines: number[] = [];
  for (let c = 1; c < cols; c++) vLines.push(originX + c * cfg.blockWidthM);
  for (const x of vLines) {
    streets.push({
      start: [x, originY],
      end: [x, originY + gridHeightM],
      widthM: rng.range(cfg.minStreetWidthM, cfg.maxStreetWidthM),
      sideWidthM: cfg.sideWidthM,
      name: nextStreetName('Calle V'),
    });
  }

  // ── Avenidas diagonales — cruzan toda la grilla en ángulo; generan
  //    los fragmentos triangulares/trapezoidales que la grilla pura no
  //    puede producir por sí sola. ──
  const diagonalBbox: [number, number, number, number] = [
    originX - cfg.blockWidthM, originY - cfg.blockHeightM,
    originX + gridWidthM + cfg.blockWidthM, originY + gridHeightM + cfg.blockHeightM,
  ];
  for (let i = 0; i < cfg.diagonalAvenueCount; i++) {
    // Ángulos alejados de 0°/90° para no quedar casi-paralela a la grilla.
    const angleDeg = rng.range(25, 65) + (i % 2 === 0 ? 0 : 90);
    const angleRad = (angleDeg * Math.PI) / 180;
    const dir: Pt = [Math.cos(angleRad), Math.sin(angleRad)];
    const t = rng.range(0.25, 0.75);
    const anchor: Pt = [
      originX + gridWidthM * (i % 2 === 0 ? t : rng.range(0.2, 0.8)),
      originY + gridHeightM * (i % 2 === 0 ? rng.range(0.2, 0.8) : t),
    ];
    const clipped = lineExtentIntersection(anchor, dir, diagonalBbox);
    if (!clipped) continue;
    streets.push({
      start: clipped[0],
      end: clipped[1],
      widthM: cfg.avenueWidthM,
      sideWidthM: cfg.sideWidthM * 1.5,
      name: nextStreetName('Avenida'),
    });
  }

  // ── Rotondas en algunas intersecciones interiores — mezcla de
  //    círculos (sides=0) y polígonos (4-8 lados). ──
  const roundabouts: RoundaboutParams[] = [];
  if (cfg.roundaboutEvery > 0) {
    let idx = 0;
    for (const y of hLines) {
      for (const x of vLines) {
        idx++;
        if (idx % cfg.roundaboutEvery !== 0) continue;
        roundabouts.push({
          center: [x, y],
          radiusM: cfg.roundaboutRadiusM,
          sides: rng.next() < 0.4 ? rng.int(4, 8) : 0,
          rotation: rng.range(0, Math.PI / 4),
          roadWidthM: cfg.roundaboutRoadWidthM,
          sidewalkWidthM: cfg.roundaboutSidewalkWidthM,
        });
      }
    }
  }

  // ── Perímetro irregular que envuelve la grilla completa con margen ──
  const margin = Math.max(cfg.blockWidthM, cfg.blockHeightM) * 0.4;
  const perimeter = buildIrregularPerimeter(bbox, margin, cfg.boundaryJaggedness, rng);

  const fullExtent: [number, number, number, number] = [
    Math.min(...perimeter.map((p) => p[0])),
    Math.min(...perimeter.map((p) => p[1])),
    Math.max(...perimeter.map((p) => p[0])),
    Math.max(...perimeter.map((p) => p[1])),
  ];

  return {
    streets,
    roundabouts,
    perimeters: [perimeter],
    extent: fullExtent,
    gridCols: cols,
    gridRows: rows,
    blockCountEstimate: rows * cols,
  };
}