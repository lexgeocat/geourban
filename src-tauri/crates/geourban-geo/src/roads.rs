use crate::types::{CornerMode, Pt, RoundaboutParams, Street};

fn normalize(dx: f64, dy: f64) -> Pt {
    let len = dx.hypot(dy);
    let len = if len == 0.0 { 1.0 } else { len };
    (dx / len, dy / len)
}

// ─── roadNetworkEngine.ts ────────────────────────────────────────────

fn street_polyline(street: &Street) -> Vec<Pt> {
    let mut pts = vec![street.start];
    if let Some(wp) = &street.waypoints {
        pts.extend(wp.iter().copied());
    }
    pts.push(street.end);
    pts
}

const MITER_LIMIT: f64 = 4.0;

/// <- `offsetPolylineMiter`
pub fn offset_polyline_miter(pts: &[Pt], d: f64) -> Vec<Pt> {
    let n = pts.len();
    if n < 2 {
        return pts.to_vec();
    }

    let mut dirs = Vec::with_capacity(n - 1);
    let mut normals = Vec::with_capacity(n - 1);
    for i in 0..n - 1 {
        let dir = normalize(pts[i + 1].0 - pts[i].0, pts[i + 1].1 - pts[i].1);
        dirs.push(dir);
        normals.push((-dir.1, dir.0));
    }

    let mut out: Vec<Pt> = Vec::new();
    out.push((pts[0].0 + normals[0].0 * d, pts[0].1 + normals[0].1 * d));

    let abs_d = if d.abs() > 0.0 { d.abs() } else { 1e-9 };

    for i in 0..n - 2 {
        let n0 = normals[i];
        let n1 = normals[i + 1];
        let d0 = dirs[i];
        let d1 = dirs[i + 1];
        let p0 = (pts[i + 1].0 + n0.0 * d, pts[i + 1].1 + n0.1 * d);
        let p1 = (pts[i + 1].0 + n1.0 * d, pts[i + 1].1 + n1.1 * d);
        let det = d0.0 * d1.1 - d0.1 * d1.0;
        if det.abs() < 1e-9 {
            out.push(p0);
            continue;
        }
        let t = ((p1.0 - p0.0) * d1.1 - (p1.1 - p0.1) * d1.0) / det;
        let miter = (p0.0 + d0.0 * t, p0.1 + d0.1 * t);
        let miter_dist = (miter.0 - pts[i + 1].0).hypot(miter.1 - pts[i + 1].1);

        if miter_dist > abs_d * MITER_LIMIT {
            out.push(p0);
            out.push(p1);
        } else {
            out.push(miter);
        }
    }

    let last = normals[normals.len() - 1];
    out.push((pts[n - 1].0 + last.0 * d, pts[n - 1].1 + last.1 * d));
    out
}

/// <- `buildRing`
fn build_ring(pts: &[Pt], half: f64) -> Vec<Pt> {
    let left = offset_polyline_miter(pts, half);
    let mut right = offset_polyline_miter(pts, -half);
    right.reverse();
    let mut out = left;
    out.extend(right);
    out
}

fn build_street_outer_ring(street: &Street) -> Vec<Pt> {
    let half = street.width_m / 2.0 + street.side_width_m.max(0.0);
    build_ring(&street_polyline(street), half)
}

fn build_street_road_ring(street: &Street) -> Vec<Pt> {
    build_ring(&street_polyline(street), street.width_m / 2.0)
}

fn build_roundabout_outer_ring(rb: &RoundaboutParams) -> Vec<Pt> {
    crate::roundabout::roundabout_geometry(rb, None).side_outer
}

fn build_roundabout_road_ring(rb: &RoundaboutParams) -> Vec<Pt> {
    crate::roundabout::roundabout_geometry(rb, None).road_outer
}

/// <- `buildRoadNetworkRings`
pub fn build_road_network_rings(streets: &[Street], roundabouts: &[RoundaboutParams]) -> Vec<Vec<Pt>> {
    let mut rings = Vec::new();
    for s in streets {
        if s.width_m <= 0.0 {
            continue;
        }
        let ring = build_street_outer_ring(s);
        if ring.len() >= 3 {
            rings.push(ring);
        }
    }
    for rb in roundabouts {
        let ring = build_roundabout_outer_ring(rb);
        if ring.len() >= 3 {
            rings.push(ring);
        }
    }
    rings
}

