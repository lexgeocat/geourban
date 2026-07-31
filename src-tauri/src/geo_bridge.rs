//! Puente minimo entre Tauri y el crate `geourban-geo`.
//!
//! Fase 2.0: un unico comando de diagnostico para verificar, desde la UI,
//! que el motor de geometria nativo esta compilado y linkeado dentro del
//! binario. Las Fases 2.1-2.5 van a ir agregando aca los comandos reales
//! (subdivide, compute_manzanos, subdivide_manzano_batch,
//! compute_road_network_net, match_fragments_batch) que hoy resuelve
//! `src/workers/geoWorker.ts` del lado JS — mismo criterio de nombres que
//! usa `src-tauri/src/project_store.rs` para sus comandos.

#[tauri::command]
pub fn geo_engine_version() -> String {
    geourban_geo::crate_version().to_string()
}
