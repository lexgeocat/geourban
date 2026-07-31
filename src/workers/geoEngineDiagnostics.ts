import { invoke } from '@tauri-apps/api/core';

/**
 * Fase 2.0 — verifica en runtime que el motor de geometría nativo
 * (crate `geourban-geo`) está compilado y accesible desde el frontend.
 *
 * Útil como smoke test manual (consola del navegador / devtools de la
 * ventana Tauri) mientras las Fases 2.1+ todavía no exponen comandos
 * reales de geometría:
 *
 *   import { getGeoEngineVersion } from './workers/geoEngineDiagnostics';
 *   await getGeoEngineVersion(); // "0.1.0"
 */
export async function getGeoEngineVersion(): Promise<string> {
  return invoke<string>('geo_engine_version');
}
