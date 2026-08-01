//! Puente entre Tauri y el crate `geourban-geo`.
//!
//! Fase 2.5.a (auditoria-para-mejora.md, §6): expone como comandos Tauri
//! reales los tres tipos de request que hoy resuelve exclusivamente
//! `src/workers/geoWorker.ts` del lado JS (JSTS + subdivisionAlgorithms.ts):
//! `subdivide`, `subdivide_manzano` y `subdivide_manzano_batch`. No
//! dependen de GEOS ni de la reconciliación de fragmentos — por eso van
//! primero. `compute_manzanos` (2.5.b, requiere `geos-backend` activado
//! en el `Cargo.toml` raíz — ver src-tauri/Cargo.toml).
//! `compute_road_network_net`/`match_fragments_batch` (2.5.c, requieren
//! cerrar la Fase 2.4) quedan pendientes.

use geourban_geo::{
    boolean_ops::{compute_manzanos, ManzanoFragment},
    DirPref, LotResult, ManzanoLoteMethod, Pt, SubdivisionOptions, SubdivisionResult,
};
use serde::{Deserialize, Serialize};

#[tauri::command]
pub fn geo_engine_version() -> String {
    geourban_geo::crate_version().to_string()
}

/// <- `subdivideInWorker` (src/workers/geoWorkerClient.ts).
///
/// `coordinates` es `polygon.coordinates` de un GeoJSON Polygon (anillo
/// exterior + huecos opcionales), tal cual lo arma `SubdivisionDialog.tsx`
/// vía `GeoJSON.writeGeometryObject`.
#[tauri::command]
pub fn subdivide(coordinates: Vec<Vec<Pt>>, options: SubdivisionOptions) -> SubdivisionResult {
    geourban_geo::subdivision::subdivide(&coordinates, &options)
}

/// <- `subdivideManzanoInWorker`.
#[tauri::command]
pub fn subdivide_manzano(
    ring: Vec<Pt>,
    method: ManzanoLoteMethod,
    target_area_m2: f64,
    front_min_m: f64,
    dir_pref: Option<DirPref>,
) -> Vec<LotResult> {
    let dp = dir_pref.map(|d| (d.ax, d.ay));
    geourban_geo::subdivision::subdivide_manzano(&ring, method, target_area_m2, front_min_m, dp)
}

/// Item de entrada de `subdivide_manzano_batch`. `id` viaja como
/// `serde_json::Value` a propósito: en GeoUrban un id de feature puede ser
/// `string | number` (ver `ManzanoRow.id` en `geo/selectors/manzanoRows.ts`)
/// y acá no se interpreta — solo hace ida y vuelta para que el caller
/// re-matchee cada resultado con el manzano de origen.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubdivideManzanoBatchItem {
    pub id: serde_json::Value,
    pub ring: Vec<Pt>,
    pub method: ManzanoLoteMethod,
    pub target_area_m2: f64,
    pub front_min_m: f64,
    #[serde(default)]
    pub dir_pref: Option<DirPref>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubdivideManzanoBatchResult {
    pub id: serde_json::Value,
    pub lots: Vec<LotResult>,
}

/// <- `subdivideManzanoBatchInWorker`.
///
/// Secuencial a propósito (ver auditoria-para-mejora.md §2.5.a): ya corre
/// en el threadpool de comandos de Tauri, fuera del hilo de la UI del
/// webview, así que el salto de rendimiento contra JSTS/polygon-clipping
/// ya es sustancial sin paralelizar. Paralelizar con `rayon` queda como
/// mejora incremental, no como bloqueante de este cableado.
#[tauri::command]
pub fn subdivide_manzano_batch(
    manzanos: Vec<SubdivideManzanoBatchItem>,
) -> Vec<SubdivideManzanoBatchResult> {
    manzanos
        .into_iter()
        .map(|m| {
            let dp = m.dir_pref.map(|d| (d.ax, d.ay));
            let lots = geourban_geo::subdivision::subdivide_manzano(
                &m.ring,
                m.method,
                m.target_area_m2,
                m.front_min_m,
                dp,
            );
            SubdivideManzanoBatchResult { id: m.id, lots }
        })
        .collect()
}

// ─── Fase 2.5.b — computeManzanos (requiere feature `geos-backend`) ────

/// Item de entrada para `compute_manzanos_cmd`.
///
/// `parcels` son las parcelas crudas (cada una con su anillo exterior y
/// opcionalmente huecos). `road_network` es la lista de polígonos de la
/// red vial (calzadas + vereda externa); cada anillo se trata como un
/// polígono independiente que se une internamente con GEOS antes de
/// recortar las parcelas.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeManzanosItem {
    /// `polygon.coordinates` (exterior + huecos) de cada parcela.
    pub parcels: Vec<Vec<Vec<Pt>>>,
    /// Anillos de la red vial cruda (sin subdividir por tipo). Cada anillo
    /// se convierte en un polígono individual antes de la unión topológica.
    pub road_network: Vec<Vec<Pt>>,
}

/// <- `computeManzanosInWorker` (src/workers/geoWorkerClient.ts).
///
/// Esta función corre enteramente en el backend Rust: sanitiza, une la
/// red vial con GEOS (`unary_union`), recorta cada parcela con
/// `difference`, separa los componentes resultantes y devuelve los
/// fragmentos como `Vec<Vec<Pt>>` por parcela.
///
/// Es **idempotente**: llamarla dos veces con el mismo input da el mismo
/// output. Internamente cae en retry con auto-limpieza si la primera
/// unión falla por geometría degenerada (ver `union_polygons_with_retry`
/// en boolean_ops.rs).
#[tauri::command]
pub fn compute_manzanos_cmd(
    parcels: Vec<Vec<Vec<Pt>>>,
    road_network: Vec<Vec<Pt>>,
) -> Vec<ManzanoFragment> {
    compute_manzanos(&parcels, &road_network)
}

/// Variante batch — procesa varios `ComputeManzanosItem` en una sola
/// invocación Tauri. Secuencial por la misma razón que
/// `subdivide_manzano_batch`: ya corre fuera del hilo de UI y la mejora
/// de paralelizar con `rayon` es incremental.
#[tauri::command]
pub fn compute_manzanos_batch(items: Vec<ComputeManzanosItem>) -> Vec<Vec<ManzanoFragment>> {
    items
        .into_iter()
        .map(|item| compute_manzanos(&item.parcels, &item.road_network))
        .collect()
}
