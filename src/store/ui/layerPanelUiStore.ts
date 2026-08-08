import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

type LayerPanelUiState = {
  open: boolean;
  expandedData: boolean;
  setOpen: (v: boolean) => void;
  setExpandedData: (v: boolean) => void;
};

type LayerPanelUiPersisted = Pick<LayerPanelUiState, 'open' | 'expandedData'>;

function defaultPersisted(): LayerPanelUiPersisted {
  return { open: true, expandedData: true };
}

export const useLayerPanelUiStore = create<LayerPanelUiState>()(
  persist(
    (set) => ({
      open: true,
      expandedData: true,
      setOpen: (v) => set({ open: v }),
      setExpandedData: (v) => set({ expandedData: v }),
    }),
    {
      name: 'geourban.layerPanelUi.v1',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (state: unknown, _fromVersion: number): LayerPanelUiPersisted => {
        if (!state || typeof state !== 'object') return defaultPersisted();
        const s = state as Partial<LayerPanelUiPersisted> & { expandedRefs?: boolean };
        // v1 → v2: descartamos `expandedRefs` (ya no se usa). El resto de campos
        // se conserva tal cual, con fallback a los defaults si faltaban.
        return {
          open: typeof s.open === 'boolean' ? s.open : true,
          expandedData: typeof s.expandedData === 'boolean' ? s.expandedData : true,
        };
      },
    },
  ),
);