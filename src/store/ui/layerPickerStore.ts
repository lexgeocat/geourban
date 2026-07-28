import { create } from 'zustand';
import { getLayerSuggestion, type GeoUrbanFeatureKind, type LayerSuggestion } from '../../core/objectModel';
import { runCommand } from '../../commands/core/CommandStack';
import { AddLayerCommand } from '../../commands/layers/AddLayerCommand';
import { useLayersStore } from '../entities/layersRegistryStore';
import { autoCreateLayerForKind } from '../entities/layerAutoCreate';

export interface LayerResolverRequest {
  kind: GeoUrbanFeatureKind;
  suggestion?: LayerSuggestion;
  resolve: (layerId: string | null) => void;
}

type LayerPickerState = {
  pending: LayerResolverRequest | null;
  request: (kind: GeoUrbanFeatureKind) => Promise<string | null>;
  resolveWithExisting: (layerId: string) => void;
  resolveWithNewLayer: (input: { name: string; color: string; fillColor: string }) => void;
  cancelPending: () => void;
};

/**
 * @deprecated Ya no se dispara: la creación de capas es 100% automática
 * (ver `requireLayerForKind` más abajo). Se mantiene solo por compatibilidad;
 * el modal asociado (`LayerResolverModal`) fue retirado de App.tsx.
 */
export const useLayerPickerStore = create<LayerPickerState>()((set, get) => ({
  pending: null,

  request: (kind) => {
    return new Promise<string | null>((resolve) => {
      set({
        pending: {
          kind,
          suggestion: getLayerSuggestion(kind),
          resolve,
        },
      });
    });
  },

  resolveWithExisting: (layerId) => {
    const pending = get().pending;
    if (!pending) return;
    set({ pending: null });
    pending.resolve(layerId);
  },

  resolveWithNewLayer: ({ name, color, fillColor }) => {
    const pending = get().pending;
    if (!pending) return;
    const id = `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    void runCommand(
      new AddLayerCommand({
        id,
        name,
        kind: pending.kind,
        color,
        fillColor,
        visible: true,
        locked: false,
        opacity: 1,
        showLabel: true,
        showCota: true,
        colorMode: pending.kind === 'manzana' ? 'colorIdx' : 'solid',
      }),
    );
    set({ pending: null });
    pending.resolve(id);
  },

  cancelPending: () => {
    const pending = get().pending;
    if (!pending) return;
    set({ pending: null });
    pending.resolve(null);
  },
}));

/**
 * Resuelve la capa a asignar para una nueva entidad de tipo `kind`.
 * YA NO interrumpe con un modal: si no hay capa activa ni una capa existente
 * de ese tipo, se crea automáticamente una nueva (silenciosa). Nunca deja
 * la entidad sin capa ni la borra por cancelación del usuario.
 */
export function requireLayerForKind(kind: GeoUrbanFeatureKind): Promise<string | null> {
  const registry = useLayersStore.getState();

  // Capa activa: se reusa sin importar el tipo (así funciona "capa activa"
  // — los nuevos trazos van ahí).
  if (registry.activeLayerId) {
    const active = registry.getById(registry.activeLayerId);
    if (active && !active.locked) return Promise.resolve(active.id);
  }

  // Ya existe una capa (no bloqueada) para este tipo: se reusa.
  const existing = registry.getLayerForKind(kind);
  if (existing && !existing.locked) return Promise.resolve(existing.id);

  // No hay ninguna capa candidata: se crea automáticamente. Nunca null.
  return Promise.resolve(autoCreateLayerForKind(kind));
}
