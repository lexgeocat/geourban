import { describe, it, expect, beforeEach } from 'vitest';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { useEntityLabelStore } from '@label-engine/store/entityLabelStore';
import { layerEntityAdapters, type LayerEntityAdapter } from '@layers-engine/extension-points';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Polygon from 'ol/geom/Polygon.js';

class FakeCommandContext {
  drawSource = new VectorSource<Feature<Polygon>>();
  getMap(): null {
    return null;
  }
}

const streetAdapter: LayerEntityAdapter = {
  kind: 'street',
  list: (layerId) =>
    useStreetStore
      .getState()
      .streets.filter((s) => s.layerId === layerId)
      .map((s) => ({ id: s.id, data: { ...s }, layerId: s.layerId })),
  count: (layerId) =>
    useStreetStore.getState().streets.filter((s) => s.layerId === layerId).length,
  reassign: (from, to) => {
    let n = 0;
    for (const s of useStreetStore.getState().streets) {
      if (s.layerId === from) {
        useStreetStore.getState().updateStreet(s.id, { layerId: to });
        n++;
      }
    }
    return n;
  },
  remove: (layerId) => {
    const state = useStreetStore.getState();
    const snaps = [];
    for (const s of [...state.streets]) {
      if (s.layerId !== layerId) continue;
      snaps.push({
        id: s.id,
        data: { ...s },
        layerId: s.layerId,
        label: useEntityLabelStore.getState().byId[s.id],
      });
      state.removeStreet(s.id);
      useEntityLabelStore.getState().remove(s.id);
    }
    return snaps;
  },
  removeById: (id) => {
    useStreetStore.getState().removeStreet(id);
    useEntityLabelStore.getState().remove(id);
  },
  restore: (snaps) => {
    const labelStore = useEntityLabelStore.getState();
    for (const s of snaps) {
      useStreetStore.getState().addStreetWithId(s.id, s.data as never);
      if (s.label) labelStore.set(s.id, s.label as never);
    }
  },
};

beforeEach(() => {
  useLayersStore.setState({ layers: [], index: new Map(), activeLayerId: null });
  useStreetStore.setState({ streets: [] });
  useRoundaboutStore.setState({ roundabouts: [] });
  useEntityLabelStore.setState({ byId: {} });
  layerEntityAdapters.unregister('test:street');
  layerEntityAdapters.register('test:street', streetAdapter);
});

describe('RemoveLayerCommand + layerEntityAdapters (B3)', () => {
  it('delete action removes streets of that layer', async () => {
    const { RemoveLayerCommand } = await import('@layers-engine/commands/RemoveLayerCommand');
    useLayersStore.getState().add({
      id: 'L1',
      name: 'Vías',
      kind: 'calle',
      color: '#fff',
      visible: true,
      locked: false,
      opacity: 1,
      showLabel: true,
      showCota: true,
    });
    useStreetStore.getState().addStreetWithId('s-1', {
      start: [0, 0],
      end: [10, 0],
      widthM: 8,
      sideWidthM: 0,
      layerId: 'L1',
    });
    useEntityLabelStore.getState().set('s-1', { config: { enabled: true } as never, text: 'x' });

    const ctx = new FakeCommandContext();
    const cmd = new RemoveLayerCommand({ layerId: 'L1', action: 'delete' });
    cmd.execute(ctx as never);

    expect(useStreetStore.getState().streets.find((s) => s.id === 's-1')).toBeUndefined();
    expect(useEntityLabelStore.getState().byId['s-1']).toBeUndefined();
    expect(useLayersStore.getState().getById('L1')).toBeUndefined();

    cmd.undo(ctx as never);
    expect(useStreetStore.getState().streets.find((s) => s.id === 's-1')).toBeDefined();
    expect(useEntityLabelStore.getState().byId['s-1']).toBeDefined();
    expect(useLayersStore.getState().getById('L1')).toBeDefined();
  });

  it('move action reassigns streets to target layer', async () => {
    const { RemoveLayerCommand } = await import('@layers-engine/commands/RemoveLayerCommand');
    useLayersStore.getState().add({
      id: 'L1', name: 'Vías', kind: 'calle', color: '#fff', visible: true, locked: false, opacity: 1, showLabel: true, showCota: true,
    });
    useLayersStore.getState().add({
      id: 'L2', name: 'Vías 2', kind: 'calle', color: '#fff', visible: true, locked: false, opacity: 1, showLabel: true, showCota: true,
    });
    useStreetStore.getState().addStreetWithId('s-1', {
      start: [0, 0], end: [10, 0], widthM: 8, sideWidthM: 0, layerId: 'L1',
    });

    const ctx = new FakeCommandContext();
    const cmd = new RemoveLayerCommand({ layerId: 'L1', action: 'move', targetLayerId: 'L2' });
    cmd.execute(ctx as never);

    expect(useStreetStore.getState().streets.find((s) => s.id === 's-1')?.layerId).toBe('L2');
    expect(useLayersStore.getState().getById('L1')).toBeUndefined();

    cmd.undo(ctx as never);
    expect(useStreetStore.getState().streets.find((s) => s.id === 's-1')?.layerId).toBe('L1');
  });
});
