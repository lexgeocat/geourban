use serde::{Deserialize, Serialize};

pub type Pt = (f64, f64);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LotResult {
    pub pts: Vec<Pt>,
    pub is_remnant: bool,
    pub front_m: f64,
    pub depth_m: f64,
    pub area_m2: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutResult {
    pub t: f64,
    pub is_remnant: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceResult {
    pub front: Vec<Pt>,
    pub rest: Vec<Pt>,
    pub area_m2: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ManzanoLoteMethod {
    Auto,
    Exact,
    Modo2,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirPref {
    pub ax: f64,
    pub ay: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CornerMode {
    Fillet,
    Chamfer,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundaboutParams {
    pub center: Pt,
    pub radius_m: f64,
    pub sides: u32,
    pub rotation: f64,
    pub road_width_m: f64,
    pub sidewalk_width_m: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layer_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundaboutGeometry {
    pub road_outer: Vec<Pt>,
    pub side_outer: Vec<Pt>,
    pub island: Option<Vec<Pt>>,
    pub center_axis: Vec<Pt>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Street {
    pub id: String,
    pub start: Pt,
    pub end: Pt,
    pub width_m: f64,
    pub side_width_m: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waypoints: Option<Vec<Pt>>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layer_id: Option<String>,
}
