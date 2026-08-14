import { describe, it, expect, beforeEach } from 'vitest';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Polygon from 'ol/geom/Polygon.js';
import type { LotResult } from '@kernel/geometry/polygonEngine';
import { useLabelClassStore } from '@label-engine/store/labelClassStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { defaultLabelStyleConfig } from '@label-engine/model/labelModel';

class FakeCommandContext {
  drawSource = new VectorSource<Feature<Polygon>>();
  getMap(): null { return null; }
}

function manzanoFeature(): Feature<Polygon> {
  const f = new Feature<Polygon>({
    geometry: new Polygon([[[0, 0], [30, 0], [30, 20], [0, 20], [0, 0]]]),
  });
  f.setId('mzn-A');
  f.set('kind', 'manzana');
  f.set('code', 'A');
  return f;
}

function oldLotFeature(i: number, labelText: string): Feature<Polygon> {
  const x = i * 10;
  const f = new Feature<Polygon>({
    geometry: new Polygon([
      [
        [x, 0],
        [x + 10, 0],
        [x + 10, 20],
        [x, 20],
        [x, 0],
      ],
    ]),
  });
  f.setId(`old-lot-${i}`);
  f.set('kind', 'lote');
  f.set('code', `A-${i + 1}`);
  f.set('lotGroupId', 'mzn-A');
  f.set('labelConfig', defaultLabelStyleConfig({ enabled: true }));
  f.set('labelText', labelText);
  f.set('labelNumberingMode', 'roman-upper');
  f.set('layerId', 'L-LOTE');
  return f;
}

function newLot(i: number): LotResult {
  const x = i * 10;
  return {
    pts: [
      [x, 0],
      [x + 10, 0],
      [x + 10, 20],
      [x, 20],
      [x, 0],
    ],
    isRemnant: false,
    frontM: 10,
    depthM: 20,
    areaM2: 200,
  };
}

beforeEach(() => {
  useLabelClassStore.setState({ byLayerId: {} });
  useLayersStore.setState({ layers: [], index: new Map(), activeLayerId: null });
});

describe('replaceLotsForManzano preserves numbering mode (B6)', () => {
  it('regenerates labelText with roman-upper when old lots had it', async () => {
    const { replaceLotsForManzano } = await import('@lotificacion-engine/commands/replaceLotsForManzano');
    useLayersStore.getState().add({
      id: 'L-LOTE', name: 'Lote', kind: 'lote', color: '#fff', visible: true, locked: false, opacity: 1, showLabel: true, showCota: false,
    });

    const ctx = new FakeCommandContext();
    ctx.drawSource.addFeature(oldLotFeature(0, 'I'));
    ctx.drawSource.addFeature(oldLotFeature(1, 'II'));

    const mzn = manzanoFeature();
    const result = replaceLotsForManzano(
      ctx as never,
      { manzanoId: 'mzn-A', manzanoFeature: mzn, lots: [newLot(0), newLot(1)], method: 'auto', preferredLayerId: 'L-LOTE' }
    );
    expect(result.newLotIds).toHaveLength(2);

    const texts: string[] = [];
    ctx.drawSource.forEachFeature((f) => {
      if (f.get('kind') === 'lote' && f.get('lotGroupId') === 'mzn-A') {
        texts.push((f.get('labelText') as string) ?? '');
      }
    });
    expect(texts).toEqual(['I', 'II']);

    const modes = new Set<string>();
    ctx.drawSource.forEachFeature((f) => {
      if (f.get('kind') === 'lote' && f.get('lotGroupId') === 'mzn-A') {
        modes.add(f.get('labelNumberingMode') as string);
      }
    });
    expect(modes.has('roman-upper')).toBe(true);
  });

  it('falls back to numeric when no class is set and no carried mode', async () => {
    const { replaceLotsForManzano } = await import('@lotificacion-engine/commands/replaceLotsForManzano');
    useLayersStore.getState().add({
      id: 'L-LOTE', name: 'Lote', kind: 'lote', color: '#fff', visible: true, locked: false, opacity: 1, showLabel: true, showCota: false,
    });

    const ctx = new FakeCommandContext();
    const mzn = manzanoFeature();
    const result = replaceLotsForManzano(
      ctx as never,
      { manzanoId: 'mzn-A', manzanoFeature: mzn, lots: [newLot(0), newLot(1)], method: 'auto', preferredLayerId: 'L-LOTE' }
    );
    expect(result.newLotIds).toHaveLength(2);
  });
});

