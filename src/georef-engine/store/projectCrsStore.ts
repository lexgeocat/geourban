// src/store/project/projectCrsStore.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  ensureUtmZoneRegistered,
  utmZoneFromLonLat,
  type UtmHemisphere,
  type ProjectCrsMode,
  type ProjectCrsConfig,
} from '../../geo/crs/utmZones';
import { invalidateAffineCache } from '../../geo/crs/affineCache';

export type { ProjectCrsMode };

interface ProjectCrsState extends ProjectCrsConfig {
  /** Gate de ProjectSetupModal: false hasta que el usuario elige CRS explícitamente. */
  confirmed: boolean;
  /** null en modo 'none' — no hay EPSG real que anclar. */
  exportEpsg: string | null;

  setMode: (mode: ProjectCrsMode) => void;
  setUtmZone: (zone: number, hemisphere: UtmHemisphere) => void;
  autoDetectFromLonLat: (lon: number, lat: number) => void;
  confirm: () => void;
  loadConfig: (config: ProjectCrsConfig) => void;
  requestReconfigure: () => void;
}

function computeExportEpsg(mode: ProjectCrsMode, zone: number, hemisphere: UtmHemisphere): string | null {
  return mode === 'utm' ? ensureUtmZoneRegistered(zone, hemisphere) : null;
}

export const useProjectCrsStore = create<ProjectCrsState>()(
  immer((set) => ({
    mode: 'utm',
    utmZone: 19,
    utmHemisphere: 'S',
    confirmed: false,
    exportEpsg: null,

    setMode: (mode) =>
      set((state) => {
        state.mode = mode;
        state.exportEpsg = computeExportEpsg(mode, state.utmZone, state.utmHemisphere);
        // Al fijar/cambiar el modo de CRS, la matriz afín cacheada (ajustada
        // para el EPSG/extent anteriores) deja de ser válida; se invalida
        // explícitamente en vez de esperar a que el próximo cálculo la
        // detecte stale por key mismatch.
        invalidateAffineCache();
      }),

    setUtmZone: (zone, hemisphere) =>
      set((state) => {
        state.utmZone = zone;
        state.utmHemisphere = hemisphere;
        state.exportEpsg = computeExportEpsg(state.mode, zone, hemisphere);
        invalidateAffineCache();
      }),

    autoDetectFromLonLat: (lon, lat) =>
      set((state) => {
        const { zone, hemisphere } = utmZoneFromLonLat(lon, lat);
        state.utmZone = zone;
        state.utmHemisphere = hemisphere;
        state.exportEpsg = computeExportEpsg(state.mode, zone, hemisphere);
        invalidateAffineCache();
      }),

    confirm: () => set((state) => { state.confirmed = true; }),

    loadConfig: (config) =>
      set((state) => {
        state.mode = config.mode;
        state.utmZone = config.utmZone;
        state.utmHemisphere = config.utmHemisphere;
        state.exportEpsg = computeExportEpsg(config.mode, config.utmZone, config.utmHemisphere);
        state.confirmed = true;
        invalidateAffineCache();
      }),

    requestReconfigure: () => set((state) => { state.confirmed = false; }),
  }))
);