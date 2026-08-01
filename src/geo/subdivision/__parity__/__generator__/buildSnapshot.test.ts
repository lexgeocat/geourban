// Genera `paritySnapshot.json` ejecutando el motor TS sobre las fixtures.
// Lo invoca `scripts/parity-sync.mjs` apuntando vitest a este archivo.
//
// NOTA: este archivo esta intencionalmente excluido de `npm test` regular
// (ver `vitest.config.ts` -> exclude). Solo corre cuando lo invoca el
// script de sincronizacion. Asi vitest no lo carga en CI, pero el script
// puede correrlo sin que se dispare el reader de paridad.
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { polyArea, type Pt } from '@/geo/math/polygonEngine';
import { subdivideManzanoCabeceraCuerpo } from '@/geo/subdivision/subdivisionCabeceraCuerpo';
import { PARITY_FIXTURES } from '../parityFixtures';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_PATH = join(__dirname, '..', 'paritySnapshot.json');

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

function summarize(ring: Pt[], targetAreaM2: number, frontMinM: number, dirPref?: { ax: number; ay: number }): LotSummary {
  const lots = subdivideManzanoCabeceraCuerpo(ring, targetAreaM2, frontMinM, dirPref);
  let totalArea = 0;
  let remnantCount = 0;
  const areas: number[] = [];
  const frontMs: number[] = [];
  const depthMs: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
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
  return {
    count: lots.length,
    totalArea,
    bboxArea,
    remnantCount,
    areas,
    frontMs,
    depthMs,
    ringArea: polyArea(ring),
  };
}

describe('paridad snapshot generator', () => {
  it('writes paritySnapshot.json', () => {
    const snap = {
      version: 1,
      generatedAt: new Date().toISOString(),
      fixtures: PARITY_FIXTURES.map((fx) => {
        const s = summarize(fx.ring as Pt[], fx.targetAreaM2, fx.frontMinM, fx.dirPref);
        return {
          name: fx.name,
          targetAreaM2: fx.targetAreaM2,
          frontMinM: fx.frontMinM,
          dirPref: fx.dirPref ?? null,
          summary: s,
        };
      }),
    };
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n');
  });
});
