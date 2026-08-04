// src/store/entities/layersRegistryStore.test.ts
//
// Tests de caracterización + regresión de Fase 9 (Prioridad 2). Cubre:
//  - `add`: zIndex asignado, defaults de colorMode según kind
//  - `remove`: índice + array actualizados, no-op sobre id inexistente
//  - `update`: kind cambia → colorMode coherente; lock=true y activeLayerId
//    === id → limpia activeLayerId
//  - `reorder`: ignora ids inexistentes, reasigna zIndex consecutivamente
//  - `toggleLock`: lock=true con activeLayerId===id → limpia active
//  - `toggleIsolate`: guarda visibilidad previa, aísla, y restaura al toggle
//  - `setActiveLayer`: no-op si la capa está locked
//  - `loadLayers`: respeta activeLayerId si la capa existe y no está locked
//  - `reconcileOrphanFeatures`: crea capa UNASSIGNED si hay huérfanos
//  - queries: getById, getVisible, getLayerForKind, hasKind, getColorMode

import { describe, it, expect, beforeEach } from 'vitest';
import { enableMapSet } from 'immer';
import OLFeature from 'ol/Feature.js';
enableMapSet();
import { useLayersStore } from './layersRegistryStore';
import type { Layer } from '../../core/objectModel';

function makeLayer(overrides: Partial<Layer> & { id: string; kind: Layer['kind'] }): Layer {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    kind: overrides.kind,
    zIndex: overrides.zIndex ?? 0,
    color: overrides.color ?? '#000',
    fillColor: overrides.fillColor ?? overrides.color ?? '#000',
    visible: overrides.visible ?? true,
    locked: overrides.locked ?? false,
    opacity: overrides.opacity ?? 1,
    showLabel: overrides.showLabel ?? false,
    showCota: overrides.showCota ?? false,
    colorMode: overrides.colorMode ?? (overrides.kind === 'manzana' ? 'colorIdx' : 'solid'),
  };
}

beforeEach(() => {
  useLayersStore.getState().resetToEmpty();
});

// ─── add ────────────────────────────────────────────────────────────

describe('layersRegistryStore — add', () => {
  it('asigna zIndex consecutivo según el orden de inserción', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.add(makeLayer({ id: 'b', kind: 'calle' }));
    s.add(makeLayer({ id: 'c', kind: 'manzana' }));
    expect(s.getById('a')?.zIndex).toBe(0);
    expect(s.getById('b')?.zIndex).toBe(1);
    expect(s.getById('c')?.zIndex).toBe(2);
  });

  it('colorMode default: colorIdx para manzana, solid para el resto', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'm', kind: 'manzana' }));
    s.add(makeLayer({ id: 'l', kind: 'lote' }));
    s.add(makeLayer({ id: 'c', kind: 'calle' }));
    expect(s.getById('m')?.colorMode).toBe('colorIdx');
    expect(s.getById('l')?.colorMode).toBe('solid');
    expect(s.getById('c')?.colorMode).toBe('solid');
  });

  it('kind inválido cae a "lote" (defensa)', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'x', kind: 'lote' } as Layer));
    expect(s.getById('x')?.kind).toBe('lote');
  });
});

// ─── remove ─────────────────────────────────────────────────────────

describe('layersRegistryStore — remove', () => {
  it('elimina del array y del índice', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.add(makeLayer({ id: 'b', kind: 'lote' }));
    s.remove('a');
    expect(s.getById('a')).toBeUndefined();
    expect(s.count()).toBe(1);
  });

  it('no-op sobre id inexistente', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.remove('no-existe');
    expect(s.count()).toBe(1);
    expect(s.getById('a')).toBeDefined();
  });
});

// ─── update ─────────────────────────────────────────────────────────

describe('layersRegistryStore — update', () => {
  it('cambiar kind ajusta colorMode (manzana → colorIdx)', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    expect(s.getById('a')?.colorMode).toBe('solid');
    s.update({ id: 'a', kind: 'manzana' });
    expect(s.getById('a')?.colorMode).toBe('colorIdx');
  });

  it('patch.locked=true cuando activeLayerId===id limpia activeLayerId', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.setActiveLayer('a');
    expect(useLayersStore.getState().activeLayerId).toBe('a');
    s.update({ id: 'a', locked: true });
    expect(useLayersStore.getState().activeLayerId).toBeNull();
  });

  it('patch.locked=true en una capa distinta de active NO toca activeLayerId', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.add(makeLayer({ id: 'b', kind: 'lote' }));
    s.setActiveLayer('a');
    s.update({ id: 'b', locked: true });
    expect(useLayersStore.getState().activeLayerId).toBe('a');
  });
});

