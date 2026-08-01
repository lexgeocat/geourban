// Genera paritySnapshotExactModo2.json. Invocado por scripts/parity-sync.mjs.
// Excluido de `npm test` regular (ver vitest.config.ts -> exclude).
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { polyArea, type Pt } from '@/geo/math/polygonEngine';
import { subdivideManzanoExact, subdivideManzanoAuto } from '@/geo/subdivision/subdivisionAlgorithms';
import { EXACT_MODO2_PARITY_FIXTURES, type ExactModo2ParityFixture } from '../parityFixturesExactModo2';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_PATH = join(__dirname, '..', 'paritySnapshotExactModo2.json');

interface LotSummary {
  count: number;
  totalArea: number;
  bboxArea: number;
  remnantCount: number;
  areas: number[];
  frontMs: number[];
  depthMs: number[];
  ringArea: number;
}

function summarize(fx: ExactModo2ParityFixture): LotSummary {
  const fn = fx.method === 'exact' ? subdivideManzanoExact : subdivideManzanoAuto;
  const lots = fn(fx.ring as Pt[], fx.targetAreaM2, fx.frontMinM, fx.dirPref);
  let totalArea = 0;
  let remnantCount = 0;
  const areas: number[] = [];
  const frontMs: number[] = [];
  const depthMs: number[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of lots) {
    totalArea += l.areaM2;
    if (l.isRemnant) remnantCount += 1;
    areas.push(l.areaM2);
    frontMs.push(l.frontM);
    depthMs.push(l.depthM);
    for (const p of l.pts) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  const bboxArea = Number.isFinite(minX) ? (maxX - minX) * (maxY - minY) : 0;
  return { count: lots.length, totalArea, bboxArea, remnantCount, areas, frontMs, depthMs, ringArea: polyArea(fx.ring as Pt[]) };
}

describe('paridad snapshot generator (exact/modo2)', () => {
  it('writes paritySnapshotExactModo2.json', () => {
    const snap = {
      version: 1,
      generatedAt: new Date().toISOString(),
      fixtures: EXACT_MODO2_PARITY_FIXTURES.map((fx) => ({
        name: fx.name,
        method: fx.method,
        targetAreaM2: fx.targetAreaM2,
        frontMinM: fx.frontMinM,
        dirPref: fx.dirPref ?? null,
        summary: summarize(fx),
      })),
    };
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n');
  });
});