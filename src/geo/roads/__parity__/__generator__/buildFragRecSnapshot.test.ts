// Genera `fragRecParitySnapshot.json` ejecutando el motor TS sobre las fixtures.
// Lo invoca `scripts/parity-sync.mjs` apuntando vitest a este archivo.
//
// NOTA: este archivo está intencionalmente excluido de `npm test` regular
// (ver `vitest.config.ts` → exclude). Solo corre cuando lo invoca el
// script de sincronización. Así vitest no lo carga en CI, pero el script
// puede correrlo sin que se dispare el reader de paridad.
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchFragmentsToMembers } from '@/geo/roads/fragmentReconciliation';
import { FRAG_REC_PARITY_FIXTURES } from '../fragmentReconciliationParityFixtures';
import type { Pt } from '@/geo/math/polygonEngine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_PATH = join(__dirname, '..', 'fragRecParitySnapshot.json');

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

function summarize(
  fragments: Pt[][],
  memberRings: Pt[][],
): AssignmentSummary[] {
  // Wrap member rings with a dummy ref (index) so we can use the generic API.
  const members = memberRings.map((ring, i) => ({ ring, ref: i }));
  const assignments = matchFragmentsToMembers<number>(fragments, members);
  return assignments.map((a) => ({
    fragmentIdx: a.fragmentIdx,
    memberIdx: a.member,
    overlapArea: a.overlapArea,
  }));
}

describe('fragment reconciliation parity snapshot generator', () => {
  it('writes fragRecParitySnapshot.json', () => {
    const snap = {
      version: 1,
      generatedAt: new Date().toISOString(),
      fixtures: FRAG_REC_PARITY_FIXTURES.map((fx): FixtureSummary => {
        const assignments = summarize(fx.fragments, fx.memberRings);
        return {
          name: fx.name,
          fragmentCount: fx.fragments.length,
          memberCount: fx.memberRings.length,
          assignments,
        };
      }),
    };
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n');
  });
});
