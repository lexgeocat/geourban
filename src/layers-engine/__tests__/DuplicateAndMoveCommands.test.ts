import { describe, it, expect, beforeEach } from 'vitest';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useEntityLabelStore } from '@label-engine/store/entityLabelStore';
import { layerEntityAdapters, type LayerEntityAdapter } from '@layers-engine/extension-points';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';

class FakeCommandContext {
  drawSource = new VectorSource<Feature<Polygon | LineString>>();
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
      snaps.push({ id: s.id, data: { ...s }, layerId: s.layerId });
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
    for (const s of snaps) {
      useStreetStore.getState().addStreetWithId(s.id, s.data as never);
    }
  },
};

beforeEach(() => {
  useLayersStore.setState({ layers: [], index: new Map(), activeLayerId: null });
  useStreetStore.setState({ streets: [] });
  useEntityLabelStore.setState({ byId: {} });
  layerEntityAdapters.unregister('test:street2');
  layerEntityAdapters.register('test:street2', streetAdapter);
});

describe('DuplicateLayerCommand + layerEntityAdapters (F3)', () => {
  it('duplicates layer, streets and restores on undo', async () => {
    const { DuplicateLayerCommand } = await import('@layers-engine/commands/DuplicateLayerCommand');
    useLayersStore.getState().add({
      id: 'L1', name: 'Vías', kind: 'calle', color: '#fff', visible: true, locked: false, opacity: 1, showLabel: true, showCota: true,
    });
    useStreetStore.getState().addStreetWithId('s-1', {
      start: [0, 0], end: [10, 0], widthM: 8, sideWidthM: 0, layerId: 'L1',
    });
    useEntityLabelStore.getState().set('s-1', { config: { enabled: true } as never, text: 'C1' });

    const ctx = new FakeCommandContext();
    const cmd = new DuplicateLayerCommand({
      sourceLayerId: 'L1',
      newLayerId: 'L1-dup',
      newName: 'Vías dup',
      duplicateFeatures: true,
    });
    cmd.execute(ctx as never);

    expect(useLayersStore.getState().getById('L1-dup')).toBeDefined();
    const dupStreets = useStreetStore.getState().streets.filter((s) => s.layerId === 'L1-dup');
    expect(dupStreets).toHaveLength(1);
    expect(dupStreets[0].id).not.toBe('s-1');
    expect(useStreetStore.getState().streets).toHaveLength(2);

    cmd.undo(ctx as never);
    expect(useLayersStore.getState().getById('L1-dup')).toBeUndefined();
    expect(useStreetStore.getState().streets.filter((s) => s.layerId === 'L1-dup')).toHaveLength(0);
    expect(useStreetStore.getState().streets).toHaveLength(1);
  });
});

describe('MoveFeaturesToLayerCommand (F3)', () => {
  it('moves a feature between layers and restores on undo', async () => {
    const { MoveFeaturesToLayerCommand } = await import('@layers-engine/commands/MoveFeaturesToLayerCommand');
    const ctx = new FakeCommandContext();
    const f = new Feature<Polygon>({
      geometry: new Polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]),
    });
    f.setId('f-1');
    f.set('layerId', 'L1');
    ctx.drawSource.addFeature(f);

    const cmd = new MoveFeaturesToLayerCommand(['f-1'], 'L2');
    cmd.execute(ctx as never);
    expect(ctx.drawSource.getFeatureById('f-1')?.get('layerId')).toBe('L2');

    cmd.undo(ctx as never);
    expect(ctx.drawSource.getFeatureById('f-1')?.get('layerId')).toBe('L1');

    cmd.redo(ctx as never);
    expect(ctx.drawSource.getFeatureById('f-1')?.get('layerId')).toBe('L2');
  });
});
