//! Tipos compartidos entre el motor nativo y el resto del proyecto.
//!
//! El "shape" de cada tipo espeja deliberadamente a su contraparte en
//! `src/geo/**/*.ts` para que la serializacion JSON (decision de Fase 2.0:
//! serde + JSON sobre el limite Tauri<->React — ver auditoria-para-mejora.md
//! §Fase 2 / 2.0) no necesite tablas de traduccion en ninguno de los dos
//! lados. Si cambia un campo aca, cambia tambien en el .ts correspondiente
//! — y viceversa.

use serde::{Deserialize, Serialize};

/// Espeja `Pt` en `polygonEngine.ts` (`[number, number]`). Un tuple de f64
/// serializa como array JSON de 2 elementos, igual que el lado TS.
pub type Pt = (f64, f64);

/// Espeja `LotResult` (polygonEngine.ts).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LotResult {
    pub pts: Vec<Pt>,
    pub is_remnant: bool,
    pub front_m: f64,
    pub depth_m: f64,
    pub area_m2: f64,
}

/// Espeja `CutResult` (polygonEngine.ts) — usado internamente por
/// `computeCuts`/`subdivideHalf` en subdivisionAlgorithms.ts.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutResult {
    pub t: f64,
    pub is_remnant: bool,
}

/// Espeja `SliceResult` (polygonEngine.ts) — resultado de
/// `sliceBisectManzano` (metodo `manual-slice`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceResult {
    pub front: Vec<Pt>,
    pub rest: Vec<Pt>,
    pub area_m2: f64,
}

/// Espeja `SubdivisionMethod` (subdivisionAlgorithms.ts):
/// `'auto' | 'modo2' | 'exact' | 'manual-slice'`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SubdivisionMethod {
    Auto,
    Modo2,
    Exact,
    ManualSlice,
}

/// Espeja `ManzanoLoteMethod` (subdivisionAlgorithms.ts):
/// `'auto' | 'exact' | 'modo2'`. Subconjunto de `SubdivisionMethod` sin la
/// variante manual — se mantiene como tipo separado para conservar la
/// misma distincion que hace el TS (RecomputeManzanoLotsCommand,
/// GenerateLotsCommand, etc. nunca reciben `'manual-slice'`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ManzanoLoteMethod {
    Auto,
    Exact,
    Modo2,
}

/// Direccion preferida de corte (`dirPref` en subdivisionAlgorithms.ts /
/// `RotateDir` en manzanoStore.ts).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirPref {
    pub ax: f64,
    pub ay: f64,
}

/// Segmento auxiliar para el metodo manual-slice (`frenteSeg`/`auxSeg` en
/// SubdivisionOptions).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub a: Pt,
    pub b: Pt,
}

/// Linea de corte directa (`cutLine` en SubdivisionOptions).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CutLine {
    pub p1: Pt,
    pub p2: Pt,
}

/// Espeja `SubdivisionOptions` (subdivisionAlgorithms.ts). Los campos
/// opcionales lo son porque distintos metodos usan distintos subconjuntos,
/// igual que en TS.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubdivisionOptions {
    pub method: SubdivisionMethod,
    pub target_area_m2: Option<f64>,
    pub front_min_m: Option<f64>,
    pub dir_ax: Option<f64>,
    pub dir_ay: Option<f64>,
    pub frente_seg: Option<Segment>,
    pub aux_seg: Option<Segment>,
    pub cut_line: Option<CutLine>,
}

/// Espeja `SubdivisionResult` (subdivisionAlgorithms.ts).
///
/// El campo `features` queda como `serde_json::Value` hasta Fase 2.2:
/// recien ahi se define el tipo GeoJSON `Feature<Polygon | MultiPolygon>`
/// del lado Rust (a evaluar si conviene el crate `geojson` o un struct
/// propio — decision de esa fase, no de esta).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubdivisionResult {
    pub ok: bool,
    pub features: Vec<serde_json::Value>,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Espeja `CornerMode` (ringFillet.ts): `'fillet' | 'chamfer' | 'none'`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CornerMode {
    Fillet,
    Chamfer,
    None,
}

/// Espeja `RoundaboutParams` (roundaboutEngine.ts).
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

/// Espeja `RoundaboutGeometry` (roundaboutEngine.ts) — anillos ya
/// resueltos, listos para pintar/exportar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundaboutGeometry {
    pub road_outer: Vec<Pt>,
    pub side_outer: Vec<Pt>,
    pub island: Option<Vec<Pt>>,
    pub center_axis: Vec<Pt>,
}

/// Espeja `Street` (store/entities/streetStore.ts). Se define aca desde ya
/// (aunque recien se use a partir de Fase 2.3, union de red vial) porque es
/// un tipo de dominio compartido, no una particularidad de un modulo.
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Fija el contrato de serializacion: un `Pt` tiene que viajar como
    /// array JSON de 2 numeros, no como objeto `{"0": x, "1": y}`. Test de
    /// regresion — si algun cambio de serde/versionado lo rompe, esto
    /// avisa antes de que se note del lado TS.
    #[test]
    fn pt_serializa_como_array_json() {
        let p: Pt = (1.5, -2.25);
        let json = serde_json::to_string(&p).unwrap();
        assert_eq!(json, "[1.5,-2.25]");
    }

    #[test]
    fn subdivision_method_usa_kebab_case_igual_que_ts() {
        let json = serde_json::to_string(&SubdivisionMethod::ManualSlice).unwrap();
        assert_eq!(json, "\"manual-slice\"");
    }

    #[test]
    fn manzano_lote_method_usa_lowercase_igual_que_ts() {
        let json = serde_json::to_string(&ManzanoLoteMethod::Modo2).unwrap();
        assert_eq!(json, "\"modo2\"");
    }

    #[test]
    fn corner_mode_usa_lowercase_igual_que_ts() {
        let json = serde_json::to_string(&CornerMode::None).unwrap();
        assert_eq!(json, "\"none\"");
    }

    /// SubdivisionOptions con solo `method` fijado tiene que serializar los
    /// opcionales como `null`, igual que TS con campos `undefined` — no se
    /// omiten (a diferencia de `error` en SubdivisionResult, que si usa
    /// `skip_serializing_if`). Esto importa porque el lado TS de
    /// `SubdivisionOptions` no marca esos campos como omitibles.
    #[test]
    fn subdivision_options_minimas_serializan_opcionales_como_null() {
        let opts = SubdivisionOptions {
            method: SubdivisionMethod::Auto,
            target_area_m2: Some(250.0),
            front_min_m: Some(12.0),
            dir_ax: None,
            dir_ay: None,
            frente_seg: None,
            aux_seg: None,
            cut_line: None,
        };
        let json = serde_json::to_string(&opts).unwrap();
        assert!(json.contains("\"dirAx\":null"));
        assert!(json.contains("\"method\":\"auto\""));
    }
}