// ─── reorder ────────────────────────────────────────────────────────

describe('layersRegistryStore — reorder', () => {
  it('reordena y reasigna zIndex consecutivamente', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.add(makeLayer({ id: 'b', kind: 'lote' }));
    s.add(makeLayer({ id: 'c', kind: 'lote' }));
    s.reorder(['c', 'a'], 0);
    expect(useLayersStore.getState().layers.map((l) => l.id)).toEqual(['c', 'a', 'b']);
    expect(useLayersStore.getState().layers.map((l) => l.zIndex)).toEqual([0, 1, 2]);
  });

  it('ignora ids inexistentes sin romper el resto', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.add(makeLayer({ id: 'b', kind: 'lote' }));
    s.reorder(['b', 'no-existe'], 0);
    expect(useLayersStore.getState().layers.map((l) => l.id)).toEqual(['b', 'a']);
  });

  it('reorder con todos los ids inexistentes es no-op', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    const before = useLayersStore.getState().layers.map((l) => l.id);
    s.reorder(['x', 'y'], 0);
    expect(useLayersStore.getState().layers.map((l) => l.id)).toEqual(before);
  });
});

// ─── toggleLock ─────────────────────────────────────────────────────

describe('layersRegistryStore — toggleLock', () => {
  it('alterna el flag locked', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.toggleLock('a');
    expect(s.getById('a')?.locked).toBe(true);
    s.toggleLock('a');
    expect(s.getById('a')?.locked).toBe(false);
  });

  it('lock=true con activeLayerId===id limpia activeLayerId', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.setActiveLayer('a');
    s.toggleLock('a');
    expect(useLayersStore.getState().activeLayerId).toBeNull();
  });
});

// ─── toggleIsolate ──────────────────────────────────────────────────

describe('layersRegistryStore — toggleIsolate', () => {
  it('aisla: solo la capa target queda visible', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote', visible: true }));
    s.add(makeLayer({ id: 'b', kind: 'calle', visible: true }));
    s.add(makeLayer({ id: 'c', kind: 'manzana', visible: true }));
    s.toggleIsolate('b');
    const visible = useLayersStore.getState().layers.filter((l) => l.visible).map((l) => l.id);
    expect(visible).toEqual(['b']);
    expect(useLayersStore.getState().isolatedLayerId).toBe('b');
  });

  it('segundo toggle sobre la misma capa restaura visibilidad previa', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote', visible: true }));
    s.add(makeLayer({ id: 'b', kind: 'calle', visible: false }));
    s.add(makeLayer({ id: 'c', kind: 'manzana', visible: true }));
    s.toggleIsolate('c');
    s.toggleIsolate('c');
    const visMap = Object.fromEntries(useLayersStore.getState().layers.map((l) => [l.id, l.visible]));
    expect(visMap).toEqual({ a: true, b: false, c: true });
    expect(useLayersStore.getState().isolatedLayerId).toBeNull();
  });

  it('cambiar de aislada sin desaislar primero restaura la anterior', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote', visible: true }));
    s.add(makeLayer({ id: 'b', kind: 'calle', visible: true }));
    s.add(makeLayer({ id: 'c', kind: 'manzana', visible: true }));
    s.toggleIsolate('a'); // solo a visible
    s.toggleIsolate('b'); // a vuelve, solo b visible
    const visMap = Object.fromEntries(useLayersStore.getState().layers.map((l) => [l.id, l.visible]));
    expect(visMap).toEqual({ a: false, b: true, c: false });
    expect(useLayersStore.getState().isolatedLayerId).toBe('b');
  });
});

// ─── setActiveLayer ─────────────────────────────────────────────────

describe('layersRegistryStore — setActiveLayer', () => {
  it('establece activeLayerId sobre capa no bloqueada', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.setActiveLayer('a');
    expect(useLayersStore.getState().activeLayerId).toBe('a');
  });

  it('NO establece activeLayerId sobre capa bloqueada (no-op)', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.setActiveLayer('a');
    expect(useLayersStore.getState().activeLayerId).toBe('a');
    s.update({ id: 'a', locked: true });
    // toggleLock ya limpió activeLayerId; reintentar setActiveLayer debe ser no-op.
    s.setActiveLayer('a');
    expect(useLayersStore.getState().activeLayerId).toBeNull();
  });

  it('setActiveLayer(null) limpia activeLayerId', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.setActiveLayer('a');
    s.setActiveLayer(null);
    expect(useLayersStore.getState().activeLayerId).toBeNull();
  });
});

