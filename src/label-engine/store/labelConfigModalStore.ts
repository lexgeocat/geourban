import { create } from 'zustand';
import type { LabelStyleConfig } from '../model/labelModel';
import type { GeoUrbanFeatureKind } from '@kernel/domain-model/featureModel';
import type { LabelNumberingMode } from '../model/labelNumbering';
import { useLabelClassStore } from './labelClassStore';

export type { LabelNumberingMode };
export type LabelOrderKind = Extract<GeoUrbanFeatureKind, 'manzana' | 'lote'> | 'layer';

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
  layerId?: string;
}
interface BatchLotsTarget {
  kind: 'batch-lots';
  manzanoId?: string | number;
  layerId?: string;
}
interface BatchLayerTarget {
  kind: 'batch-layer';
  layerId: string;
}

export type LabelConfigTarget =
  FeatureTarget | EntityTarget | BatchTarget | BatchLotsTarget | BatchLayerTarget;

export interface LabelOrderRequest {
  kind: LabelOrderKind;
  layerId?: string;
  scopeManzanoId?: string | number;
  config: LabelStyleConfig;
  numbering: LabelNumberingMode;
  customTemplate?: string;
}

interface LabelConfigModalState {
  open: boolean;
  target: LabelConfigTarget | null;
  initialConfig: LabelStyleConfig | null;
  initialText: string;
  lastManzanoConfig: LabelStyleConfig | null;
  lastLotsConfig: LabelStyleConfig | null;
  numberingMode: LabelNumberingMode;
  customNumberingTemplate: string;
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
  openForLayerBatch: (layerId: string, initial: LabelStyleConfig) => void;
  openForManzanoBatch: (initial: LabelStyleConfig, layerId?: string) => void;
  openForLotsBatch: (
    manzanoId: string | number | undefined,
    initial: LabelStyleConfig,
    layerId?: string
  ) => void;
  setNumberingMode: (m: LabelNumberingMode) => void;
  setCustomNumberingTemplate: (t: string) => void;
  setLastManzanoConfig: (cfg: LabelStyleConfig) => void;
  setLastLotsConfig: (cfg: LabelStyleConfig) => void;
  startOrderTrace: (req: LabelOrderRequest) => void;
  clearOrderTrace: () => void;
  close: () => void;
}

function numberingFromLayer(layerId: string | undefined): {
  mode?: LabelNumberingMode;
  template?: string;
} {
  if (!layerId) return {};
  const cls = useLabelClassStore.getState().getForLayer(layerId);
  return { mode: cls?.numbering?.mode, template: cls?.numbering?.customTemplate };
}

export const useLabelConfigModalStore = create<LabelConfigModalState>()((set, get) => ({
  open: false,
  target: null,
  initialConfig: null,
  initialText: '',
  lastManzanoConfig: null,
  lastLotsConfig: null,
  numberingMode: 'alpha-upper',
  customNumberingTemplate: '',
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
  openForManzanoBatch: (initial, layerId) => {
    const { mode, template } = numberingFromLayer(layerId);
    set({
      open: true,
      target: { kind: 'batch-manzanos', layerId },
      initialConfig: initial,
      initialText: '',
      numberingMode: mode ?? get().numberingMode,
      customNumberingTemplate: template ?? '',
    });
  },
  openForLotsBatch: (manzanoId, initial, layerId) => {
    const { mode, template } = numberingFromLayer(layerId);
    set({
      open: true,
      target: { kind: 'batch-lots', manzanoId, layerId },
      initialConfig: initial,
      initialText: '',
      numberingMode: mode ?? get().numberingMode,
      customNumberingTemplate: template ?? '',
    });
  },
  openForLayerBatch: (layerId, initial) => {
    const { mode, template } = numberingFromLayer(layerId);
    set({
      open: true,
      target: { kind: 'batch-layer', layerId },
      initialConfig: initial,
      initialText: '',
      numberingMode: mode ?? get().numberingMode,
      customNumberingTemplate: template ?? '',
    });
  },
  setNumberingMode: (m) => set({ numberingMode: m }),
  setCustomNumberingTemplate: (t) => set({ customNumberingTemplate: t }),
  setLastManzanoConfig: (cfg) => set({ lastManzanoConfig: cfg }),
  setLastLotsConfig: (cfg) => set({ lastLotsConfig: cfg }),
  startOrderTrace: (req) => set({ orderRequest: req }),
  clearOrderTrace: () => set({ orderRequest: null }),
  close: () => set({ open: false, target: null, initialConfig: null, initialText: '' }),
}));
