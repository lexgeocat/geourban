// src/geo/__fuzz__/degenerateGeometry.fuzz.test.ts
//
// Fase 2.6 (auditoria-para-mejora.md) — fuzzing sistemático de geometría
// degenerada contra el motor TS. Genera un corpus determinista (semilla
// fija) de anillos, calles y parcelas patológicas — casi-colineales,
// auto-intersectantes, con vértices duplicados, slivers de área
// casi-nula, coordenadas extremas — y verifica que el pipeline completo
// (saneo, subdivisión, unión de red vial, reconciliación de fragmentos,
// cómputo de manzanos) nunca lance una excepción no controlada ni
// produzca NaN/Infinity en su salida.
//
// No reemplaza los tests de paridad (__parity__/*): esos comparan TS vs
// Rust sobre geometría "sana". Este archivo solo golpea al motor TS con
// entradas patológicas.

import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { sanitizeRing, sanitizeRings } from '../sanitizeRing';
import { subdivideManzano, type ManzanoLoteMethod } from '../subdivision/subdivisionAlgorithms';
import { computeRoadNetworkNet, type RoadNetworkNet } from '../roads/roadNetworkNet';
import { matchFragmentsToMembers } from '../roads/fragmentReconciliation';
import { buildRoadNetworkRings } from '../roads/roadNetworkEngine';
import { polyArea, type Pt, type LotResult } from '../math/polygonEngine';
import { computeManzanos } from '../../workers/geoOperations';
import type { Street } from '../../store/entities/streetStore';
import type { CornerMode } from '../roads/ringFillet';

// ─── PRNG determinista (mulberry32) — reproducible entre corridas ─────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_SEED = 0xc0ffee;
const rng = mulberry32(FUZZ_SEED);

function frand(min: number, max: number): number {
  return min + rng() * (max - min);
}
function irand(min: number, max: number): number {
  return Math.floor(frand(min, max + 1));
}
function pick<T>(arr: readonly T[]): T {
  return arr[irand(0, arr.length - 1)];
}
function hasNonFinite(pts: Pt[]): boolean {
  return pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]));
}

// ─── Generadores de anillos patológicos ────────────────────────────────

function baseConvexPolygon(n: number, cx: number, cy: number, r: number): Pt[] {
  const angles: number[] = [];
  for (let i = 0; i < n; i++) angles.push(frand(0, Math.PI * 2));
  angles.sort((a, b) => a - b);
  return angles.map((a) => {
    const rr = r * frand(0.6, 1.0);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as Pt;
  });
}

