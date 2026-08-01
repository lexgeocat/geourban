import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FeatureCollection } from 'geojson';
import { polyArea, type Pt } from '@/geo/math/polygonEngine';
import { computeManzanos } from '@/workers/geoOperations';
import { COMPUTE_MANZANOS_PARITY_FIXTURES, type ComputeManzanosParityFixture } from './computeManzanosParityFixtures';

const AREA_TOL_M2 = 1e-2;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_PATH = join(__dirname, 'computeManzanosParitySnapshot.json');

function closeRing(ring: Pt[]): Pt[] {
  const f = ring[0], l = ring[ring.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) return [...ring, [f[0], f[1]]];
  return ring;
}
function toFC(rings: Pt[][]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rings.map((ring) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [closeRing(ring)] },
    })) as never[],
  };
}

interface FixtureSummary { fragmentCount: number; totalArea: number; areasByParcel: number[][]; }
interface SnapshotFixture { name: string; summary: FixtureSummary; }
interface Snapshot { version: number; generatedAt: string; fixtures: SnapshotFixture[]; }

function loadSnapshotOrFail(): Snapshot {
  if (!existsSync(SNAPSHOT_PATH)) {
    throw new Error(`Snapshot ausente en ${SNAPSHOT_PATH}.\nCorre \`npm run parity:sync\` y volve a correr \`npm test\`.`);
  }
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as Snapshot;
}

function summarize(fx: ComputeManzanosParityFixture): FixtureSummary {
  const result = computeManzanos(toFC(fx.parcelRings), toFC(fx.roadRings));
  const areasByParcel: number[][] = fx.parcelRings.map(() => []);
  let totalArea = 0;
  for (const f of result.features) {
    if (f.geometry?.type !== 'Polygon') continue;
    const ring = f.geometry.coordinates[0] as Pt[];
    const area = polyArea(ring);
    totalArea += area;
    const idx = (f.properties as { origParcelIndex?: number } | null)?.origParcelIndex ?? 0;
    areasByParcel[idx].push(area);
  }
  for (const arr of areasByParcel) arr.sort((a, b) => a - b);
  return { fragmentCount: result.features.length, totalArea, areasByParcel };
}

function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

describe('paridad computeManzanos (TS/JSTS vs snapshot)', () => {
  let snapshot: Snapshot;
  beforeAll(() => { snapshot = loadSnapshotOrFail(); });

  for (let i = 0; i < COMPUTE_MANZANOS_PARITY_FIXTURES.length; i++) {
    const fx = COMPUTE_MANZANOS_PARITY_FIXTURES[i];
    const expectedAt = i;
    it(`match con snapshot para ${fx.name}`, () => {
      const expected = snapshot.fixtures[expectedAt];
      expect(expected, `snapshot no tiene fixture #${expectedAt}`).toBeDefined();
      const actual = summarize(fx);
      expect(actual.fragmentCount).toBe(expected.summary.fragmentCount);
      expect(approx(actual.totalArea, expected.summary.totalArea, AREA_TOL_M2)).toBe(true);
      expect(actual.areasByParcel.length).toBe(expected.summary.areasByParcel.length);
      for (let p = 0; p < actual.areasByParcel.length; p++) {
        expect(actual.areasByParcel[p].length).toBe(expected.summary.areasByParcel[p].length);
        for (let k = 0; k < actual.areasByParcel[p].length; k++) {
          expect(approx(actual.areasByParcel[p][k], expected.summary.areasByParcel[p][k], AREA_TOL_M2)).toBe(true);
        }
      }
    });
  }
});