/// <- `buildRoadOnlyRings`
pub fn build_road_only_rings(streets: &[Street], roundabouts: &[RoundaboutParams]) -> Vec<Vec<Pt>> {
    let mut rings = Vec::new();
    for s in streets {
        if s.width_m <= 0.0 {
            continue;
        }
        let ring = build_street_road_ring(s);
        if ring.len() >= 3 {
            rings.push(ring);
        }
    }
    for rb in roundabouts {
        let ring = build_roundabout_road_ring(rb);
        if ring.len() >= 3 {
            rings.push(ring);
        }
    }
    rings
}

// ─── streetEngine.ts (solo la dependencia de ringFillet) ─────────────

const FILLET_MAX_RADIUS_M: f64 = 8.0;

/// <- `getFilletRadiusForAngle`
pub fn get_fillet_radius_for_angle(angle_deg: f64, road_half_width_m: Option<f64>) -> f64 {
    let table_value = if angle_deg <= 35.0 {
        2.5
    } else if angle_deg <= 45.0 {
        3.0
    } else if angle_deg <= 95.0 {
        4.0
    } else if angle_deg <= 120.0 {
        4.5
    } else if angle_deg <= 150.0 {
        5.0
    } else {
        FILLET_MAX_RADIUS_M
    };

    let base = table_value.min(FILLET_MAX_RADIUS_M);
    match road_half_width_m {
        None => base,
        Some(half) => {
            let scaled_for_width = (half * 0.5).min(FILLET_MAX_RADIUS_M);
            base.max(scaled_for_width)
        }
    }
}

// ─── ringFillet.ts ────────────────────────────────────────────────────

fn ring_signed_area(ring: &[Pt]) -> f64 {
    let mut a = 0.0;
    let n = ring.len();
    for i in 0..n {
        let p = ring[i];
        let q = ring[(i + 1) % n];
        a += p.0 * q.1 - q.0 * p.1;
    }
    a / 2.0
}

fn close_ring(pts: Vec<Pt>) -> Vec<Pt> {
    if pts.is_empty() {
        return pts;
    }
    let f = pts[0];
    let l = *pts.last().unwrap();
    if (f.0 - l.0).abs() > 1e-9 || (f.1 - l.1).abs() > 1e-9 {
        let mut out = pts;
        out.push(f);
        out
    } else {
        pts
    }
}

fn dist_to_segment(p: Pt, a: Pt, b: Pt) -> f64 {
    let dx = b.0 - a.0;
    let dy = b.1 - a.1;
    let len_sq = dx * dx + dy * dy;
    if len_sq < 1e-12 {
        return (p.0 - a.0).hypot(p.1 - a.1);
    }
    let t = (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len_sq).clamp(0.0, 1.0);
    (p.0 - (a.0 + t * dx)).hypot(p.1 - (a.1 + t * dy))
}

/// <- `pointOnRing`
pub fn point_on_ring(p: Pt, ring: &[Pt], tol: f64) -> bool {
    let n = ring.len();
    for i in 0..n {
        if dist_to_segment(p, ring[i], ring[(i + 1) % n]) < tol {
            return true;
        }
    }
    false
}

struct CornerTangents {
    ta: Pt,
    tb: Pt,
    center: Pt,
    reff: f64,
    a0: f64,
    a1: f64,
}

fn compute_corner_tangents(prev: Pt, cur: Pt, next: Pt, r: f64) -> Option<CornerTangents> {
    if r <= 0.0 {
        return None;
    }
    let a = normalize(prev.0 - cur.0, prev.1 - cur.1);
    let b = normalize(next.0 - cur.0, next.1 - cur.1);
    let dot = (a.0 * b.0 + a.1 * b.1).clamp(-1.0, 1.0);
    let ang = dot.acos();
    if ang < 1e-3 || ang > std::f64::consts::PI - 1e-3 {
        return None;
    }

    let len_a = (prev.0 - cur.0).hypot(prev.1 - cur.1);
    let len_b = (next.0 - cur.0).hypot(next.1 - cur.1);
    let mut t = r / (ang / 2.0).tan();
    t = t.min(0.49 * len_a).min(0.49 * len_b);
    let reff = t * (ang / 2.0).tan();
    if reff < 1e-4 {
        return None;
    }

    let ta = (cur.0 + a.0 * t, cur.1 + a.1 * t);
    let tb = (cur.0 + b.0 * t, cur.1 + b.1 * t);
    let bis_raw = (a.0 + b.0, a.1 + b.1);
    let bis = normalize(bis_raw.0, bis_raw.1);
    let d_ctr = reff / (ang / 2.0).sin();
    let center = (cur.0 + bis.0 * d_ctr, cur.1 + bis.1 * d_ctr);

    let a0 = (ta.1 - center.1).atan2(ta.0 - center.0);
    let a1 = (tb.1 - center.1).atan2(tb.0 - center.0);

    Some(CornerTangents { ta, tb, center, reff, a0, a1 })
}

