use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::geojson::{ring_from_json, ring_to_json};
use crate::math::poly_area;
use crate::types::Pt;

const DEFAULT_DEDUPE_EPS: f64 = 1e-4;
const DEFAULT_COLLINEAR_ANGLE_EPS: f64 = 1e-4; // ~0.0057° — solo colinealidad casi perfecta
const DEFAULT_MIN_AREA: f64 = 1e-6;
const MAX_CLEANUP_ITERATIONS_SLACK: usize = 8;

#[derive(Debug, Clone, Copy)]
pub struct SanitizeRingOptions {
    pub dedupe_epsilon: f64,
    pub collinear_angle_epsilon: f64,
    pub min_area: f64,
}

impl Default for SanitizeRingOptions {
    fn default() -> Self {
        Self {
            dedupe_epsilon: DEFAULT_DEDUPE_EPS,
            collinear_angle_epsilon: DEFAULT_COLLINEAR_ANGLE_EPS,
            min_area: DEFAULT_MIN_AREA,
        }
    }
}

fn close_ring(ring: Vec<Pt>) -> Vec<Pt> {
    if ring.is_empty() {
        return ring;
    }
    let first = ring[0];
    let last = *ring.last().unwrap();
    if (first.0 - last.0).abs() > 1e-12 || (first.1 - last.1).abs() > 1e-12 {
        let mut out = ring;
        out.push(first);
        out
    } else {
        ring
    }
}

fn dedupe_consecutive(ring: &[Pt], eps: f64) -> (Vec<Pt>, usize) {
    if ring.is_empty() {
        return (Vec::new(), 0);
    }
    let mut out = vec![ring[0]];
    let mut removed = 0usize;
    for &cur in &ring[1..] {
        let prev = *out.last().unwrap();
        if (cur.0 - prev.0).hypot(cur.1 - prev.1) < eps {
            removed += 1;
            continue;
        }
        out.push(cur);
    }
    (out, removed)
}

fn remove_collinear(ring: &[Pt], angle_eps: f64, closure_eps: f64) -> (Vec<Pt>, usize) {
    let is_closed = ring.len() > 1
        && (ring[0].0 - ring[ring.len() - 1].0).abs() < closure_eps
        && (ring[0].1 - ring[ring.len() - 1].1).abs() < closure_eps;
    let mut pts: Vec<Pt> = if is_closed {
        ring[..ring.len() - 1].to_vec()
    } else {
        ring.to_vec()
    };

    if pts.len() < 3 {
        return (pts, 0);
    }

    let mut removed = 0usize;
    let mut changed = true;
    let mut guard = 0usize;
    let guard_max = pts.len() + MAX_CLEANUP_ITERATIONS_SLACK;

    while changed && pts.len() > 3 && guard < guard_max {
        changed = false;
        guard += 1;

        let mut i = 0usize;
        while i < pts.len() {
            let n = pts.len();
            let a = pts[(i + n - 1) % n];
            let b = pts[i];
            let c = pts[(i + 1) % n];
            let abx = b.0 - a.0;
            let aby = b.1 - a.1;
            let bcx = c.0 - b.0;
            let bcy = c.1 - b.1;
            let len_ab = abx.hypot(aby);
            let len_bc = bcx.hypot(bcy);

            if len_ab < 1e-12 || len_bc < 1e-12 {
                pts.remove(i);
                removed += 1;
                changed = true;
                break;
            }

            let cross = (abx / len_ab) * (bcy / len_bc) - (aby / len_ab) * (bcx / len_bc);
            let dot = (abx / len_ab) * (bcx / len_bc) + (aby / len_ab) * (bcy / len_bc);
            let angle = cross.abs().atan2(dot);

            if angle < angle_eps {
                pts.remove(i);
                removed += 1;
                changed = true;
                break;
            }

            i += 1;
        }
    }

    (pts, removed)
}

fn sanitize_event(
    reason: &str,
    original_count: usize,
    result_count: usize,
    extra: &[(&str, Value)],
) -> Map<String, Value> {
    let mut map = Map::new();
    map.insert("reason".into(), Value::String(reason.into()));
    map.insert("originalCount".into(), Value::from(original_count));
    map.insert("resultCount".into(), Value::from(result_count));
    for (k, v) in extra {
        map.insert((*k).into(), v.clone());
    }
    map
}

fn record_geometry_sanitize_event(context: &str, mut detail: Map<String, Value>) {
    detail.insert("context".into(), Value::String(context.into()));
    log::warn!("[geometry-sanitize] {}", Value::Object(detail));
}

