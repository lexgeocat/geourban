import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

type NativeGeoEngineState = {
  /**
   * Fase 2.5.a (auditoria-para-mejora.md) — cuando está en `true`, las
   * operaciones de subdivisión (`subdivide` / `subdivideManzano` /
   * `subdivideManzanoBatch`) se resuelven vía comando Tauri nativo (crate
   * `geourban-geo`) en lugar del Web Worker JS (JSTS +
   * subdivisionAlgorithms.ts). Pensado para hacer A/B manual dentro de la
   * app mientras no hay benchmark automatizado (Fase 2.6).
   *
   * Si `invoke()` falla (build web sin Tauri, comando no registrado, etc.)
   * `geoWorkerClient.ts` cae automáticamente al worker JS — este flag solo
   * expresa preferencia, nunca bloquea el flujo si el motor nativo no está
   * disponible.
   */
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  toggle: () => void;
};

export const useNativeGeoEngineStore = create<NativeGeoEngineState>()(
  persist(
    (set) => ({
      enabled: false,
      setEnabled: (v) => set({ enabled: v }),
      toggle: () => set((s) => ({ enabled: !s.enabled })),
    }),
    {
      name: 'geourban.nativeGeoEngine.v1',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
);