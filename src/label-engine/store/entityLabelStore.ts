import { create } from 'zustand';
import type { LabelStyleConfig } from '../model/labelModel';

export interface EntityLabelEntry {
  config: LabelStyleConfig;
  text: string;
}

type EntityLabelMap = Record<string, EntityLabelEntry>;

interface EntityLabelState {
  byId: EntityLabelMap;
  set: (id: string, entry: EntityLabelEntry) => void;
  get: (id: string) => EntityLabelEntry | undefined;
  remove: (id: string) => void;
  clear: () => void;
  loadAll: (entries: EntityLabelMap) => void;
}

export const useEntityLabelStore = create<EntityLabelState>()((set, get) => ({
  byId: {},
  set: (id, entry) => set((s) => ({ byId: { ...s.byId, [id]: entry } })),
  get: (id) => get().byId[id],
  remove: (id) =>
    set((s) => {
      if (!(id in s.byId)) return s;
      const next = { ...s.byId };
      delete next[id];
      return { byId: next };
    }),
  clear: () => set({ byId: {} }),
  loadAll: (entries) => set({ byId: entries }),
}));
