import { describe, it, expect } from 'vitest';
import {
  resolveVisibleLabels,
  type LabelCandidate,
} from '@label-engine/engine/LabelEngineService';
import { defaultLabelStyleConfig } from '@label-engine/model/labelModel';

function candidate(id: string, x: number, y: number, w = 60, h = 18): LabelCandidate {
  return {
    id,
    kind: 'feature',
    layerZIndex: 0,
    classPriority: 0,
    anchorPx: [x, y],
    widthPx: w,
    heightPx: h,
    style: defaultLabelStyleConfig({ enabled: true }),
    text: id,
    category: 'polygon',
  };
}

describe('LabelEngineService perf smoke', () => {
  it('resolves 50k candidates in under 3s (synthetic 50k lots)', () => {
    const n = 50_000;
    const candidates: LabelCandidate[] = [];
    for (let i = 0; i < n; i++) {
      const x = (i % 300) * 80;
      const y = Math.floor(i / 300) * 80;
      candidates.push(candidate(`feat:${i}`, x, y));
    }
    const t0 = performance.now();
    const result = resolveVisibleLabels(candidates, { zoom: 14, resolution: 1 });
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(3000);
    expect(result.placed.length + result.dropped.length).toBe(n);
  });
});
