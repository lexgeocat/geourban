import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type OverlayLayerId = 'urbanizacion' | 'georreferenciado' | 'vertices';

export interface OverlayLayerConfig {
  visible: boolean;
  opacity: number;
  strokeColor: string;
  fillColor: string;
  /** Nombre / número (gatea además por el master "Etiquetas"). */
  showLabel: boolean;
  /** Longitudes / superficies / coordenadas (gatea además por "Acotaciones"). */
  showCota: boolean;
}

export interface MasterToggleConfig {
  enabled: boolean;
  opacity: number;
  strokeColor: string;
  fillColor: string;
  /** Solo aplica al master "Acotaciones": fondo detrás del número. */
  showBackground: boolean;
  /** Solo aplica al master "Etiquetas": no ocultarlas durante pan/zoom. */
  showWhileInteracting: boolean;
}

type MasterKey = 'labels' | 'cotas';

interface DisplayLayersState {
  overlays: Record<OverlayLayerId, OverlayLayerConfig>;
  labels: MasterToggleConfig;
  cotas: MasterToggleConfig;

  setOverlayVisible: (id: OverlayLayerId, v: boolean) => void;
  setOverlayOpacity: (id: OverlayLayerId, v: number) => void;
  setOverlayStrokeColor: (id: OverlayLayerId, c: string) => void;
  setOverlayFillColor: (id: OverlayLayerId, c: string) => void;
  setOverlayOption: (id: OverlayLayerId, key: 'showLabel' | 'showCota', v: boolean) => void;

  setMasterEnabled: (which: MasterKey, v: boolean) => void;
  setMasterOpacity: (which: MasterKey, v: number) => void;
  setMasterStrokeColor: (which: MasterKey, c: string) => void;
  setMasterFillColor: (which: MasterKey, c: string) => void;
  setMasterOption: (which: MasterKey, key: 'showBackground' | 'showWhileInteracting', v: boolean) => void;

  /** Combina el master + el flag de la capa dueña. */
  isLabelVisible: (ownerShowLabel: boolean) => boolean;
  isCotaVisible: (ownerShowCota: boolean) => boolean;
  /** Igual que arriba, pero devuelve la opacidad efectiva (0 si está apagado). */
  labelOpacity: (ownerShowLabel: boolean) => number;
  cotaOpacity: (ownerShowCota: boolean) => number;
}

const DEFAULT_OVERLAYS: Record<OverlayLayerId, OverlayLayerConfig> = {
  urbanizacion: { visible: true, opacity: 1, strokeColor: '#00d4ff', fillColor: '#00d4ff', showLabel: false, showCota: true },
  georreferenciado: { visible: true, opacity: 1, strokeColor: '#3fb950', fillColor: '#3fb950', showLabel: false, showCota: true },
  vertices: { visible: true, opacity: 1, strokeColor: '#f59e0b', fillColor: '#f59e0b', showLabel: true, showCota: false },
};

const DEFAULT_MASTER_LABELS: MasterToggleConfig = {
  enabled: true, opacity: 1, strokeColor: '#dffcff', fillColor: '#0d1117',
  showBackground: true, showWhileInteracting: false,
};

const DEFAULT_MASTER_COTAS: MasterToggleConfig = {
  enabled: true, opacity: 1, strokeColor: '#38bdf8', fillColor: '#0d1117',
  showBackground: true, showWhileInteracting: false,
};

export const useDisplayLayersStore = create<DisplayLayersState>()(
  persist(
    (set, get) => ({
      overlays: { ...DEFAULT_OVERLAYS },
      labels: { ...DEFAULT_MASTER_LABELS },
      cotas: { ...DEFAULT_MASTER_COTAS },

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

      setMasterEnabled: (which, v) => set((s) => ({ [which]: { ...s[which], enabled: v } }) as any),
      setMasterOpacity: (which, v) => set((s) => ({ [which]: { ...s[which], opacity: Math.max(0, Math.min(1, v)) } }) as any),
      setMasterStrokeColor: (which, c) => set((s) => ({ [which]: { ...s[which], strokeColor: c } }) as any),
      setMasterFillColor: (which, c) => set((s) => ({ [which]: { ...s[which], fillColor: c } }) as any),
      setMasterOption: (which, key, v) => set((s) => ({ [which]: { ...s[which], [key]: v } }) as any),

      isLabelVisible: (ownerShowLabel) => get().labels.enabled && ownerShowLabel,
      isCotaVisible: (ownerShowCota) => get().cotas.enabled && ownerShowCota,
      labelOpacity: (ownerShowLabel) => (get().labels.enabled && ownerShowLabel ? get().labels.opacity : 0),
      cotaOpacity: (ownerShowCota) => (get().cotas.enabled && ownerShowCota ? get().cotas.opacity : 0),
    }),
    {
      name: 'geourban.displayLayers.v2',
      storage: createJSONStorage(() => localStorage),
      version: 2,
    },
  ),
);