import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export type NativeRuntimeEnv = 'tauri' | 'web' | 'test';

export interface NativeRuntime {
  env: NativeRuntimeEnv;
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

export function requireNativeRuntime(): NativeRuntime | null {
  const hasTauri =
    typeof window !== 'undefined' &&
    // @ts-expect-error — globals de runtime Tauri no tipados en DOM lib
    Boolean(window.__TAURI_INTERNALS__);

  if (!hasTauri) return null;

  return {
    env: 'tauri',
    invoke: <T>(cmd: string, args?: Record<string, unknown>) => tauriInvoke<T>(cmd, args),
  };
}