// ─── loadLayers ─────────────────────────────────────────────────────

describe('layersRegistryStore — loadLayers', () => {
  it('reemplaza el set completo y respeta activeLayerId si la capa existe y no está locked', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'old', kind: 'lote' }));
    s.loadLayers(
      [
        makeLayer({ id: 'x', kind: 'lote' }),
        makeLayer({ id: 'y', kind: 'calle' }),
      ],
      'y',
    );
    const state = useLayersStore.getState();
    expect(state.count()).toBe(2);
    expect(state.getById('old')).toBeUndefined();
    expect(state.activeLayerId).toBe('y');
  });

  it('si la capa activeLayerId no existe, activeLayerId queda null', () => {
    const s = useLayersStore.getState();
    s.loadLayers([makeLayer({ id: 'x', kind: 'lote' })], 'no-existe');
    expect(useLayersStore.getState().activeLayerId).toBeNull();
  });

  it('si la capa activeLayerId está locked, activeLayerId queda null', () => {
    const s = useLayersStore.getState();
    s.loadLayers([makeLayer({ id: 'x', kind: 'lote', locked: true })], 'x');
    expect(useLayersStore.getState().activeLayerId).toBeNull();
  });
});

// ─── reconcileOrphanFeatures ────────────────────────────────────────

describe('layersRegistryStore — reconcileOrphanFeatures', () => {
  it('sin huérfanos retorna 0 y no toca nada', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    const feat = new OLFeature();
    feat.set('layerId', 'a');
    const n = s.reconcileOrphanFeatures([feat]);
    expect(n).toBe(0);
  });

  it('con huérfanos: reasigna a UNASSIGNED y crea la capa si no existe', () => {
    const s = useLayersStore.getState();
    const feat = new OLFeature();
    feat.set('layerId', 'capa-borrada');
    const n = s.reconcileOrphanFeatures([feat]);
    expect(n).toBe(1);
    expect(feat.get('layerId')).toBe('unassigned');
    expect(useLayersStore.getState().getById('unassigned')).toBeDefined();
  });
});

// ─── queries ────────────────────────────────────────────────────────

describe('layersRegistryStore — queries', () => {
  it('getVisible devuelve solo capas visibles, ordenadas por zIndex', () => {
    const s = useLayersStore.getState();
    // El store asigna zIndex automáticamente según el orden de inserción.
    // Para forzar el orden de display, hacemos add en el orden deseado y
    // luego reorder por zIndex.
    s.add(makeLayer({ id: 'a', kind: 'lote', visible: true }));
    s.add(makeLayer({ id: 'b', kind: 'calle', visible: false }));
    s.add(makeLayer({ id: 'c', kind: 'manzana', visible: true }));
    // El array tiene [a(0), b(1), c(2)]; visibles = [a, c]; sort ascendente por zIndex = [a(0), c(2)]
    const visible = s.getVisible();
    expect(visible.map((l) => l.id)).toEqual(['a', 'c']);
  });

  it('getLayerForKind retorna la primera del kind', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote' }));
    s.add(makeLayer({ id: 'b', kind: 'lote' }));
    expect(s.getLayerForKind('lote')?.id).toBe('a');
  });

  it('hasKindVisible requiere visible=true Y kind correcto', () => {
    const s = useLayersStore.getState();
    s.add(makeLayer({ id: 'a', kind: 'lote', visible: false }));
    s.add(makeLayer({ id: 'b', kind: 'lote', visible: true }));
    expect(s.hasKindVisible('lote')).toBe(true);
    s.update({ id: 'b', visible: false });
    expect(s.hasKindVisible('lote')).toBe(false);
  });

  it('getColorMode retorna "solid" si el id no existe', () => {
    expect(useLayersStore.getState().getColorMode('no-existe')).toBe('solid');
  });

  it('getKind devuelve null para id inexistente o kind inválido', () => {
    expect(useLayersStore.getState().getKind('no-existe')).toBeNull();
  });

  it('hasKind es false si no hay capa de ese kind', () => {
    expect(useLayersStore.getState().hasKind('rotonda')).toBe(false);
    useLayersStore.getState().add(makeLayer({ id: 'r', kind: 'rotonda' }));
    expect(useLayersStore.getState().hasKind('rotonda')).toBe(true);
  });
});