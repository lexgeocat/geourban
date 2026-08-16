import { create } from 'zustand';
import {
  defaultLabelClass,
  newLabelClassId,
  type LabelClass,
  type LabelClassMap,
} from '../model/labelClass';
import { defaultLabelStyleConfig, type LabelStyleConfig } from '../model/labelModel';

export type { LabelClass, LabelClassMap } from '../model/labelClass';

interface LabelClassState {
  byLayerId: LabelClassMap;

  getForLayer: (layerId: string) => LabelClass | undefined;
  upsert: (layerId: string, patch: Partial<Omit<LabelClass, 'id' | 'layerId' | 'updatedAt'>> & { style?: LabelStyleConfig }) => LabelClass;
  remove: (layerId: string) => void;
  loadAll: (map: LabelClassMap) => void;
  clear: () => void;
}

function touch(c: LabelClass): LabelClass {
  return { ...c, updatedAt: new Date().toISOString() };
}

export const useLabelClassStore = create<LabelClassState>()((set, get) => ({
  byLayerId: {},

  getForLayer: (layerId) => get().byLayerId[layerId],

  upsert: (layerId, patch) => {
    const existing = get().byLayerId[layerId];
    const base: LabelClass = existing ?? defaultLabelClass(layerId, patch.style ?? defaultStyleForLayer(layerId));
    const next: LabelClass = touch({
      ...base,
      ...patch,
      id: existing?.id ?? newLabelClassId(),
      layerId,
    });
    set((s) => ({ byLayerId: { ...s.byLayerId, [layerId]: next } }));
    return next;
  },

  remove: (layerId) =>
    set((s) => {
      if (!(layerId in s.byLayerId)) return s;
      const next = { ...s.byLayerId };
      delete next[layerId];
      return { byLayerId: next };
    }),

  loadAll: (map) => set({ byLayerId: { ...map } }),

  clear: () => set({ byLayerId: {} }),
}));

function defaultStyleForLayer(_layerId: string): LabelStyleConfig {
  return defaultLabelStyleConfig({
    showPrimaryMetric: false,
    showSecondaryMetric: false,
    showEdgeCotas: false,
  });
}
