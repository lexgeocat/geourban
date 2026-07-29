import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type OverlayLayerId = 'urbanizacion' | 'georreferenciado';

export interface OverlayLayerConfig {
  visible: boolean;
  opacity: number;
  strokeColor: string;
  fillColor: string;
  showLabel: boolean;
  showCota: boolean;
}

interface DisplayLayersState {
  overlays: Record<OverlayLayerId, OverlayLayerConfig>;

  setOverlayVisible: (id: OverlayLayerId, v: boolean) => void;
  setOverlayOpacity: (id: OverlayLayerId, v: number) => void;
  setOverlayStrokeColor: (id: OverlayLayerId, c: string) => void;
  setOverlayFillColor: (id: OverlayLayerId, c: string) => void;
  setOverlayOption: (id: OverlayLayerId, key: 'showLabel' | 'showCota', v: boolean) => void;

  isLabelVisible: (ownerShowLabel: boolean) => boolean;
  isCotaVisible: (ownerShowCota: boolean) => boolean;
  labelOpacity: (ownerShowLabel: boolean) => number;
  cotaOpacity: (ownerShowCota: boolean) => number;
}

const DEFAULT_OVERLAYS: Record<OverlayLayerId, OverlayLayerConfig> = {
  urbanizacion: { visible: true, opacity: 1, strokeColor: '#00d4ff', fillColor: '#00d4ff', showLabel: false, showCota: true },
  georreferenciado: { visible: true, opacity: 1, strokeColor: '#3fb950', fillColor: '#3fb950', showLabel: false, showCota: true },
};

export const useDisplayLayersStore = create<DisplayLayersState>()(
  persist(
    (set) => ({
      overlays: { ...DEFAULT_OVERLAYS },

      setOverlayVisible: (id, v) =>
        set((s) => ({ overlays: { ...s.overlays, [id]: { ...s.overlays[id], visible: v } } })),
      setOverlayOpacity: (id, v) =>
        set((s) => ({ overlays: { ...s.overlays, [id]: { ...s.overlays[id], opacity: Math.max(0, Math.min(1, v)) } } })),
      setOverlayStrokeColor: (id, c) =>
        set((s) => ({ overlays: { ...s.overlays, [id]: { ...s.overlays[id], strokeColor: c } } })),
      setOverlayFillColor: (id, c) =>
        set((s) => ({ overlays: { ...s.overlays, [id]: { ...s.overlays[id], fillColor: c } } })),
      setOverlayOption: (id, key, v) =>
        set((s) => ({ overlays: { ...s.overlays, [id]: { ...s.overlays[id], [key]: v } } })),

      isLabelVisible: (ownerShowLabel) => ownerShowLabel,
      isCotaVisible: (ownerShowCota) => ownerShowCota,
      labelOpacity: (ownerShowLabel) => (ownerShowLabel ? 1 : 0),
      cotaOpacity: (ownerShowCota) => (ownerShowCota ? 1 : 0),
    }),
    {
      name: 'geourban.displayLayers.v3',
      storage: createJSONStorage(() => localStorage),
      version: 3,
    },
  ),
);