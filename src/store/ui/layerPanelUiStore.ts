import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

type LayerPanelUiState = {
  open: boolean;
  expandedData: boolean;
  expandedRefs: boolean;
  setOpen: (v: boolean) => void;
  setExpandedData: (v: boolean) => void;
  setExpandedRefs: (v: boolean) => void;
};

/** Fase 7 (punto "estado de apertura/expansión no persistido"): antes
 *  LayerPanel usaba useState local para open/expanded, reseteándose en
 *  cada recarga — mismo patrón que ya usan snapSettingsStore/roadCornerStore. */
export const useLayerPanelUiStore = create<LayerPanelUiState>()(
  persist(
    (set) => ({
      open: true,
      expandedData: true,
      expandedRefs: true,
      setOpen: (v) => set({ open: v }),
      setExpandedData: (v) => set({ expandedData: v }),
      setExpandedRefs: (v) => set({ expandedRefs: v }),
    }),
    {
      name: 'geourban.layerPanelUi.v1',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);