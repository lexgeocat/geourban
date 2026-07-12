import { create } from 'zustand';
import { DEFAULT_SNAP_SETTINGS, type SnapSettings, type SnapType } from '../map/advancedSnap';

type SnapSettingsState = {
  settings: SnapSettings;
  toggle: (key: SnapType) => void;
  setAll: (value: boolean) => void;
};

export const useSnapSettingsStore = create<SnapSettingsState>()((set) => ({
  settings: { ...DEFAULT_SNAP_SETTINGS },
  toggle: (key) =>
    set((state) => ({
      settings: { ...state.settings, [key]: !state.settings[key] },
    })),
  setAll: (value) =>
    set((state) => ({
      settings: Object.fromEntries(
        Object.keys(state.settings).map((k) => [k, value])
      ) as SnapSettings,
    })),
}));