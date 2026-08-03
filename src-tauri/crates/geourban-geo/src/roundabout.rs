use crate::math::resolution_aware_segments;
use crate::types::{Pt, RoundaboutGeometry, RoundaboutParams};

pub fn ngon_ring(center: Pt, circum_r: f64, n: u32, rot: f64) -> Vec<Pt> {
    let mut pts = Vec::with_capacity(n as usize);
    for i in 0..n {
        let a = rot + (i as f64 * 2.0 * std::f64::consts::PI) / n as f64;
        pts.push((center.0 + a.cos() * circum_r, center.1 + a.sin() * circum_r));
    }
    pts
}

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

pub fn roundabout_road_area_m2(rb: &RoundaboutParams) -> f64 {
    let geom = roundabout_geometry(rb, None);
    let outer = ring_area(&geom.road_outer);
    let island = geom.island.as_ref().map(|i| ring_area(i)).unwrap_or(0.0);
    (outer - island).max(0.0)
}

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
#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() < tol
    }

    fn base_params(sides: u32) -> RoundaboutParams {
        RoundaboutParams {
            center: (0.0, 0.0),
            radius_m: 10.0,
            sides,
            rotation: 0.0,
            road_width_m: 6.0,
            sidewalk_width_m: 2.0,
            layer_id: None,
        }
    }

    #[test]
    fn ngon_ring_square_has_four_points_at_expected_radius() {
        let pts = ngon_ring((0.0, 0.0), 10.0, 4, 0.0);
        assert_eq!(pts.len(), 4);
        for p in &pts {
            assert!(approx((p.0 * p.0 + p.1 * p.1).sqrt(), 10.0, 1e-9));
        }
    }

    #[test]
    fn circle_ring_explicit_segment_count_is_respected() {
        let pts = circle_ring((0.0, 0.0), 5.0, Some(16), None);
        assert_eq!(pts.len(), 16);
        for p in &pts {
            assert!(approx((p.0 * p.0 + p.1 * p.1).sqrt(), 5.0, 1e-9));
        }
    }

    #[test]
    fn circle_ring_default_segment_count_scales_with_radius_within_bounds() {
        let small = circle_ring((0.0, 0.0), 1.0, None, None);
        let big = circle_ring((0.0, 0.0), 1000.0, None, None);
        assert!(small.len() >= 32);
        assert!(big.len() <= 160);
    }

    #[test]
    fn roundabout_geometry_circle_has_island_when_radius_allows() {
        let rb = base_params(0);
        let geom = roundabout_geometry(&rb, None);
        assert!(geom.island.is_some());
        let r_road = (geom.road_outer[0].0.powi(2) + geom.road_outer[0].1.powi(2)).sqrt();
        let r_side = (geom.side_outer[0].0.powi(2) + geom.side_outer[0].1.powi(2)).sqrt();
        assert!(r_side > r_road);
    }

    #[test]
    fn roundabout_geometry_no_island_when_radius_too_small() {
        let mut rb = base_params(0);
        rb.radius_m = 2.0; // radio - mitad de calzada <= 0.3 -> sin isla
        let geom = roundabout_geometry(&rb, None);
        assert!(geom.island.is_none());
    }

    #[test]
    fn roundabout_geometry_polygon_mode_has_sides_vertices() {
        let rb = base_params(6);
        let geom = roundabout_geometry(&rb, None);
        assert_eq!(geom.road_outer.len(), 6);
        assert_eq!(geom.side_outer.len(), 6);
        assert_eq!(geom.center_axis.len(), 6);
    }

    #[test]
    fn roundabout_road_area_m2_is_positive() {
        assert!(roundabout_road_area_m2(&base_params(0)) > 0.0);
        let mut rb = base_params(0);
        rb.radius_m = 2.0;
        assert!(roundabout_road_area_m2(&rb) > 0.0);
    }

    #[test]
    fn validate_roundabout_params_rejects_non_positive_radius() {
        let mut rb = base_params(0);
        rb.radius_m = 0.0;
        assert!(validate_roundabout_params(&rb).is_some());
    }

    #[test]
    fn validate_roundabout_params_rejects_polygon_with_fewer_than_three_sides() {
        let mut rb = base_params(2);
        rb.radius_m = 10.0;
        assert!(validate_roundabout_params(&rb).is_some());
    }

    #[test]
    fn validate_roundabout_params_accepts_circle() {
        assert!(validate_roundabout_params(&base_params(0)).is_none());
    }

    #[test]
    fn validate_roundabout_params_rejects_road_too_wide_for_radius_with_sides() {
        let mut rb = base_params(4);
        rb.radius_m = 3.0;
        rb.road_width_m = 40.0;
        rb.sidewalk_width_m = 0.0;
        assert!(validate_roundabout_params(&rb).is_some());
    }
}
