// src/store/entities/layerResolution.test.ts
//
// Tests de caracterización + regresión de Fase 3.
// Verifican:
//   - la jerarquía de 4 niveles de `pickLayerId` (override, active, kind-match, auto-create)
//   - el flag `requireKindMatch` (FIX del bug histórico donde la capa
//     activa se usaba sin chequear kind)
//   - los 4 wrappers públicos (`resolveLayerId`, `requireLayerForKind`,
//     `resolveOrCreateLayerForKind`) y su contrato.
//
// Estrategia: los imports de los wrappers (`resolveLayerId`,
// `requireLayerForKind`) se hacen DENTRO de cada `it` con
// `await import(...)` para que Vitest no tenga que resolver el ciclo
// `Command.ts → mapStore.ts → CommandStack.ts → Command.ts` al cargar
// el archivo. `pickLayerId` y los helpers de test se importan arriba
// porque su cadena no toca el ciclo.

import { describe, it, expect, beforeEach } from 'vitest';

import { useLayersStore, type LayerState } from './layersRegistryStore';
import { pickLayerId } from './layerResolution';
import {
  autoCreateLayerForKind,
  resolveOrCreateLayerForKind,
} from './layerAutoCreate';

type Layer = LayerState['layers'][number];

function makeLayer(id: string, kind: Layer['kind'], opts: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    kind,
    color: '#000',
    fillColor: '#000',
    visible: true,
    locked: false,
    opacity: 1,
    showLabel: false,
    showCota: false,
    colorMode: kind === 'manzana' ? 'colorIdx' : 'solid',
    zIndex: 0,
    ...opts,
  };
}

function setupStore(layers: Layer[], activeLayerId: string | null = null) {
  useLayersStore.getState().resetToEmpty();
  useLayersStore.setState({
    layers,
    index: new Map(layers.map((l, idx) => [l.id, idx])),
    activeLayerId,
  } as Partial<LayerState>);
}

beforeEach(() => {
  useLayersStore.getState().resetToEmpty();
});

describe('pickLayerId — jerarquía de 4 niveles', () => {
  it('nivel 1: override gana si existe y no está locked', () => {
    const calle = makeLayer('calle-1', 'calle');
    const lote = makeLayer('lote-1', 'lote');
    setupStore([calle, lote], 'lote-1');
    const id = pickLayerId({ kind: 'lote', override: 'calle-1' });
    expect(id).toBe('calle-1');
  });

  it('nivel 1: override locked se salta, cae al siguiente nivel', () => {
    const calleLocked = makeLayer('calle-1', 'calle', { locked: true });
    const lote = makeLayer('lote-1', 'lote');
    setupStore([calleLocked, lote], 'lote-1');
    const id = pickLayerId({ kind: 'lote', override: 'calle-1' });
    expect(id).toBe('lote-1');
  });

  it('nivel 1: override inexistente cae al siguiente nivel', () => {
    const lote = makeLayer('lote-1', 'lote');
    setupStore([lote], 'lote-1');
    const id = pickLayerId({ kind: 'lote', override: 'no-existe' });
    expect(id).toBe('lote-1');
  });

  it('nivel 2: active layer se usa si no está locked y matchea kind', () => {
    const lote = makeLayer('lote-1', 'lote');
    setupStore([lote], 'lote-1');
    const id = pickLayerId({ kind: 'lote' });
    expect(id).toBe('lote-1');
  });

  it('nivel 2 (FIX): active layer NO se usa si kind no matchea', () => {
    const calle = makeLayer('calle-1', 'calle');
    setupStore([calle], 'calle-1');
    const id = pickLayerId({ kind: 'lote', autoCreate: true });
    // No hay capa de lote, así que cae al nivel 3 (también vacío)
    // y al 4 (auto-create)
    expect(id).toBeDefined();
    expect(id).not.toBe('calle-1');
  });

  it('nivel 2: active layer locked se salta, cae al nivel 3', () => {
    const calleLocked = makeLayer('calle-1', 'calle', { locked: true });
    const lote = makeLayer('lote-1', 'lote');
    setupStore([calleLocked, lote], 'calle-1');
    const id = pickLayerId({ kind: 'lote' });
    expect(id).toBe('lote-1');
  });

  it('nivel 3: getLayerForKind se usa como fallback', () => {
    const lote = makeLayer('lote-1', 'lote');
    setupStore([lote], null);
    const id = pickLayerId({ kind: 'lote' });
    expect(id).toBe('lote-1');
  });

  it('nivel 3: getLayerForKind con match locked se salta, no hay match', () => {
    const loteLocked = makeLayer('lote-1', 'lote', { locked: true });
    setupStore([loteLocked], null);
    const id = pickLayerId({ kind: 'lote', autoCreate: false });
    expect(id).toBeUndefined();
  });

  it('nivel 4: autoCreate=true llama a autoCreateLayerForKind', () => {
    setupStore([], null);
    const id = pickLayerId({ kind: 'lote', autoCreate: true });
    expect(id).toBeDefined();
    // El id tiene el prefijo 'layer-' de newId('layer')
    expect(id).toMatch(/^layer-/);
  });

  it('autoCreate=false retorna undefined si no hay match', () => {
    setupStore([], null);
    const id = pickLayerId({ kind: 'lote', autoCreate: false });
    expect(id).toBeUndefined();
  });
});

