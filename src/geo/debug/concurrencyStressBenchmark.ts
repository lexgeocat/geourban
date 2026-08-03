import { Mulberry32 } from './syntheticUrbanLayout';
import {
  subdivideManzanoBatchInWorker,
  computeRoadNetworkNetInWorker,
  matchFragmentsBatchInWorker,
} from '../../workers/geoWorkerClient';
import type { ManzanoLoteMethod } from '../subdivision/types';
import type { Street } from '../../store/entities/streetStore';
import type { RoundaboutParams } from '../roundabout/roundaboutEngine';
import type { CornerMode } from '../roads/ringFillet';

export function buildIrregularManzanoRings(
  count: number,
  seed = 0x6a1d,
  baseW = 80,
  baseH = 60,
): Array<Array<[number, number]>> {
  const rng = new Mulberry32(seed);
  const rings: Array<Array<[number, number]>> = [];
  const maxR = Math.max(baseW, baseH) / 2;
  for (let i = 0; i < count; i++) {
    const n = rng.int(5, 9);
    const cx = rng.range(-baseW * 0.3, baseW * 0.3);
    const cy = rng.range(-baseH * 0.3, baseH * 0.3);
    const angles: number[] = [];
    for (let k = 0; k < n; k++) angles.push(rng.range(0, Math.PI * 2));
    angles.sort((a, b) => a - b);
    const pts: Array<[number, number]> = angles.map((a) => {
      const r = rng.range(0.45, 1.0) * maxR;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
    pts.push([pts[0][0], pts[0][1]]);
    rings.push(pts);
  }
  return rings;
}


function buildSyntheticRoadNetwork(): { streets: Street[]; roundabouts: RoundaboutParams[] } {
  const streets: Street[] = [
    { id: 'st-c1', start: [0, 60], end: [480, 60], widthM: 10, sideWidthM: 2, name: 'Calle 1' },
    { id: 'st-c2', start: [0, 180], end: [480, 180], widthM: 8, sideWidthM: 2, name: 'Calle 2' },
    { id: 'st-c3', start: [120, 0], end: [120, 240], widthM: 9, sideWidthM: 2, name: 'Calle 3' },
    { id: 'st-c4', start: [320, 0], end: [320, 240], widthM: 12, sideWidthM: 2, name: 'Calle 4' },
    { id: 'st-av', start: [0, 0], end: [480, 240], widthM: 20, sideWidthM: 3, name: 'Avenida' },
  ];
  const roundabouts: RoundaboutParams[] = [
    {
      center: [120, 180],
      radiusM: 12,
      sides: 0,
      rotation: 0,
      roadWidthM: 8,
      sidewalkWidthM: 2,
    },
    {
      center: [320, 60],
      radiusM: 14,
      sides: 6,
      rotation: Math.PI / 6,
      roadWidthM: 8,
      sidewalkWidthM: 2,
    },
  ];
  return { streets, roundabouts };
}

function buildMatchItems(rings: Array<Array<[number, number]>>) {
  return rings.slice(0, 12).map((ring, i) => {
    const n = ring.length - 1;
    const a = ring[Math.floor(n * 0.1)];
    const b = ring[Math.floor(n * 0.4)];
    const c = ring[Math.floor(n * 0.7)];
    const d = ring[Math.floor(n * 0.95)];
    const mid = (p: [number, number], q: [number, number]): [number, number] => [
      (p[0] + q[0]) / 2,
      (p[1] + q[1]) / 2,
    ];
    return {
      groupIdx: i,
      fragments: [
        [a, mid(a, b), b, a],
        [b, mid(b, c), c, b],
        [c, mid(c, d), d, c],
      ],
      memberRings: [[a, b, c, d, a]],
    };
  });
}

export interface StallSample {
  maxGapMs: number;
  avgGapMs: number;
  frames: number;
}

export function sampleEventLoopStall(sampleMs: number): Promise<StallSample> {
  const raf =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame.bind(globalThis)
      : (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  return new Promise((resolve) => {
    let maxGap = 0;
    let totalGap = 0;
    let frames = 0;
    let last = performance.now();
    const start = last;
    const tick = (now: number) => {
      const gap = now - last;
      last = now;
      totalGap += gap;
      frames++;
      if (gap > maxGap) maxGap = gap;
      if (now - start < sampleMs) {
        raf(tick);
      } else {
        resolve({ maxGapMs: maxGap, avgGapMs: frames > 0 ? totalGap / frames : 0, frames });
      }
    };
    raf(tick);
  });
}

export interface StressPhase {
  phase: string;
  elapsedMs: number;
  callCount: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
}

const CHUNK = 8;
const METHOD: ManzanoLoteMethod = 'auto';
const CORNER_MODE: CornerMode = 'fillet';

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function runSerialSubdivide(
  rings: Array<Array<[number, number]>>,
): Promise<{ phase: StressPhase; lots: number; degenerate: number }> {
  const chunks = chunked(rings, CHUNK);
  const perCall: number[] = [];
  let lots = 0;
  let degenerate = 0;
  const t0 = performance.now();
  for (const chunk of chunks) {
    const c0 = performance.now();
    const results = await subdivideManzanoBatchInWorker(
      chunk.map((ring, i) => ({
        id: `serial-${i}`,
        ring,
        method: METHOD,
        targetAreaM2: 250,
        frontMinM: 12,
      })),
    );
    perCall.push(performance.now() - c0);
    for (const r of results) {
      for (const lot of r.lots) {
        lots++;
        const finite =
          Number.isFinite(lot.areaM2) &&
          lot.areaM2 > 0 &&
          lot.pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (!finite) degenerate++;
      }
    }
  }
  return {
    phase: {
      phase: 'subdivide serial',
      elapsedMs: performance.now() - t0,
      callCount: perCall.length,
      totalMs: perCall.reduce((a, b) => a + b, 0),
      avgMs: perCall.length > 0 ? perCall.reduce((a, b) => a + b, 0) / perCall.length : 0,
      maxMs: perCall.length > 0 ? Math.max(...perCall) : 0,
    },
    lots,
    degenerate,
  };
}

async function runParallelSubdivide(
  rings: Array<Array<[number, number]>>,
  phaseName: string,
): Promise<{ phase: StressPhase; lots: number; degenerate: number }> {
  const chunks = chunked(rings, CHUNK);
  const t0 = performance.now();
  const perCall = await Promise.all(
    chunks.map((chunk, i) => {
      const c0 = performance.now();
      return subdivideManzanoBatchInWorker(
        chunk.map((ring, j) => ({
          id: `parallel-${i}-${j}`,
          ring,
          method: METHOD,
          targetAreaM2: 250,
          frontMinM: 12,
        })),
      ).then((results) => ({ ms: performance.now() - c0, results }));
    }),
  );
  let lots = 0;
  let degenerate = 0;
  for (const { results } of perCall) {
    for (const r of results) {
      for (const lot of r.lots) {
        lots++;
        const finite =
          Number.isFinite(lot.areaM2) &&
          lot.areaM2 > 0 &&
          lot.pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (!finite) degenerate++;
      }
    }
  }
  return {
    phase: {
      phase: phaseName,
      elapsedMs: performance.now() - t0,
      callCount: perCall.length,
      totalMs: perCall.reduce((a, b) => a + b.ms, 0),
      avgMs: perCall.length > 0 ? perCall.reduce((a, b) => a + b.ms, 0) / perCall.length : 0,
      maxMs: perCall.length > 0 ? Math.max(...perCall.map((p) => p.ms)) : 0,
    },
    lots,
    degenerate,
  };
}

async function runMixedPhase(rings: Array<Array<[number, number]>>): Promise<StressPhase> {
  const { streets, roundabouts } = buildSyntheticRoadNetwork();
  const chunks = chunked(rings, CHUNK);
  const matchItems = buildMatchItems(rings);
  const t0 = performance.now();
  await Promise.all([
    subdivideManzanoBatchInWorker(
      chunks[0]?.map((ring, i) => ({
        id: `mixed-sub-${i}`,
        ring,
        method: METHOD,
        targetAreaM2: 250,
        frontMinM: 12,
      })) ?? [],
    ),
    subdivideManzanoBatchInWorker(
      chunks[1]?.map((ring, i) => ({
        id: `mixed-sub2-${i}`,
        ring,
        method: METHOD,
        targetAreaM2: 250,
        frontMinM: 12,
      })) ?? [],
    ),
    computeRoadNetworkNetInWorker(streets, roundabouts, CORNER_MODE),
    matchFragmentsBatchInWorker(matchItems),
  ]);
  return {
    phase: 'mixta (subdivisión ∥ red vial ∥ fragmentos)',
    elapsedMs: performance.now() - t0,
    callCount: 4,
    totalMs: performance.now() - t0,
    avgMs: performance.now() - t0,
    maxMs: performance.now() - t0,
  };
}
export interface ConcurrencyStressOptions {
  ringCount?: number;
  seed?: number;
  idleSampleMs?: number;
}

export interface ConcurrencyStressResult {
  ringCount: number;
  phases: StressPhase[];
  serialElapsedMs: number;
  parallelElapsedMs: number;
  parallelSpeedup: number;
  idleStallMaxMs: number;
  parallelStallMaxMs: number;
  stallDegradationRatio: number;
  lotTotal: number;
  degenerateLots: number;
  elapsedMs: number;
}

export async function runConcurrencyStressBenchmark(
  opts: ConcurrencyStressOptions = {},
): Promise<ConcurrencyStressResult> {
  const ringCount = opts.ringCount ?? 64;
  const idleSampleMs = opts.idleSampleMs ?? 600;
  const t0 = performance.now();

  const rings = buildIrregularManzanoRings(ringCount, opts.seed);

  const idle = await sampleEventLoopStall(idleSampleMs);

  const serial = await runSerialSubdivide(rings);

  const parallelPromise = runParallelSubdivide(rings, 'subdivide paralelo');
  const stallSample = await sampleEventLoopStall(800);
  const parallel = await parallelPromise;

  const mixed = await runMixedPhase(rings);

  const phases: StressPhase[] = [serial.phase, parallel.phase, mixed];
  const serialElapsedMs = serial.phase.elapsedMs;
  const parallelElapsedMs = parallel.phase.elapsedMs;

  return {
    ringCount,
    phases,
    serialElapsedMs,
    parallelElapsedMs,
    parallelSpeedup: parallelElapsedMs > 0 ? serialElapsedMs / parallelElapsedMs : 0,
    idleStallMaxMs: idle.maxGapMs,
    parallelStallMaxMs: stallSample.maxGapMs,
    stallDegradationRatio: idle.maxGapMs > 0 ? stallSample.maxGapMs / idle.maxGapMs : 0,
    lotTotal: parallel.lots,
    degenerateLots: parallel.degenerate + serial.degenerate,
    elapsedMs: performance.now() - t0,
  };
}

export async function runConcurrencyStressSuite(
  scales: ConcurrencyStressOptions[] = [
    { ringCount: 32 },
    { ringCount: 64 },
    { ringCount: 128 },
  ],
): Promise<ConcurrencyStressResult[]> {
  const results: ConcurrencyStressResult[] = [];
  for (const scale of scales) results.push(await runConcurrencyStressBenchmark(scale));
  return results;
}
