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
    spatial::{IndexedEnvelope, SpatialIndex},
    CornerMode, DirPref, LotResult, ManzanoLoteMethod, Pt, RoundaboutParams, Street,
    SubdivisionOptions, SubdivisionResult,
};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

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

// ─── Fase 4.1 — índice espacial nativo (rstar) ─────────────────────────
// Consulta de viewport del lado Rust (auditoria-para-mejora.md §6, Fase 4).
// El índice se hidrata con bulk-load STR (`RTree::bulk_load`, criterio
// §7.4) y se consulta por comando — espejo del `SpatialIndex` JS
// (`src/map/spatialIndex.ts`) para proyectos grandes.
//
// `id` viaja como `serde_json::Value` a propósito: en GeoUrban un id de
// feature puede ser `string | number` y acá no se interpreta — solo hace
// ida y vuelta (mismo criterio que `SubdivideManzanoBatchItem`).

pub struct SpatialIndexState(pub Mutex<Option<SpatialIndex>>);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialIndexLoadItem {
    pub id: serde_json::Value,
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

/// <- `spatialIndexLoadInWorker` (src/workers/geoWorkerClient.ts).
/// Reemplaza el índice entero con bulk-load. Devuelve la cantidad de items.
#[tauri::command]
pub fn spatial_index_load(
    state: State<'_, SpatialIndexState>,
    items: Vec<SpatialIndexLoadItem>,
) -> Result<usize, String> {
    let index = SpatialIndex::bulk_load(
        items
            .into_iter()
            .map(|it| IndexedEnvelope::new(it.id, it.min_x, it.min_y, it.max_x, it.max_y))
            .collect(),
    );
    let len = index.len();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = Some(index);
    Ok(len)
}

/// <- `spatialIndexClearInWorker`. Descarta el índice (p. ej. al cerrar
/// proyecto o volver a un dataset donde manda el RBush JS).
#[tauri::command]
pub fn spatial_index_clear(state: State<'_, SpatialIndexState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialIndexQueryResult {
    /// Ids de features cuyo bbox intersecta el extent consultado.
    pub ids: Vec<serde_json::Value>,
    pub hit_count: usize,
    /// Tiempo de la búsqueda dentro de Rust (sin contar IPC).
    pub query_ms: f64,
}

/// <- `spatialIndexQueryInWorker`. Consulta de viewport: devuelve ids,
/// no geometrías — el caller resuelve cada feature en su propia capa.
#[tauri::command]
pub fn spatial_index_query(
    state: State<'_, SpatialIndexState>,
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
) -> Result<SpatialIndexQueryResult, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let Some(index) = guard.as_ref() else {
        return Err("índice espacial no cargado — invocar spatial_index_load primero".into());
    };
    let t0 = std::time::Instant::now();
    let mut ids = Vec::new();
    index.search(min_x, min_y, max_x, max_y, &mut ids);
    let query_ms = t0.elapsed().as_secs_f64() * 1000.0;
    let hit_count = ids.len();
    Ok(SpatialIndexQueryResult {
        ids,
        hit_count,
        query_ms,
    })
}
