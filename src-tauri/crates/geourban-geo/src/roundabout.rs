//! Puerto de `src/geo/roundabout/roundaboutEngine.ts`.

use crate::math::resolution_aware_segments;
use crate::types::{Pt, RoundaboutGeometry, RoundaboutParams};

/// <- `ngonRing`
pub fn ngon_ring(center: Pt, circum_r: f64, n: u32, rot: f64) -> Vec<Pt> {
    let mut pts = Vec::with_capacity(n as usize);
    for i in 0..n {
        let a = rot + (i as f64 * 2.0 * std::f64::consts::PI) / n as f64;
        pts.push((center.0 + a.cos() * circum_r, center.1 + a.sin() * circum_r));
    }
    pts
}

/// <- `circleRing`
pub fn circle_ring(center: Pt, radius: f64, segs: Option<u32>, resolution: Option<f64>) -> Vec<Pt> {
    let n = segs.unwrap_or_else(|| match resolution {
        Some(res) => resolution_aware_segments(radius, res, 1.5),
        None => {
            let raw = (radius * 4.0).round();
            raw.max(32.0).min(160.0) as u32
        }
    });
    let mut pts = Vec::with_capacity(n as usize);
    for i in 0..n {
        let a = (i as f64 * 2.0 * std::f64::consts::PI) / n as f64;
        pts.push((center.0 + a.cos() * radius, center.1 + a.sin() * radius));
    }
    pts
}

/// <- `roundaboutGeometry`
pub fn roundabout_geometry(rb: &RoundaboutParams, resolution: Option<f64>) -> RoundaboutGeometry {
    let half = rb.road_width_m / 2.0;
    let sw = rb.sidewalk_width_m.max(0.0);

    if rb.sides < 3 {
        let island_r = rb.radius_m - half;
        return RoundaboutGeometry {
            road_outer: circle_ring(rb.center, rb.radius_m + half, None, resolution),
            side_outer: circle_ring(rb.center, rb.radius_m + half + sw, None, resolution),
            island: if island_r > 0.3 {
                Some(circle_ring(rb.center, island_r, None, resolution))
            } else {
                None
            },
            center_axis: circle_ring(rb.center, rb.radius_m, None, resolution),
        };
    }

    let n = rb.sides;
    let k = 1.0 / (std::f64::consts::PI / n as f64).cos();
    let island_r = rb.radius_m - half * k;
    RoundaboutGeometry {
        road_outer: ngon_ring(rb.center, rb.radius_m + half * k, n, rb.rotation),
        side_outer: ngon_ring(rb.center, rb.radius_m + (half + sw) * k, n, rb.rotation),
        island: if island_r > 0.3 {
            Some(ngon_ring(rb.center, island_r, n, rb.rotation))
        } else {
            None
        },
        center_axis: ngon_ring(rb.center, rb.radius_m, n, rb.rotation),
    }
}

fn ring_area(ring: &[Pt]) -> f64 {
    let mut a = 0.0;
    let n = ring.len();
    for i in 0..n {
        let p = ring[i];
        let q = ring[(i + 1) % n];
        a += p.0 * q.1 - q.0 * p.1;
    }
    (a / 2.0).abs()
}

/// <- `roundaboutRoadAreaM2`
pub fn roundabout_road_area_m2(rb: &RoundaboutParams) -> f64 {
    let geom = roundabout_geometry(rb, None);
    let outer = ring_area(&geom.road_outer);
    let island = geom.island.as_ref().map(|i| ring_area(i)).unwrap_or(0.0);
    (outer - island).max(0.0)
}

/// <- `validateRoundaboutParams`
pub fn validate_roundabout_params(rb: &RoundaboutParams) -> Option<String> {
    if !(rb.radius_m > 0.0) {
        return Some("El radio debe ser mayor a 0.".to_string());
    }
    if rb.sides != 0 && rb.sides < 3 {
        return Some("Un polígono necesita al menos 3 lados (o 0 para círculo).".to_string());
    }

    let half = rb.road_width_m / 2.0 + rb.sidewalk_width_m.max(0.0);
    if rb.sides >= 3 {
        let k = 1.0 / (std::f64::consts::PI / rb.sides as f64).cos();
        if half * k > rb.radius_m * 3.0 {
            return Some(format!(
                "La calzada (+ vereda) es demasiado ancha para un radio de {:.1}m con {} lados — el ochave puede autointersectarse. Reducí el ancho o aumentá el radio.",
                rb.radius_m, rb.sides
            ));
        }
    }
    None
}