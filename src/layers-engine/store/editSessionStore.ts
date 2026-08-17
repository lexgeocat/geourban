import { create } from 'zustand';

interface EditSessionState {
  editingLayerIds: Set<string>;
  isEditing: (layerId: string | undefined | null) => boolean;
  startEditing: (layerId: string) => void;
  stopEditing: (layerId: string) => void;
  toggleEditing: (layerId: string) => void;
  stopAll: () => void;
}

export const useEditSessionStore = create<EditSessionState>()((set, get) => ({
  editingLayerIds: new Set<string>(),

  isEditing: (layerId) => (layerId ? get().editingLayerIds.has(layerId) : false),

  startEditing: (layerId) =>
    set((s) => {
      if (s.editingLayerIds.has(layerId)) return s;
      const next = new Set(s.editingLayerIds);
      next.add(layerId);
      return { editingLayerIds: next };
    }),

  stopEditing: (layerId) =>
    set((s) => {
      if (!s.editingLayerIds.has(layerId)) return s;
      const next = new Set(s.editingLayerIds);
      next.delete(layerId);
      return { editingLayerIds: next };
    }),

  toggleEditing: (layerId) => {
    const { editingLayerIds, startEditing, stopEditing } = get();
    if (editingLayerIds.has(layerId)) stopEditing(layerId);
    else startEditing(layerId);
  },

  stopAll: () => set({ editingLayerIds: new Set() }),
}));
