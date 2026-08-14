import { describe, it, expect, beforeEach } from 'vitest';
import { useStreetStore, type Street } from '@vias-engine/store/streetStore';
import { useRoundaboutStore, type Roundabout } from '@vias-engine/store/roundaboutStore';
import { useEntityLabelStore } from '@label-engine/store/entityLabelStore';
import { eraseInterceptors, isEraseIntercepted } from '@drawing-engine/extension-points';

const eraseStreetInterceptor = (kind: string, id: string) => {
  if (kind !== 'calle') return false;
  const s = useStreetStore.getState().streets.find((x) => x.id === id);
  if (!s) return false;
  useStreetStore.getState().removeStreet(id);
  useEntityLabelStore.getState().remove(id);
  return true;
};

const eraseRoundaboutInterceptor = (kind: string, id: string) => {
  if (kind !== 'rotonda') return false;
  const rb = useRoundaboutStore.getState().roundabouts.find((r) => r.id === id);
  if (!rb) return false;
  useRoundaboutStore.getState().removeRoundabout(id);
  useEntityLabelStore.getState().remove(id);
  return true;
};

beforeEach(() => {
  useStreetStore.setState({ streets: [] });
  useRoundaboutStore.setState({ roundabouts: [] });
  useEntityLabelStore.setState({ byId: {} });
  eraseInterceptors.unregister('test:street');
  eraseInterceptors.unregister('test:roundabout');
  eraseInterceptors.register('test:street', () => eraseStreetInterceptor);
  eraseInterceptors.register('test:roundabout', () => eraseRoundaboutInterceptor);
});

describe('eraseInterceptors B4', () => {
  it('removes street and its entityLabel entry', () => {
    const street: Street = {
      id: 's-1',
      start: [0, 0],
      end: [10, 0],
      widthM: 8,
      sideWidthM: 0,
      name: 'Calle 1',
    };
    useStreetStore.getState().addStreetWithId('s-1', street);
    useEntityLabelStore.getState().set('s-1', { config: { enabled: true } as never, text: 'C1' });

    expect(isEraseIntercepted('calle', 's-1')).toBe(true);
    expect(useStreetStore.getState().streets.find((s) => s.id === 's-1')).toBeUndefined();
    expect(useEntityLabelStore.getState().byId['s-1']).toBeUndefined();
  });

  it('removes roundabout and its entityLabel entry', () => {
    const rb: Roundabout = {
      id: 'r-1',
      center: [0, 0],
      radiusM: 10,
      sides: 0,
      rotation: 0,
      roadWidthM: 8,
      sidewalkWidthM: 0,
      name: 'Rotonda 1',
    };
    useRoundaboutStore.getState().addRoundaboutWithId('r-1', rb);
    useEntityLabelStore.getState().set('r-1', { config: { enabled: true } as never, text: 'R1' });

    expect(isEraseIntercepted('rotonda', 'r-1')).toBe(true);
    expect(useRoundaboutStore.getState().roundabouts.find((r) => r.id === 'r-1')).toBeUndefined();
    expect(useEntityLabelStore.getState().byId['r-1']).toBeUndefined();
  });

  it('ignores other kinds', () => {
    expect(isEraseIntercepted('lote', 'x-1')).toBe(false);
  });
});
