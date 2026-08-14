import { describe, it, expect } from 'vitest';
import {
  resolveVisibleLabels,
  type LabelCandidate,
} from '@label-engine/engine/LabelEngineService';
import { defaultLabelStyleConfig } from '@label-engine/model/labelModel';

function candidate(
  id: string,
  x: number,
  y: number,
  w = 10,
  h = 10,
  extras: Partial<LabelCandidate> = {}
): LabelCandidate {
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
    ...extras,
  };
}

describe('resolveVisibleLabels', () => {
  it('places a single candidate', () => {
    const r = resolveVisibleLabels([candidate('a', 100, 100)], { zoom: 10, resolution: 1 });
    expect(r.placed).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
    expect(r.hiddenCount).toBe(0);
  });

  it('drops overlapping candidates by collision', () => {
    const c1 = candidate('a', 100, 100, 40, 40);
    const c2 = candidate('b', 110, 110, 40, 40);
    const r = resolveVisibleLabels([c1, c2], { zoom: 10, resolution: 1 });
    expect(r.placed).toHaveLength(1);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0].candidate.id).toBe('b');
    expect(r.dropped[0].reason).toBe('collision');
  });

  it('respects priority desc, then layerZIndex desc', () => {
    const low = candidate('low', 100, 100, 40, 40, { classPriority: 0, layerZIndex: 5 });
    const high = candidate('high', 105, 105, 40, 40, { classPriority: 10, layerZIndex: 0 });
    const r = resolveVisibleLabels([low, high], { zoom: 10, resolution: 1 });
    expect(r.placed[0].candidate.id).toBe('high');
  });

  it('drops by zoom range (visibleMinZoom/MaxZoom)', () => {
    const c = candidate('z', 100, 100, 10, 10, {
      style: { ...defaultLabelStyleConfig({ enabled: true }), visibleMinZoom: 12, visibleMaxZoom: 18 },
    });
    const r = resolveVisibleLabels([c], { zoom: 8, resolution: 1 });
    expect(r.placed).toHaveLength(0);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0].reason).toBe('zoom');
  });

  it('uses placementOffsets to displace a colliding candidate', () => {
    const c1 = candidate('a', 100, 100, 40, 40);
    const c2 = candidate('b', 100, 100, 40, 40, {
      placementOffsets: [
        [0, 0],
        [0, 60],
      ],
    });
    const r = resolveVisibleLabels([c1, c2], { zoom: 10, resolution: 1 });
    expect(r.placed).toHaveLength(2);
    expect(r.placed[1].positionPx[1]).toBe(160);
  });

  it('marks leaderFromPx when offset != 0', () => {
    const c1 = candidate('a', 100, 100, 40, 40);
    const c2 = candidate('b', 100, 100, 40, 40, {
      placementOffsets: [
        [0, 0],
        [0, 60],
      ],
      allowLeaderLine: true,
    });
    const r = resolveVisibleLabels([c1, c2], { zoom: 10, resolution: 1 });
    expect(r.placed[1].leaderFromPx).toEqual([100, 100]);
  });

  it('drops on noAnchor (NaN anchor)', () => {
    const c = candidate('nan', NaN, 0);
    const r = resolveVisibleLabels([c], { zoom: 10, resolution: 1 });
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0].reason).toBe('noAnchor');
  });
});
