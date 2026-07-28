import { create } from 'zustand';
import { getLayerSuggestion, type GeoUrbanFeatureKind, type LayerSuggestion } from '../../core/objectModel';
import { runCommand } from '../../commands/core/CommandStack';
import { AddLayerCommand } from '../../commands/layers/AddLayerCommand';

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

export function requireLayerForKind(kind: GeoUrbanFeatureKind): Promise<string | null> {
  return useLayerPickerStore.getState().request(kind);
}