import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FeatureCollection } from 'geojson';
import { polyArea, type Pt } from '@/geo/math/polygonEngine';
import { computeManzanos } from '@/workers/geoOperations';
import { COMPUTE_MANZANOS_PARITY_FIXTURES, type ComputeManzanosParityFixture } from '../computeManzanosParityFixtures';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOT_PATH = join(__dirname, '..', 'computeManzanosParitySnapshot.json');

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

describe('paridad snapshot generator (computeManzanos)', () => {
  it('writes computeManzanosParitySnapshot.json', () => {
    const snap = {
      version: 1,
      generatedAt: new Date().toISOString(),
      fixtures: COMPUTE_MANZANOS_PARITY_FIXTURES.map((fx) => ({ name: fx.name, summary: summarize(fx) })),
    };
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snap, null, 2) + '\n');
  });
});