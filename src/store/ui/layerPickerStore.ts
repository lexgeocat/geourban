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
  /** Pedido de resolución de capa actualmente abierto — lo consume
   *  `LayerResolverModal`. `null` = ningún modal pendiente. */
  pending: LayerResolverRequest | null;

  /** Fase 2: punto de entrada único. SIEMPRE resuelve a un layerId real
   *  o a `null` si el usuario cancela — no hay bypass silencioso (no hay
   *  `askEnabled`, no hay "recordar para este kind", no hay "cancelar =
   *  capa activa"). El llamador es responsable de abortar la creación de
   *  la entidad si recibe `null`. */
  request: (kind: GeoUrbanFeatureKind) => Promise<string | null>;
  /** El usuario eligió una capa ya existente. */
  resolveWithExisting: (layerId: string) => void;
  /** El usuario creó una capa nueva desde la pestaña "Crear nueva". */
  resolveWithNewLayer: (input: { name: string; color: string; fillColor: string }) => void;
  /** El usuario canceló — no se asigna ninguna capa. */
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

/**
 * Resuelve la capa destino para una entidad de tipo `kind`. Reemplaza el
 * viejo `pickLayerForKind` (que se podía saltar vía `askEnabled` /
 * "no preguntar de nuevo" / "Cancelar = capa activa" — ver H4 del
 * diagnóstico). Ahora es obligatorio: el usuario elige o crea una capa,
 * o cancela — y cancelar es `null`, nunca una asignación silenciosa.
 */
export function requireLayerForKind(kind: GeoUrbanFeatureKind): Promise<string | null> {
  return useLayerPickerStore.getState().request(kind);
}