describe('pickLayerId — flag requireKindMatch', () => {
  it('requireKindMatch=false: usa active sin importar kind (escape hatch)', () => {
    const calle = makeLayer('calle-1', 'calle');
    setupStore([calle], 'calle-1');
    const id = pickLayerId({
      kind: 'lote',
      requireKindMatch: false,
      autoCreate: false,
    });
    expect(id).toBe('calle-1');
  });

  it('requireKindMatch=true (default): respeta el kind al usar active', () => {
    const calle = makeLayer('calle-1', 'calle');
    setupStore([calle], 'calle-1');
    const id = pickLayerId({
      kind: 'lote',
      requireKindMatch: true,
      autoCreate: false,
    });
    // Calle no matchea 'lote', no hay otra capa de lote, no hay auto-create
    expect(id).toBeUndefined();
  });
});

describe('resolveLayerId (wrapper) — fix de kind en active', () => {
  it('comportamiento preservado: usa activa si matchea y no está locked', async () => {
    const { resolveLayerId } = await import('../../commands/features/AddFeatureCommand');
    const lote = makeLayer('lote-1', 'lote');
    setupStore([lote], 'lote-1');
    expect(resolveLayerId(undefined, 'lote')).toBe('lote-1');
  });

  it('FIX: con active de otro kind, no se usa (cae al siguiente nivel)', async () => {
    const { resolveLayerId } = await import('../../commands/features/AddFeatureCommand');
    const calle = makeLayer('calle-1', 'calle');
    const lote = makeLayer('lote-1', 'lote');
    setupStore([calle, lote], 'calle-1');
    // Antes del fix: retornaba 'calle-1' (bug — calle como destino de lote)
    // Después del fix: cae a getLayerForKind('lote')
    expect(resolveLayerId(undefined, 'lote')).toBe('lote-1');
  });

  it('override gana sobre active, pero respeta locked', async () => {
    const { resolveLayerId } = await import('../../commands/features/AddFeatureCommand');
    const calle = makeLayer('calle-1', 'calle');
    const calleLocked = makeLayer('calle-2', 'calle', { locked: true });
    const lote = makeLayer('lote-1', 'lote');
    setupStore([calle, calleLocked, lote], 'calle-1');
    // override 'calle-2' está locked, salta, cae a active 'calle-1' que
    // matchea calle (no lote) — FIX lo descarta — cae a getLayerForKind('lote')
    expect(resolveLayerId('calle-2', 'lote')).toBe('lote-1');
  });

  it('sin kind retorna undefined (preserva contrato original)', async () => {
    const { resolveLayerId } = await import('../../commands/features/AddFeatureCommand');
    const lote = makeLayer('lote-1', 'lote');
    setupStore([lote], 'lote-1');
    expect(resolveLayerId()).toBeUndefined();
  });

  it('autoCreate=false: sin match retorna undefined (no auto-crea)', async () => {
    const { resolveLayerId } = await import('../../commands/features/AddFeatureCommand');
    setupStore([], null);
    expect(resolveLayerId(undefined, 'lote')).toBeUndefined();
  });
});

