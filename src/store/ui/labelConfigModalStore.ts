import { create } from 'zustand';
import type { LabelStyleConfig } from '../../core/labelModel';

export type LabelNumberingMode = 'numeric' | 'alpha';

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

export type LabelConfigTarget = FeatureTarget | EntityTarget | BatchTarget;

interface LabelConfigModalState {
  open: boolean;
  target: LabelConfigTarget | null;
  initialConfig: LabelStyleConfig | null;
  initialText: string;
  lastManzanoConfig: LabelStyleConfig | null;
  numberingMode: LabelNumberingMode;
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
  setNumberingMode: (m: LabelNumberingMode) => void;
  setLastManzanoConfig: (cfg: LabelStyleConfig) => void;
  close: () => void;
}

export const useLabelConfigModalStore = create<LabelConfigModalState>()((set) => ({
  open: false,
  target: null,
  initialConfig: null,
  initialText: '',
  lastManzanoConfig: null,
  numberingMode: 'alpha',
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
  setNumberingMode: (m) => set({ numberingMode: m }),
  setLastManzanoConfig: (cfg) => set({ lastManzanoConfig: cfg }),
  close: () => set({ open: false, target: null, initialConfig: null, initialText: '' }),
}));
