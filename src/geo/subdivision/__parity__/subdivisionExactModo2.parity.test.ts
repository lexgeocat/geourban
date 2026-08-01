import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { subdivideManzanoExact, subdivideManzanoAuto } from '@/geo/subdivision/subdivisionAlgorithms';
import { EXACT_MODO2_PARITY_FIXTURES } from './parityFixturesExactModo2';
import { polyArea, type Pt } from '@/geo/math/polygonEngine';

const AREA_TOL_M2 = 1e-3;
const LEN_TOL_M = 1e-3;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_PATH = join(__dirname, 'paritySnapshotExactModo2.json');

interface LotSummary {
  count: number; totalArea: number; bboxArea: number; remnantCount: number;
  areas: number[]; frontMs: number[]; depthMs: number[]; ringArea: number;
}

function summarize(ring: Pt[], method: 'exact' | 'modo2', targetAreaM2: number, frontMinM: number, dirPref?: { ax: number; ay: number }): LotSummary {
  const fn = method === 'exact' ? subdivideManzanoExact : subdivideManzanoAuto;
  const lots = fn(ring, targetAreaM2, frontMinM, dirPref);
  let totalArea = 0, remnantCount = 0;
  const areas: number[] = [], frontMs: number[] = [], depthMs: number[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of lots) {
    totalArea += l.areaM2;
    if (l.isRemnant) remnantCount += 1;
    areas.push(l.areaM2);
    frontMs.push(l.frontM);
    depthMs.push(l.depthM);
    for (const p of l.pts) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }
  }
  const bboxArea = Number.isFinite(minX) ? (maxX - minX) * (maxY - minY) : 0;
  return { count: lots.length, totalArea, bboxArea, remnantCount, areas, frontMs, depthMs, ringArea: polyArea(ring) };
}

interface SnapshotFixture {
  name: string; method: 'exact' | 'modo2'; targetAreaM2: number; frontMinM: number;
  dirPref?: { ax: number; ay: number } | null; summary: LotSummary;
}
interface Snapshot { version: number; generatedAt: string; fixtures: SnapshotFixture[]; }

function loadSnapshotOrFail(): Snapshot {
  if (!existsSync(SNAPSHOT_PATH)) {
    throw new Error(`Snapshot ausente en ${SNAPSHOT_PATH}.\nCorre \`npm run parity:sync\` y volve a correr \`npm test\`.`);
  }
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as Snapshot;
}

function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

function compareSummary(actual: LotSummary, expected: LotSummary) {
  expect(actual.count).toBe(expected.count);
  expect(approx(actual.totalArea, expected.totalArea, AREA_TOL_M2)).toBe(true);
  expect(approx(actual.bboxArea, expected.bboxArea, AREA_TOL_M2)).toBe(true);
  expect(actual.remnantCount).toBe(expected.remnantCount);
  expect(actual.areas.length).toBe(expected.areas.length);
  for (let i = 0; i < actual.areas.length; i++) expect(approx(actual.areas[i], expected.areas[i], AREA_TOL_M2)).toBe(true);
  for (let i = 0; i < actual.frontMs.length; i++) expect(approx(actual.frontMs[i], expected.frontMs[i], LEN_TOL_M)).toBe(true);
  for (let i = 0; i < actual.depthMs.length; i++) expect(approx(actual.depthMs[i], expected.depthMs[i], LEN_TOL_M)).toBe(true);
  expect(actual.count).toBeGreaterThan(0);
  for (const a of actual.areas) expect(a).toBeGreaterThan(0);
}

describe('paridad subdivideManzanoExact/Auto (TS vs snapshot)', () => {
  let snapshot: Snapshot;
  beforeAll(() => { snapshot = loadSnapshotOrFail(); });

  for (let i = 0; i < EXACT_MODO2_PARITY_FIXTURES.length; i++) {
    const fx = EXACT_MODO2_PARITY_FIXTURES[i];
    const expectedAt = i;
    it(`match con snapshot para ${fx.name}`, () => {
      const expected = snapshot.fixtures[expectedAt];
      expect(expected, `snapshot no tiene fixture #${expectedAt}`).toBeDefined();
      expect(expected.method).toBe(fx.method);
      const actual = summarize(fx.ring as Pt[], fx.method, fx.targetAreaM2, fx.frontMinM, fx.dirPref);
      compareSummary(actual, expected.summary);
    });
  }
});