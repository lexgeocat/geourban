use crate::types::Pt;
use serde_json::{json, Value};

pub fn point_from_json(v: &Value) -> Option<Pt> {
    let c = v.as_array()?;
    if c.len() < 2 {
        return None;
    }
    Some((c[0].as_f64()?, c[1].as_f64()?))
}

pub fn ring_from_json(v: &Value) -> Option<Vec<Pt>> {
    let arr = v.as_array()?;
    let mut out = Vec::with_capacity(arr.len());
    for coord in arr {
        out.push(point_from_json(coord)?);
    }
    Some(out)
}

pub fn ring_to_json(ring: &[Pt]) -> Value {
    Value::Array(ring.iter().map(|p| json!([p.0, p.1])).collect())
}

pub fn polygon_rings_from_json(coords: &Value) -> Option<Vec<Vec<Pt>>> {
    let rings_val = coords.as_array()?;
    let mut rings = Vec::with_capacity(rings_val.len());
    for r in rings_val {
        rings.push(ring_from_json(r)?);
    }
    Some(rings)
}

pub fn polygon_rings_to_json(rings: &[Vec<Pt>]) -> Value {
    Value::Array(rings.iter().map(|r| ring_to_json(r)).collect())
}

pub fn outer_ring_from_polygon_geometry(geom: &Value) -> Option<Vec<Pt>> {
    let coords = geom.get("coordinates")?.as_array()?;
    ring_from_json(coords.first()?)
}

pub fn polygon_geometry_from_outer_ring(ring: &[Pt]) -> Value {
    json!({
        "type": "Polygon",
        "coordinates": [ring_to_json(ring)],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_ring() {
        let ring = vec![(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)];
        let v = ring_to_json(&ring);
        let back = ring_from_json(&v).unwrap();
        assert_eq!(ring, back);
    }

    #[test]
    fn point_from_json_ignores_z() {
        let v = json!([1.5, -2.5, 99.0]);
        assert_eq!(point_from_json(&v), Some((1.5, -2.5)));
    }

    #[test]
    fn point_from_json_rejects_short_array() {
        let v = json!([1.0]);
        assert_eq!(point_from_json(&v), None);
    }
}
