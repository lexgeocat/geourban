import { create } from 'zustand';
import type { LabelStyleConfig } from '../../core/labelModel';
import type { GeoUrbanFeatureKind } from '../../core/objectModel';
import type { LabelNumberingMode } from '../../core/labelNumbering';

export type { LabelNumberingMode };

/** Subconjunto de kinds que soportan trazado de orden de etiquetado. */
export type LabelOrderKind = Extract<GeoUrbanFeatureKind, 'manzana' | 'lote'>;

interface FeatureTarget {
  kind: 'feature';
  featureId: string | number;
}
interface EntityTarget {
  kind: 'entity';
  entityType: 'street' | 'roundabout';
  entityId: string;
}
interface BatchTarget {
  kind: 'batch-manzanos';
}
interface BatchLotsTarget {
  kind: 'batch-lots';
  manzanoId?: string | number;
}

export type LabelConfigTarget = FeatureTarget | EntityTarget | BatchTarget | BatchLotsTarget;

/** Pedido de trazado de orden en curso — lo consume `LabelOrderMode` al terminar el trazo. */
export interface LabelOrderRequest {
  kind: LabelOrderKind;
  /** Si se da (solo aplica a 'lote'), restringe el trazado a los lotes de ese manzano. */
  scopeManzanoId?: string | number;
  config: LabelStyleConfig;
  numbering: LabelNumberingMode;
}

interface LabelConfigModalState {
  open: boolean;
  target: LabelConfigTarget | null;
  initialConfig: LabelStyleConfig | null;
  initialText: string;
  lastManzanoConfig: LabelStyleConfig | null;
  lastLotsConfig: LabelStyleConfig | null;
  numberingMode: LabelNumberingMode;
  orderRequest: LabelOrderRequest | null;
  openForFeature: (
    featureId: string | number,
    initial: LabelStyleConfig,
    initialText?: string
  ) => void;
  openForEntity: (
    entityType: 'street' | 'roundabout',
    entityId: string,
    initial: LabelStyleConfig,
    initialText?: string
  ) => void;
  openForManzanoBatch: (initial: LabelStyleConfig) => void;
  openForLotsBatch: (manzanoId: string | number | undefined, initial: LabelStyleConfig) => void;
  setNumberingMode: (m: LabelNumberingMode) => void;
  setLastManzanoConfig: (cfg: LabelStyleConfig) => void;
  setLastLotsConfig: (cfg: LabelStyleConfig) => void;
  /** Activa el modo de trazado de orden con el estilo/numeración actuales del modal. */
  startOrderTrace: (req: LabelOrderRequest) => void;
  /** Limpia el pedido de trazado (al completarlo, cancelarlo o abortar con Escape). */
  clearOrderTrace: () => void;
  close: () => void;
}

export const useLabelConfigModalStore = create<LabelConfigModalState>()((set) => ({
  open: false,
  target: null,
  initialConfig: null,
  initialText: '',
  lastManzanoConfig: null,
  lastLotsConfig: null,
  numberingMode: 'alpha-upper',
  orderRequest: null,
  openForFeature: (featureId, initial, initialText = '') =>
    set({
      open: true,
      target: { kind: 'feature', featureId },
      initialConfig: initial,
      initialText,
    }),
  openForEntity: (entityType, entityId, initial, initialText = '') =>
    set({
      open: true,
      target: { kind: 'entity', entityType, entityId },
      initialConfig: initial,
      initialText,
    }),
  openForManzanoBatch: (initial) =>
    set({
      open: true,
      target: { kind: 'batch-manzanos' },
      initialConfig: initial,
      initialText: '',
    }),
  openForLotsBatch: (manzanoId, initial) =>
    set({
      open: true,
      target: { kind: 'batch-lots', manzanoId },
      initialConfig: initial,
      initialText: '',
    }),
  setNumberingMode: (m) => set({ numberingMode: m }),
  setLastManzanoConfig: (cfg) => set({ lastManzanoConfig: cfg }),
  setLastLotsConfig: (cfg) => set({ lastLotsConfig: cfg }),
  startOrderTrace: (req) => set({ orderRequest: req }),
  clearOrderTrace: () => set({ orderRequest: null }),
  close: () => set({ open: false, target: null, initialConfig: null, initialText: '' }),
}));
