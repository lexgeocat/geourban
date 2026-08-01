import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

type NativeGeoEngineState = {
  /**
   * Fase 2.5/2.7 (auditoria-para-mejora.md) — cuando está en `true`, las
   * operaciones de geometría se resuelven vía comando Tauri nativo (crate
   * `geourban-geo`) en lugar del Web Worker JS (JSTS + polygon-clipping).
   * Default `true` desde Fase 2.7: el motor nativo pasa a ser la vía
   * primaria en runtime Tauri (`isTauriRuntime()` sigue siendo requisito
   * — en build web puro esto no tiene efecto y siempre corre el worker
   * JS). Si `invoke()` falla, `geoWorkerClient.ts` cae automáticamente
   * al worker JS — este flag solo expresa preferencia.
   */
  enabled: boolean;
  /**
   * Fase 2.7 — validación en sombra: cuando el motor nativo resuelve una
   * operación con éxito, con probabilidad `shadowSampleRate` se corre
   * EN PARALELO (sin bloquear la respuesta al usuario) el mismo cómputo
   * en el motor JS de referencia, y se comparan resúmenes con
   * tolerancia. Las discrepancias quedan en `nativeEngineTelemetry.ts` y
   * visibles en el panel de debug. Es el mecanismo concreto para
   * "validar la paridad en la app real con datos de producción" sin
   * retirar el motor JS todavía.
   */
  shadowValidationEnabled: boolean;
  /** Fracción (0..1) de operaciones nativas que además corren en sombra. */
  shadowSampleRate: number;
  setEnabled: (v: boolean) => void;
  toggle: () => void;
  setShadowValidationEnabled: (v: boolean) => void;
  setShadowSampleRate: (v: number) => void;
};

export const useNativeGeoEngineStore = create<NativeGeoEngineState>()(
  persist(
    (set) => ({
      enabled: true,
      shadowValidationEnabled: true,
      shadowSampleRate: 0.15,
      setEnabled: (v) => set({ enabled: v }),
      toggle: () => set((s) => ({ enabled: !s.enabled })),
      setShadowValidationEnabled: (v) => set({ shadowValidationEnabled: v }),
      setShadowSampleRate: (v) => set({ shadowSampleRate: Math.max(0, Math.min(1, v)) }),
    }),
    {
      name: 'geourban.nativeGeoEngine.v1',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        const state = (persistedState ?? {}) as Partial<NativeGeoEngineState>;
        if (version < 2) {
          // Fase 2.7: el motor nativo pasa a ser el default de
          // producción. Con el esquema v1 no hay forma de distinguir
          // "nunca lo tocó" de "lo apagó a mano" (ambos guardaban
          // `false`, que era el default viejo), así que se sobreescribe
          // explícitamente — es el criterio de negocio de esta fase.
          return {
            ...state,
            enabled: true,
            shadowValidationEnabled: true,
            shadowSampleRate: state.shadowSampleRate ?? 0.15,
          };
        }
        return state as NativeGeoEngineState;
      },
    },
  ),
);