fn corner_fillet_arc(prev: Pt, cur: Pt, next: Pt, r: f64) -> Option<Vec<Pt>> {
    let tg = compute_corner_tangents(prev, cur, next, r)?;

    let mut da = tg.a1 - tg.a0;
    while da > std::f64::consts::PI {
        da -= 2.0 * std::f64::consts::PI;
    }
    while da < -std::f64::consts::PI {
        da += 2.0 * std::f64::consts::PI;
    }

    let steps = (((da.abs() / 0.18).ceil() as i64).max(2)) as usize;
    let mut pts = vec![tg.ta];
    for k in 1..steps {
        let aa = tg.a0 + (da * k as f64) / steps as f64;
        pts.push((tg.center.0 + aa.cos() * tg.reff, tg.center.1 + aa.sin() * tg.reff));
    }
    pts.push(tg.tb);
    Some(pts)
}

fn corner_chamfer_cut(prev: Pt, cur: Pt, next: Pt, r: f64) -> Option<Vec<Pt>> {
    let tg = compute_corner_tangents(prev, cur, next, r)?;
    Some(vec![tg.ta, tg.tb])
}

/// Espeja `extraM: number | ((pt: Pt) => number)`.
pub enum ExtraM<'a> {
    Fixed(f64),
    Fn(&'a dyn Fn(Pt) -> f64),
}

impl ExtraM<'_> {
    fn eval(&self, pt: Pt) -> f64 {
        match self {
            ExtraM::Fixed(v) => *v,
            ExtraM::Fn(f) => f(pt),
        }
    }
}

/// Espeja `forceTreat: boolean | ((pt: Pt) => boolean)`.
pub enum ForceTreat<'a> {
    Fixed(bool),
    Fn(&'a dyn Fn(Pt) -> bool),
}

impl ForceTreat<'_> {
    fn eval(&self, pt: Pt) -> bool {
        match self {
            ForceTreat::Fixed(v) => *v,
            ForceTreat::Fn(f) => f(pt),
        }
    }
}

/// <- `roundRingReflex`
pub fn round_ring_reflex(
    ring_in: &[Pt],
    extra_m: ExtraM,
    is_hole: bool,
    mode: CornerMode,
    force_treat: ForceTreat,
) -> Vec<Pt> {
    let mut pts: Vec<Pt> = ring_in.to_vec();
    if pts.len() > 1 {
        let f = pts[0];
        let l = *pts.last().unwrap();
        if (f.0 - l.0).abs() < 1e-9 && (f.1 - l.1).abs() < 1e-9 {
            pts.pop();
        }
    }
    let n = pts.len();
    if n < 3 {
        return close_ring(pts);
    }
    if matches!(mode, CornerMode::None) {
        return close_ring(pts);
    }

    let raw_ccw = ring_signed_area(&pts) >= 0.0;
    let ccw = if is_hole { !raw_ccw } else { raw_ccw };
    let mut out: Vec<Pt> = Vec::new();

    for i in 0..n {
        let prev = pts[(i + n - 1) % n];
        let cur = pts[i];
        let next = pts[(i + 1) % n];
        let d1x = cur.0 - prev.0;
        let d1y = cur.1 - prev.1;
        let d2x = next.0 - cur.0;
        let d2y = next.1 - cur.1;
        let l1 = d1x.hypot(d1y);
        let l2 = d2x.hypot(d2y);
        if l1 < 1e-9 || l2 < 1e-9 {
            out.push(cur);
            continue;
        }

        let cross = (d1x / l1) * (d2y / l2) - (d1y / l1) * (d2x / l2);
        let reflex = if ccw { cross < -1e-6 } else { cross > 1e-6 };
        let forced = force_treat.eval(cur);
        if !reflex && !forced {
            out.push(cur);
            continue;
        }

        let a = normalize(prev.0 - cur.0, prev.1 - cur.1);
        let b = normalize(next.0 - cur.0, next.1 - cur.1);
        let dot = (a.0 * b.0 + a.1 * b.1).clamp(-1.0, 1.0);
        let angle_deg = dot.acos().to_degrees();
        let extra = extra_m.eval(cur);
        let r = get_fillet_radius_for_angle(angle_deg, None) + extra;

        let corner = match mode {
            CornerMode::Chamfer => corner_chamfer_cut(prev, cur, next, r),
            _ => corner_fillet_arc(prev, cur, next, r),
        };
        match corner {
            Some(c) => out.extend(c),
            None => out.push(cur),
        }
    }

    close_ring(out)
}