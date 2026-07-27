import { create } from 'zustand';
import type { GeoUrbanFeatureKind } from '../../core/objectModel';
import { useLayersStore } from '../entities/layersRegistryStore';

type PendingRequest = {
  kind: GeoUrbanFeatureKind;
  resolve: (layerId: string | undefined) => void;
};

type LayerPickerState = {
  pending: PendingRequest | null;
  rememberedByKind: Record<string, string | undefined>;
  askEnabled: boolean;
  setAskEnabled: (v: boolean) => void;
  request: (kind: GeoUrbanFeatureKind) => Promise<string | undefined>;
  resolvePending: (layerId: string | undefined, remember?: boolean) => void;
  cancelPending: () => void;
};

export const useLayerPickerStore = create<LayerPickerState>()((set, get) => ({
  pending: null,
  rememberedByKind: {},
  askEnabled: true,

  setAskEnabled: (v) => set({ askEnabled: v }),

  request: (kind) => {
    if (!get().askEnabled) return Promise.resolve(undefined);
    const remembered = get().rememberedByKind[kind];
    if (remembered !== undefined) {
      const rememberedLayer = useLayersStore.getState().getById(remembered);
      // Fase 6: la capa "recordada" pudo bloquearse DESPUÉS de que el
      // usuario tildó "no preguntar de nuevo" — sin este chequeo, el
      // próximo trazo caía ahí en silencio, sin poder seleccionarse/
      // editarse/borrarse después. Se descarta el recuerdo (no se borra,
      // por si se desbloquea más tarde) y se vuelve a preguntar.
      if (!rememberedLayer || !rememberedLayer.locked) {
        return Promise.resolve(remembered);
      }
    }

    return new Promise<string | undefined>((resolve) => {
      set({ pending: { kind, resolve } });
    });
  },

  resolvePending: (layerId, remember) => {
    const pending = get().pending;
    if (!pending) return;
    if (remember) {
      set((s) => ({ rememberedByKind: { ...s.rememberedByKind, [pending.kind]: layerId } }));
    }
    set({ pending: null });
    pending.resolve(layerId);
  },

  cancelPending: () => {
    const pending = get().pending;
    if (!pending) return;
    set({ pending: null });
    pending.resolve(undefined);
  },
}));

export function pickLayerForKind(kind: GeoUrbanFeatureKind): Promise<string | undefined> {
  return useLayerPickerStore.getState().request(kind);
}