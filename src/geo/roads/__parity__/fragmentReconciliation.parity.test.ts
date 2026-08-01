import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchFragmentsToMembers } from '@/geo/roads/fragmentReconciliation';
import { FRAG_REC_PARITY_FIXTURES } from './fragmentReconciliationParityFixtures';
import type { Pt } from '@/geo/math/polygonEngine';

const AREA_TOL_M2 = 1e-3;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_PATH = join(__dirname, 'fragRecParitySnapshot.json');

interface AssignmentSummary {
  fragmentIdx: number;
  memberIdx: number | null;
  overlapArea: number;
}

interface FixtureSummary {
  name: string;
  fragmentCount: number;
  memberCount: number;
  assignments: AssignmentSummary[];
}

interface Snapshot {
  version: number;
  generatedAt: string;
  fixtures: FixtureSummary[];
}

function loadSnapshotOrFail(): Snapshot {
  if (!existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      `Snapshot ausente en ${SNAPSHOT_PATH}.\n` +
        'Corré desde la raiz del repo:\n' +
        '    npm run parity:sync\n' +
        'y volvé a correr `npm test`.',
    );
  }
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as Snapshot;
}

function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

function runFixture(fragments: Pt[][], memberRings: Pt[][]): AssignmentSummary[] {
  const members = memberRings.map((ring, i) => ({ ring, ref: i }));
  const assignments = matchFragmentsToMembers<number>(fragments, members);
  return assignments.map((a) => ({
    fragmentIdx: a.fragmentIdx,
    memberIdx: a.member,
    overlapArea: a.overlapArea,
  }));
}

describe('paridad matchFragmentsToMembers (TS vs snapshot)', () => {
  let snapshot: Snapshot;

  beforeAll(() => {
    snapshot = loadSnapshotOrFail();
  });

  for (let i = 0; i < FRAG_REC_PARITY_FIXTURES.length; i++) {
    const fx = FRAG_REC_PARITY_FIXTURES[i];
    const expectedAt = i;
    it(`match con snapshot para ${fx.name}`, () => {
      const expected = snapshot.fixtures[expectedAt];
      expect(expected, `snapshot no tiene fixture #${expectedAt}`).toBeDefined();
      expect(expected.name).toBe(fx.name);

      const actual = runFixture(fx.fragments, fx.memberRings);

      // Mismo número de assignments.
      expect(actual.length).toBe(expected.assignments.length);

      // Comparar cada assignment (en el mismo orden — ambos motores
      // producen assignments greedy descendente por overlap, seguidos
      // de los unassigned en orden de fragmentIdx).
      for (let j = 0; j < actual.length; j++) {
        const a = actual[j];
        const e = expected.assignments[j];
        expect(a.fragmentIdx).toBe(e.fragmentIdx);
        expect(a.memberIdx).toBe(e.memberIdx);
        expect(
          approx(a.overlapArea, e.overlapArea, AREA_TOL_M2),
        ).toBe(true);
      }
    });
  }
});