function starPolygon(n: number, cx: number, cy: number, rOuter: number, rInner: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n;
    const r = i % 2 === 0 ? rOuter : rInner;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function sliverPolygon(cx: number, cy: number, length: number): Pt[] {
  const eps = frand(1e-4, 1e-2);
  return [
    [cx, cy],
    [cx + length, cy],
    [cx + length, cy + eps],
    [cx, cy + eps],
  ];
}

function bowtiePolygon(cx: number, cy: number, r: number): Pt[] {
  return [
    [cx - r, cy - r],
    [cx + r, cy + r],
    [cx + r, cy - r],
    [cx - r, cy + r],
  ];
}

function withDuplicateVertex(ring: Pt[]): Pt[] {
  if (ring.length === 0) return ring;
  const idx = irand(0, ring.length - 1);
  const out = ring.slice();
  out.splice(idx, 0, [ring[idx][0], ring[idx][1]]);
  return out;
}

function withCollinearInsert(ring: Pt[]): Pt[] {
  if (ring.length < 2) return ring;
  const i = irand(0, ring.length - 1);
  const a = ring[i];
  const b = ring[(i + 1) % ring.length];
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const out = ring.slice();
  out.splice(i + 1, 0, mid);
  return out;
}

function withNonFiniteVertex(ring: Pt[]): Pt[] {
  if (ring.length === 0) return ring;
  const idx = irand(0, ring.length - 1);
  const bad = pick([NaN, Infinity, -Infinity] as const);
  const out = ring.map((p) => [p[0], p[1]] as Pt);
  if (rng() < 0.5) out[idx] = [bad, out[idx][1]];
  else out[idx] = [out[idx][0], bad];
  return out;
}

function withHugeCoordinates(ring: Pt[]): Pt[] {
  const scale = frand(1e5, 1e8);
  return ring.map(([x, y]) => [x * scale, y * scale] as Pt);
}

interface DegenerateCase {
  name: string;
  ring: Pt[];
}

const DEGRADATIONS: Array<{ label: string; fn: (r: Pt[]) => Pt[] }> = [
  { label: 'plain', fn: (r) => r },
  { label: 'dup', fn: withDuplicateVertex },
  { label: 'collinear', fn: withCollinearInsert },
  { label: 'dup+collinear', fn: (r) => withCollinearInsert(withDuplicateVertex(r)) },
  { label: 'nonfinite', fn: withNonFiniteVertex },
  { label: 'huge', fn: withHugeCoordinates },
];

function buildDegenerateCorpus(count: number): DegenerateCase[] {
  const cases: DegenerateCase[] = [];
  for (let i = 0; i < count; i++) {
    const cx = frand(-500, 500);
    const cy = frand(-500, 500);
    const shapeKind = pick(['convex', 'star', 'sliver', 'bowtie'] as const);
    let base: Pt[];
    switch (shapeKind) {
      case 'convex':
        base = baseConvexPolygon(irand(3, 9), cx, cy, frand(5, 200));
        break;
      case 'star':
        base = starPolygon(irand(3, 7), cx, cy, frand(20, 200), frand(2, 15));
        break;
      case 'sliver':
        base = sliverPolygon(cx, cy, frand(5, 300));
        break;
      case 'bowtie':
        base = bowtiePolygon(cx, cy, frand(10, 100));
        break;
    }
    const degrade = pick(DEGRADATIONS);
    cases.push({ name: `${shapeKind}#${i}_${degrade.label}`, ring: degrade.fn(base) });
  }
  return cases;
}

const DEGENERATE_CORPUS = buildDegenerateCorpus(60);

// ─── sanitizeRing / sanitizeRings ───────────────────────────────────────

describe('fuzz: sanitizeRing nunca lanza y siempre devuelve geometría válida o null', () => {
  it.each(DEGENERATE_CORPUS)('$name', ({ ring }) => {
    let result: Pt[] | null = null;
    expect(() => {
      result = sanitizeRing(ring, { context: 'fuzz.sanitizeRing' });
    }).not.toThrow();

    if (result) {
      const r = result as Pt[];
      expect(r.length).toBeGreaterThanOrEqual(4);
      expect(hasNonFinite(r)).toBe(false);
      const first = r[0], last = r[r.length - 1];
      expect(first[0]).toBeCloseTo(last[0], 6);
      expect(first[1]).toBeCloseTo(last[1], 6);
      expect(polyArea(r)).toBeGreaterThan(0);
    }
  });

  it('sanitizeRings descarta inválidos sin perder los válidos ni lanzar', () => {
    const rings = DEGENERATE_CORPUS.map((c) => c.ring);
    let out: Pt[][] = [];
    expect(() => {
      out = sanitizeRings(rings, { context: 'fuzz.sanitizeRings' });
    }).not.toThrow();
    for (const r of out) {
      expect(hasNonFinite(r)).toBe(false);
      expect(polyArea(r)).toBeGreaterThan(0);
    }
  });
});

// ─── subdivideManzano (auto / exact / modo2) ────────────────────────────

const SUBDIVISION_METHODS: ManzanoLoteMethod[] = ['auto', 'exact', 'modo2'];

describe('fuzz: subdivideManzano nunca lanza ni produce lotes con geometría inválida', () => {
  const candidates = DEGENERATE_CORPUS.filter((c) => {
    const cleaned = sanitizeRing(c.ring, { context: 'fuzz.subdivideManzano.precheck' });
    return cleaned != null && polyArea(cleaned) > 50;
  });

  for (const method of SUBDIVISION_METHODS) {
    it.each(candidates)(`${method}: $name`, ({ ring }) => {
      const targetAreaM2 = frand(20, 400);
      const frontMinM = frand(4, 20);
      const dirPref = rng() < 0.5 ? { ax: frand(-1, 1), ay: frand(-1, 1) } : undefined;

      let lots: LotResult[] = [];
      expect(() => {
        lots = subdivideManzano(ring, method, targetAreaM2, frontMinM, dirPref);
      }).not.toThrow();

      expect(lots.length).toBeLessThan(2000); // guardia de explosión combinatoria
      for (const lot of lots) {
        expect(hasNonFinite(lot.pts)).toBe(false);
        expect(Number.isFinite(lot.areaM2)).toBe(true);
        expect(lot.areaM2).toBeGreaterThan(0);
        expect(lot.frontM).toBeGreaterThanOrEqual(0);
        expect(lot.depthM).toBeGreaterThanOrEqual(0);
      }
    });
  }
});

// ─── computeRoadNetworkNet (unión + fillets de red vial) ────────────────

function randomStreet(id: string, bbox: number): Street {
  return {
    id,
    start: [frand(-bbox, bbox), frand(-bbox, bbox)],
    end: [frand(-bbox, bbox), frand(-bbox, bbox)],
    widthM: frand(0.5, 25),
    sideWidthM: frand(0, 8),
    name: id,
    waypoints: rng() < 0.3 ? [[frand(-bbox, bbox), frand(-bbox, bbox)]] : undefined,
  };
}

describe('fuzz: computeRoadNetworkNet nunca lanza con redes viales patológicas', () => {
  const CORNER_MODES: CornerMode[] = ['fillet', 'chamfer', 'none'];

  for (let i = 0; i < 25; i++) {
    const streetCount = irand(2, 8);
    const streets: Street[] = [];
    for (let s = 0; s < streetCount; s++) streets.push(randomStreet(`fuzz-street-${i}-${s}`, 120));
    if (rng() < 0.4) {
      streets.push({ ...streets[0], id: `fuzz-dup-${i}` });
    }
    if (rng() < 0.3) {
      const degenerate = randomStreet(`fuzz-degenerate-${i}`, 120);
      degenerate.end = [degenerate.start[0], degenerate.start[1]];
      streets.push(degenerate);
    }
    const cornerMode = pick(CORNER_MODES);

    it(`red vial fuzz #${i} (${streetCount} calles, corner=${cornerMode})`, () => {
      let net: RoadNetworkNet | null = null;
      expect(() => {
        net = computeRoadNetworkNet(streets, [], cornerMode);
      }).not.toThrow();

      const n = net!;
      for (const polys of [n.road, n.outer]) {
        for (const rings of polys) {
          for (const ring of rings) {
            expect(hasNonFinite(ring)).toBe(false);
          }
        }
      }
    });
  }
});

// ─── matchFragmentsToMembers ────────────────────────────────────────────

interface FragAssignment {
  fragmentIdx: number;
  member: number | null;
  overlapArea: number;
}

describe('fuzz: matchFragmentsToMembers nunca lanza y respeta asignación 1:1', () => {
  for (let i = 0; i < 25; i++) {
    const fragCount = irand(1, 5);
    const memberCount = irand(1, 5);
    const fragments: Pt[][] = [];
    for (let f = 0; f < fragCount; f++) {
      fragments.push(baseConvexPolygon(irand(3, 6), frand(-100, 100), frand(-100, 100), frand(5, 40)));
    }
    const members: Array<{ ring: Pt[]; ref: number }> = [];
    for (let m = 0; m < memberCount; m++) {
      members.push({
        ring: baseConvexPolygon(irand(3, 6), frand(-100, 100), frand(-100, 100), frand(5, 40)),
        ref: m,
      });
    }

    it(`reconciliación fuzz #${i} (${fragCount} frag × ${memberCount} miembros)`, () => {
      let assignments: FragAssignment[] = [];
      expect(() => {
        assignments = matchFragmentsToMembers<number>(fragments, members);
      }).not.toThrow();

      expect(assignments.length).toBe(fragments.length);
      const seenFragIdx = new Set<number>();
      const seenMemberRefs = new Set<number>();
      for (const a of assignments) {
        expect(seenFragIdx.has(a.fragmentIdx)).toBe(false);
        seenFragIdx.add(a.fragmentIdx);
        expect(a.overlapArea).toBeGreaterThanOrEqual(0);
        if (a.member != null) {
          expect(seenMemberRefs.has(a.member)).toBe(false);
          seenMemberRefs.add(a.member);
        }
      }
    });
  }
});

// ─── computeManzanos (unión de red vial + diferencia por parcela) ──────

function closeRing(ring: Pt[]): Pt[] {
  const f = ring[0], l = ring[ring.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) return [...ring, [f[0], f[1]]];
  return ring;
}

describe('fuzz: computeManzanos nunca lanza y no genera más área de la que entra', () => {
  // Corpus acotado a propósito: OverlayOp.difference (JSTS) no tiene cota
  // propia de complejidad y es conocido por volverse patológicamente lento
  // — en la práctica, "no vuelve nunca"— con topología casi-degenerada:
  // dos calles que se cruzan casi en paralelo generan intersecciones-sliver
  // que rompen la robustez del noding de JTS. Como esto corre síncrono en
  // el hilo principal, un caso así NO se puede interrumpir por timeout de
  // Vitest (el timeout se chequea en el mismo event loop que queda
  // bloqueado) — la única defensa real es no generar esa topología.

  function angleBetweenDeg(a: Street, b: Street): number {
    const d1x = a.end[0] - a.start[0], d1y = a.end[1] - a.start[1];
    const d2x = b.end[0] - b.start[0], d2y = b.end[1] - b.start[1];
    const len1 = Math.hypot(d1x, d1y) || 1;
    const len2 = Math.hypot(d2x, d2y) || 1;
    const dot = (d1x / len1) * (d2x / len2) + (d1y / len1) * (d2y / len2);
    const rad = Math.acos(Math.max(-1, Math.min(1, dot)));
    const deg = (rad * 180) / Math.PI;
    return Math.min(deg, 180 - deg); // ángulo agudo entre las dos rectas
  }

  function safeRandomStreets(count: number, bbox: number, parcelSize: number, depth = 0): Street[] {
    const MAX_ATTEMPTS = 20;
    // Ancho acotado a una fracción del tamaño de la parcela — evita calles
    // "más anchas que la parcela", que es el otro disparador conocido.
    const maxWidth = Math.max(1, Math.min(6, parcelSize * 0.08));

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const streets: Street[] = [];
      for (let s = 0; s < count; s++) {
        const street = randomStreet(`cm-fuzz-street-${depth}-${attempt}-${s}`, bbox);
        street.widthM = frand(0.5, maxWidth);
        street.sideWidthM = frand(0, maxWidth * 0.3);
        street.waypoints = undefined; // menos aristas = menos riesgo de robustez en JTS
        streets.push(street);
      }
      if (streets.length < 2) return streets;
      // El caso "casi paralelas" es el que más dispara problemas de
      // robustez al unir/recortar. Si el ángulo es muy chico, reintentamos.
      if (angleBetweenDeg(streets[0], streets[1]) >= 15) return streets;
    }
    // Si en MAX_ATTEMPTS no logramos un ángulo seguro, degradamos a una
    // sola calle — preferible a arriesgar un cuelgue del test.
    return safeRandomStreets(1, bbox, parcelSize, depth + 1);
  }

  for (let i = 0; i < 8; i++) {
    const parcelRing = baseConvexPolygon(irand(4, 7), 0, 0, frand(40, 120));
    const parcelArea = polyArea(parcelRing);
    const parcelSize = Math.sqrt(parcelArea);

    const streetCount = irand(1, 2);
    const streets = safeRandomStreets(streetCount, 80, parcelSize);
    const roadRings = buildRoadNetworkRings(streets, []);

    const parcelsFC: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closeRing(parcelRing)] },
      }] as never[],
    };
    const roadNetworkFC: FeatureCollection = {
      type: 'FeatureCollection',
      features: roadRings.map((ring) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closeRing(ring)] },
      })) as never[],
    };

    it(`computeManzanos fuzz #${i} (parcela ${parcelArea.toFixed(0)}m², ${streets.length} calles)`, () => {
      let result: FeatureCollection | null = null;
      expect(() => {
        result = computeManzanos(parcelsFC, roadNetworkFC);
      }).not.toThrow();

      let totalArea = 0;
      for (const f of result!.features) {
        if (f.geometry?.type !== 'Polygon') continue;
        const ring = f.geometry.coordinates[0] as Pt[];
        expect(hasNonFinite(ring)).toBe(false);
        totalArea += polyArea(ring);
      }
      expect(totalArea).toBeLessThanOrEqual(parcelArea * 1.01 + 1);
    });
  }
});