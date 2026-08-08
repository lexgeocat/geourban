use crate::types::Pt;
use serde_json::{json, Value};

pub fn ring_to_json(ring: &[Pt]) -> Value {
    Value::Array(ring.iter().map(|p| json!([p.0, p.1])).collect())
}

pub fn polygon_geometry_from_outer_ring(ring: &[Pt]) -> Value {
    json!({
        "type": "Polygon",
        "coordinates": [ring_to_json(ring)],
    })
}
