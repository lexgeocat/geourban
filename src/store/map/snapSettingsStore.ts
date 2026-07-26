import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_SNAP_SETTINGS, type SnapSettings, type SnapType } from '../map/advancedSnap';

type SnapSettingsState = {
  /** Master switch — equivalente a F3 en AutoCAD. Con esto en false, TODO snap se ignora. */
  enabled: boolean;
  settings: SnapSettings;
  toggle: (key: SnapType) => void;
  setAll: (value: boolean) => void;
  setEnabled: (value: boolean) => void;
  toggleEnabled: () => void;
};

export const useSnapSettingsStore = create<SnapSettingsState>()(
  persist(
    (set) => ({
      enabled: true,
      settings: { ...DEFAULT_SNAP_SETTINGS },
      toggle: (key) =>
        set((state) => ({ settings: { ...state.settings, [key]: !state.settings[key] } })),
      setAll: (value) =>
        set((state) => ({
          settings: Object.fromEntries(
            Object.keys(state.settings).map((k) => [k, value])
          ) as SnapSettings,
        })),
      setEnabled: (value) => set({ enabled: value }),
      toggleEnabled: () => set((state) => ({ enabled: !state.enabled })),
    }),
    {
      name: 'geourban.snapSettings.v2',
      storage: createJSONStorage(() => localStorage),
      version: 2,
    }
  )
);

export function getEffectiveSnapSettings(): Partial<SnapSettings> {
  const { enabled, settings } = useSnapSettingsStore.getState();
  if (!enabled) {
    return Object.fromEntries(Object.keys(settings).map((k) => [k, false])) as Partial<SnapSettings>;
  }
  return settings;
}