pub fn sanitize_ring(
    ring_in: Option<&[Pt]>,
    opts: SanitizeRingOptions,
    context: &str,
) -> Option<Vec<Pt>> {
    let ring_in = ring_in?;
    if ring_in.len() < 3 {
        return None;
    }

    let original_count = ring_in.len();
    let mut corrected = false;

    let mut pts: Vec<Pt> = ring_in
        .iter()
        .copied()
        .filter(|p| p.0.is_finite() && p.1.is_finite())
        .collect();
    if pts.len() != ring_in.len() {
        corrected = true;
    }
    if pts.len() < 3 {
        record_geometry_sanitize_event(
            context,
            sanitize_event("non_finite_points", original_count, pts.len(), &[]),
        );
        return None;
    }

    let (deduped, removed_dedupe) = dedupe_consecutive(&pts, opts.dedupe_epsilon);
    pts = deduped;
    if removed_dedupe > 0 {
        corrected = true;
    }

    if pts.len() < 3 {
        record_geometry_sanitize_event(
            context,
            sanitize_event(
                "degenerate_after_dedupe",
                original_count,
                pts.len(),
                &[("dedupedPoints", Value::from(removed_dedupe))],
            ),
        );
        return None;
    }

    let (decollinear, removed_collinear) =
        remove_collinear(&pts, opts.collinear_angle_epsilon, opts.dedupe_epsilon);
    pts = decollinear;
    if removed_collinear > 0 {
        corrected = true;
    }

    if pts.len() < 3 {
        record_geometry_sanitize_event(
            context,
            sanitize_event(
                "degenerate_after_collinear_cleanup",
                original_count,
                pts.len(),
                &[
                    ("dedupedPoints", Value::from(removed_dedupe)),
                    ("collinearRemoved", Value::from(removed_collinear)),
                ],
            ),
        );
        return None;
    }

    let area = poly_area(&pts);
    if !area.is_finite() || area <= opts.min_area {
        record_geometry_sanitize_event(
            context,
            sanitize_event(
                "area_below_threshold",
                original_count,
                pts.len(),
                &[
                    ("area", Value::from(area)),
                    ("minArea", Value::from(opts.min_area)),
                ],
            ),
        );
        return None;
    }

    if corrected {
        record_geometry_sanitize_event(
            context,
            sanitize_event(
                "corrected",
                original_count,
                pts.len(),
                &[
                    ("dedupedPoints", Value::from(removed_dedupe)),
                    ("collinearRemoved", Value::from(removed_collinear)),
                ],
            ),
        );
    }

    Some(close_ring(pts))
}

pub fn sanitize_rings(rings: &[Vec<Pt>], opts: SanitizeRingOptions, context: &str) -> Vec<Vec<Pt>> {
    rings
        .iter()
        .filter_map(|r| sanitize_ring(Some(r.as_slice()), opts, context))
        .collect()
}

fn sanitize_polygon_rings(
    coords: &Value,
    context: &str,
    opts: SanitizeRingOptions,
) -> Option<Vec<Vec<Pt>>> {
    let rings_val = coords.as_array()?;
    if rings_val.is_empty() {
        return None;
    }
    let outer_ring = ring_from_json(&rings_val[0])?;
    let outer = sanitize_ring(
        Some(outer_ring.as_slice()),
        opts,
        &format!("{context}.outer"),
    )?;

    let mut rings = vec![outer];
    for hole_val in &rings_val[1..] {
        if let Some(hole_ring) = ring_from_json(hole_val) {
            if let Some(hole) =
                sanitize_ring(Some(hole_ring.as_slice()), opts, &format!("{context}.hole"))
            {
                rings.push(hole);
            }
        }
    }
    Some(rings)
}

