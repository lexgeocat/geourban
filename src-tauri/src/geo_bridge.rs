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
#[tauri::command]
pub fn subdivide(coordinates: Vec<Vec<Pt>>, options: SubdivisionOptions) -> SubdivisionResult {
    geourban_geo::subdivision::subdivide(&coordinates, &options)
}
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputeManzanosItem {
    pub parcels: Vec<Vec<Vec<Pt>>>,
    pub road_network: Vec<Vec<Pt>>,
}

#[tauri::command]
pub fn compute_manzanos_cmd(
    parcels: Vec<Vec<Vec<Pt>>>,
    road_network: Vec<Vec<Pt>>,
) -> Vec<ManzanoFragment> {
    compute_manzanos(&parcels, &road_network)
}

#[tauri::command]
pub fn compute_manzanos_batch(items: Vec<ComputeManzanosItem>) -> Vec<Vec<ManzanoFragment>> {
    items
        .into_iter()
        .map(|item| compute_manzanos(&item.parcels, &item.road_network))
        .collect()
}

#[tauri::command]
pub fn compute_road_network_net_cmd(
    streets: Vec<Street>,
    roundabouts: Vec<RoundaboutParams>,
    corner_mode: CornerMode,
) -> RoadNetworkNet {
    compute_road_network_net(&streets, &roundabouts, corner_mode)
}

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

pub struct SpatialIndexState(pub Mutex<std::collections::HashMap<String, SpatialIndex>>);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialIndexLoadItem {
    pub id: serde_json::Value,
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

#[tauri::command]
pub fn spatial_index_load(
    state: State<'_, SpatialIndexState>,
    slot: String,
    items: Vec<SpatialIndexLoadItem>,
) -> Result<usize, String> {
    let envelopes: Vec<IndexedEnvelope> = items
        .into_iter()
        .filter_map(|it| {
            if !it.min_x.is_finite()
                || !it.min_y.is_finite()
                || !it.max_x.is_finite()
                || !it.max_y.is_finite()
            {
                log::warn!(
                    "spatial_index_load[{slot}]: item con bbox no-finito descartado (id={:?})",
                    it.id
                );
                return None;
            }
            Some(IndexedEnvelope::new(
                it.id, it.min_x, it.min_y, it.max_x, it.max_y,
            ))
        })
        .collect();
    let index = SpatialIndex::bulk_load(envelopes);
    let len = index.len();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.insert(slot, index);
    Ok(len)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialIndexUpsertItem {
    pub id: serde_json::Value,
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

#[tauri::command]
pub fn spatial_index_upsert_batch(
    state: State<'_, SpatialIndexState>,
    slot: String,
    items: Vec<SpatialIndexUpsertItem>,
) -> Result<usize, String> {
    let envelopes: Vec<IndexedEnvelope> = items
        .into_iter()
        .filter_map(|it| {
            if !it.min_x.is_finite()
                || !it.min_y.is_finite()
                || !it.max_x.is_finite()
                || !it.max_y.is_finite()
            {
                log::warn!(
                    "spatial_index_upsert_batch[{slot}]: item con bbox no-finito descartado (id={:?})",
                    it.id
                );
                return None;
            }
            Some(IndexedEnvelope::new(
                it.id, it.min_x, it.min_y, it.max_x, it.max_y,
            ))
        })
        .collect();

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let index = guard.entry(slot).or_insert_with(SpatialIndex::default);
    index.insert_many(envelopes);
    Ok(index.len())
}

#[tauri::command]
pub fn spatial_index_remove_batch(
    state: State<'_, SpatialIndexState>,
    slot: String,
    ids: Vec<serde_json::Value>,
) -> Result<usize, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let Some(index) = guard.get_mut(&slot) else {
        return Ok(0);
    };
    Ok(index.remove_many(&ids))
}

#[tauri::command]
pub fn spatial_index_clear(
    state: State<'_, SpatialIndexState>,
    slot: String,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    guard.remove(&slot);
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialIndexQueryResult {
    pub ids: Vec<serde_json::Value>,
    pub hit_count: usize,
    pub query_ms: f64,
}

fn validate_finite_bbox(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Result<(), String> {
    if !min_x.is_finite() || !min_y.is_finite() || !max_x.is_finite() || !max_y.is_finite() {
        return Err(format!(
            "bbox de consulta no-finito (minX={min_x}, minY={min_y}, maxX={max_x}, maxY={max_y})"
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn spatial_index_query(
    state: State<'_, SpatialIndexState>,
    slot: String,
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
) -> Result<SpatialIndexQueryResult, String> {
    validate_finite_bbox(min_x, min_y, max_x, max_y)
        .map_err(|e| format!("spatial_index_query[{slot}]: {e}"))?;

    let guard = state.0.lock().map_err(|e| e.to_string())?;
    let Some(index) = guard.get(&slot) else {
        return Ok(SpatialIndexQueryResult {
            ids: Vec::new(),
            hit_count: 0,
            query_ms: 0.0,
        });
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