describe('requireLayerForKind (wrapper)', () => {
  it('retorna el id de la active si matchea kind', async () => {
    const { requireLayerForKind } = await import('../ui/layerPickerStore');
    const lote = makeLayer('lote-1', 'lote');
    setupStore([lote], 'lote-1');
    await expect(requireLayerForKind('lote')).resolves.toBe('lote-1');
  });

  it('FIX preservado: NO usa active de otro kind, cae a getLayerForKind', async () => {
    const { requireLayerForKind } = await import('../ui/layerPickerStore');
    const calle = makeLayer('calle-1', 'calle');
    const lote = makeLayer('lote-1', 'lote');
    setupStore([calle, lote], 'calle-1');
    await expect(requireLayerForKind('lote')).resolves.toBe('lote-1');
  });

  it('auto-create cuando no hay match', async () => {
    const { requireLayerForKind } = await import('../ui/layerPickerStore');
    setupStore([], null);
    const id = await requireLayerForKind('manzana');
    expect(id).toMatch(/^layer-/);
  });
});

describe('resolveOrCreateLayerForKind (wrapper)', () => {
  it('usa active si matchea', () => {
    const manzana = makeLayer('manzana-1', 'manzana');
    setupStore([manzana], 'manzana-1');
    expect(resolveOrCreateLayerForKind('manzana')).toBe('manzana-1');
  });

  it('auto-create cuando no hay match', () => {
    setupStore([], null);
    expect(resolveOrCreateLayerForKind('perimetro')).toMatch(/^layer-/);
  });
});

describe('resolveLoteLayerId (en recomputeManzanos) — fix de kind en active', () => {
  // Esta función vive dentro de recomputeManzanos.ts (no se exporta),
  // pero su semántica queda cubierta por los tests de pickLayerId +
  // requireLayerForKind. Acá verificamos el contrato que el call-site
  // (línea 872) espera: retorno sincrónico `string`, nunca undefined.
  it('comportamiento: con active de calle, igual resuelve a capa de lote', () => {
    // Simulamos el call-site directamente vía pickLayerId con la misma
    // config que usa resolveLoteLayerId internamente.
    const calle = makeLayer('calle-1', 'calle');
    const lote = makeLayer('lote-1', 'lote');
    setupStore([calle, lote], 'calle-1');
    const id = pickLayerId({
      kind: 'lote',
      requireKindMatch: true,
      autoCreate: true,
    });
    expect(id).toBe('lote-1');
  });

  it('comportamiento: sin capas, auto-crea y retorna id', () => {
    setupStore([], null);
    const id = pickLayerId({
      kind: 'lote',
      requireKindMatch: true,
      autoCreate: true,
    });
    expect(id).toMatch(/^layer-/);
  });

  it('preferredLayerId locked se salta; si el primer match del kind está locked, auto-crea', () => {
    const loteLocked = makeLayer('lote-1', 'lote', { locked: true });
    const loteNuevo = makeLayer('lote-2', 'lote');
    setupStore([loteLocked, loteNuevo], null);
    const id = pickLayerId({
      kind: 'lote',
      override: 'lote-1',
      requireKindMatch: true,
      autoCreate: true,
    });
    // `getLayerForKind` retorna el primer match ('lote-1'), que está
    // locked → no matchea → auto-crea. Comportamiento de caracterización:
    // la consolidación preserva la semántica original de las 4 funciones
    // (solo el primer match del kind, no la primera no-locked).
    expect(id).not.toBe('lote-1');
    expect(id).toMatch(/^layer-/);
  });
});

describe('autoCreateLayerForKind (side effect)', () => {
  it('retorna un id nuevo con prefijo "layer-"', () => {
    setupStore([], null);
    const id = autoCreateLayerForKind('manzana');
    expect(id).toMatch(/^layer-/);
  });
});