fn sanitize_geometry(geom: &Value, context: &str, opts: SanitizeRingOptions) -> Option<Value> {
    let geom_type = geom.get("type")?.as_str()?;
    match geom_type {
        "Polygon" => {
            let coords = geom.get("coordinates")?;
            let rings = sanitize_polygon_rings(coords, context, opts)?;
            Some(json!({
                "type": "Polygon",
                "coordinates": rings.iter().map(|r| ring_to_json(r)).collect::<Vec<_>>(),
            }))
        }
        "MultiPolygon" => {
            let polys_val = geom.get("coordinates")?.as_array()?;
            let mut polys: Vec<Vec<Vec<Pt>>> = Vec::new();
            for (i, poly_coords) in polys_val.iter().enumerate() {
                if let Some(rings) =
                    sanitize_polygon_rings(poly_coords, &format!("{context}[{i}]"), opts)
                {
                    polys.push(rings);
                }
            }
            if polys.is_empty() {
                return None;
            }
            Some(json!({
                "type": "MultiPolygon",
                "coordinates": polys
                    .iter()
                    .map(|p| Value::Array(p.iter().map(|r| ring_to_json(r)).collect()))
                    .collect::<Vec<_>>(),
            }))
        }
        _ => Some(geom.clone()),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SanitizeFeatureCollectionResult {
    pub collection: Value,
    pub dropped_count: usize,
}

pub fn sanitize_feature_collection_rings(
    fc: &Value,
    context: &str,
) -> SanitizeFeatureCollectionResult {
    sanitize_feature_collection_rings_with_opts(fc, context, SanitizeRingOptions::default())
}

pub fn sanitize_feature_collection_rings_with_opts(
    fc: &Value,
    context: &str,
    opts: SanitizeRingOptions,
) -> SanitizeFeatureCollectionResult {
    let empty: Vec<Value> = Vec::new();
    let features = fc
        .get("features")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let mut out_features = Vec::with_capacity(features.len());
    let mut dropped = 0usize;

    for feature in features {
        let geometry = feature.get("geometry");
        let geom_type = geometry.and_then(|g| g.get("type")).and_then(Value::as_str);
        let is_polygonal = matches!(geom_type, Some("Polygon") | Some("MultiPolygon"));

        if !is_polygonal {
            out_features.push(feature.clone());
            continue;
        }

        match sanitize_geometry(geometry.unwrap(), context, opts) {
            Some(cleaned) => {
                let mut f = feature.clone();
                if let Some(obj) = f.as_object_mut() {
                    obj.insert("geometry".into(), cleaned);
                }
                out_features.push(f);
            }
            None => dropped += 1,
        }
    }

    SanitizeFeatureCollectionResult {
        collection: json!({ "type": "FeatureCollection", "features": out_features }),
        dropped_count: dropped,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn square() -> Vec<Pt> {
        vec![(0.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)]
    }

    #[test]
    fn sanitize_ring_accepts_clean_square_and_closes_it() {
        let ring = square();
        let out = sanitize_ring(
            Some(ring.as_slice()),
            SanitizeRingOptions::default(),
            "test",
        )
        .unwrap();
        assert_eq!(out.len(), 5); // cerrado: primer punto repetido al final
        assert_eq!(out[0], out[4]);
    }

    #[test]
    fn sanitize_ring_rejects_fewer_than_three_points() {
        let ring = vec![(0.0, 0.0), (1.0, 1.0)];
        assert!(sanitize_ring(
            Some(ring.as_slice()),
            SanitizeRingOptions::default(),
            "test"
        )
        .is_none());
    }

    #[test]
    fn sanitize_ring_rejects_non_finite_points() {
        let ring = vec![(0.0, 0.0), (f64::NAN, 1.0), (1.0, 1.0), (0.0, 1.0)];
        let out = sanitize_ring(
            Some(ring.as_slice()),
            SanitizeRingOptions::default(),
            "test",
        );
        assert!(out.is_some());
        assert_eq!(out.unwrap().len() - 1, 3);
    }

    #[test]
    fn sanitize_ring_drops_when_all_points_collapse_after_dedupe() {
        let ring = vec![(0.0, 0.0), (1e-6, 0.0), (0.0, 1e-6)];
        assert!(sanitize_ring(
            Some(ring.as_slice()),
            SanitizeRingOptions::default(),
            "test"
        )
        .is_none());
    }

    #[test]
    fn sanitize_ring_removes_spurious_collinear_vertex() {
        let ring = vec![(0.0, 0.0), (2.0, 0.0), (4.0, 0.0), (4.0, 4.0), (0.0, 4.0)];
        let out = sanitize_ring(
            Some(ring.as_slice()),
            SanitizeRingOptions::default(),
            "test",
        )
        .unwrap();
        let open: Vec<Pt> = out[..out.len() - 1].to_vec();
        assert_eq!(open.len(), 4);
        assert!(!open.contains(&(2.0, 0.0)));
    }

    #[test]
    fn sanitize_ring_rejects_area_below_threshold() {
        let sliver = vec![(0.0, 0.0), (1e-4, 0.0), (1e-4, 1e-4)];
        let opts = SanitizeRingOptions {
            min_area: 1.0,
            ..SanitizeRingOptions::default()
        };
        assert!(sanitize_ring(Some(sliver.as_slice()), opts, "test").is_none());
    }

    #[test]
    fn sanitize_ring_none_input_returns_none() {
        assert!(sanitize_ring(None, SanitizeRingOptions::default(), "test").is_none());
    }

    #[test]
    fn sanitize_rings_batch_discards_invalid_and_keeps_valid() {
        let good = square();
        let bad = vec![(0.0, 0.0), (1.0, 1.0)];
        let out = sanitize_rings(&[good, bad], SanitizeRingOptions::default(), "test");
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn sanitize_feature_collection_rings_cleans_polygon_and_passes_through_others() {
        let fc = json!({
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[0.0,0.0],[2.0,0.0],[4.0,0.0],[4.0,4.0],[0.0,4.0],[0.0,0.0]]]
                    }
                },
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": { "type": "LineString", "coordinates": [[0.0,0.0],[1.0,1.0]] }
                }
            ]
        });
        let result = sanitize_feature_collection_rings(&fc, "test");
        assert_eq!(result.dropped_count, 0);
        let features = result
            .collection
            .get("features")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(features.len(), 2);
        let poly_ring = features[0]["geometry"]["coordinates"][0]
            .as_array()
            .unwrap();
        assert_eq!(poly_ring.len(), 5);
        assert_eq!(
            features[1]["geometry"]["type"].as_str().unwrap(),
            "LineString"
        );
    }

    #[test]
    fn sanitize_feature_collection_rings_drops_degenerate_polygon() {
        let fc = json!({
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {},
                    "geometry": { "type": "Polygon", "coordinates": [[[0.0,0.0],[1.0,1.0]]] }
                }
            ]
        });
        let result = sanitize_feature_collection_rings(&fc, "test");
        assert_eq!(result.dropped_count, 1);
        let features = result
            .collection
            .get("features")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(features.len(), 0);
    }
}
