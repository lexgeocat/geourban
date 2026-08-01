//! Puente entre Tauri y el crate `geourban-geo`.
//!
//! Fase 2.5 (auditoria-para-mejora.md, §6): expone como comandos Tauri
//! reales los seis tipos de request que resolvía exclusivamente
//! `src/workers/geoWorker.ts` del lado JS (JSTS + polygon-clipping):
//!
//!   - `subdivide` / `subdivide_manzano` / `subdivide_manzano_batch` (2.5.a)
//!   - `compute_manzanos_cmd` / `compute_manzanos_batch` (2.5.b)
//!   - `compute_road_network_net_cmd` / `match_fragments_batch` (2.5.c —
//!     cierra la Fase 2; dependían de `fragment_reconciliation.rs`)

use geourban_geo::{
    boolean_ops::{compute_manzanos, compute_road_network_net, ManzanoFragment, RoadNetworkNet},
    fragment_reconciliation::{match_fragments_to_members, FragmentAssignment},
    CornerMode, DirPref, LotResult, ManzanoLoteMethod, Pt, RoundaboutParams, Street,
    SubdivisionOptions, SubdivisionResult,
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
/// `string | number` y acá no se interpreta — solo hace ida y vuelta para
/// que el caller re-matchee cada resultado con el manzano de origen.
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

/// Item de entrada para `compute_manzanos_batch`.
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
/// Corre enteramente en el backend Rust: sanitiza, une la red vial con
/// GEOS (`unary_union`), recorta cada parcela con `difference`, separa
/// los componentes resultantes y devuelve los fragmentos como
/// `Vec<Vec<Pt>>` por parcela. Idempotente.
#[tauri::command]
pub fn compute_manzanos_cmd(
    parcels: Vec<Vec<Vec<Pt>>>,
    road_network: Vec<Vec<Pt>>,
) -> Vec<ManzanoFragment> {
    compute_manzanos(&parcels, &road_network)
}

/// Variante batch — procesa varios `ComputeManzanosItem` en una sola
/// invocación Tauri.
#[tauri::command]
pub fn compute_manzanos_batch(items: Vec<ComputeManzanosItem>) -> Vec<Vec<ManzanoFragment>> {
    items
        .into_iter()
        .map(|item| compute_manzanos(&item.parcels, &item.road_network))
        .collect()
}

// ─── Fase 2.5.c — red vial + reconciliación de fragmentos ──────────────
// Cierra la Fase 2 (auditoria-para-mejora.md §6, Fase 2.4/2.5.c).

/// <- `computeRoadNetworkNetInWorker`.
#[tauri::command]
pub fn compute_road_network_net_cmd(
    streets: Vec<Street>,
    roundabouts: Vec<RoundaboutParams>,
    corner_mode: CornerMode,
) -> RoadNetworkNet {
    compute_road_network_net(&streets, &roundabouts, corner_mode)
}

/// Item de entrada de `match_fragments_batch`. `group_idx` es un índice
/// opaco que el caller usa para re-matchear cada resultado con su grupo
/// de origen (mismo criterio que `recomputeManzanos.ts` ya usa índices
/// numéricos para agrupar parcelas).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchFragmentsBatchItem {
    pub group_idx: usize,
    pub fragments: Vec<Vec<Pt>>,
    pub member_rings: Vec<Vec<Pt>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchFragmentsBatchResult {
    pub group_idx: usize,
    pub assignments: Vec<FragmentAssignment>,
}

/// <- `matchFragmentsBatchInWorker`.
///
/// Secuencial a propósito, mismo criterio que `subdivide_manzano_batch` y
/// `compute_manzanos_batch`: ya corre fuera del hilo de UI del webview.
#[tauri::command]
pub fn match_fragments_batch(
    items: Vec<MatchFragmentsBatchItem>,
) -> Vec<MatchFragmentsBatchResult> {
    items
        .into_iter()
        .map(|item| {
            let assignments = match_fragments_to_members(&item.fragments, &item.member_rings);
            MatchFragmentsBatchResult {
                group_idx: item.group_idx,
                assignments,
            }
        })
        .collect()
}
