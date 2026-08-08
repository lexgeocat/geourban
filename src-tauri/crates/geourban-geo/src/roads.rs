use crate::types::{CornerMode, Pt, RoundaboutParams, Street};

fn normalize(dx: f64, dy: f64) -> Pt {
    let len = dx.hypot(dy);
    let len = if len == 0.0 { 1.0 } else { len };
    (dx / len, dy / len)
}

fn street_polyline(street: &Street) -> Vec<Pt> {
    let mut pts = vec![street.start];
    if let Some(wp) = &street.waypoints {
        pts.extend(wp.iter().copied());
    }
    pts.push(street.end);
    pts
}

const MITER_LIMIT: f64 = 4.0;

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

fn build_ring(pts: &[Pt], half: f64) -> Vec<Pt> {
    let left = offset_polyline_miter(pts, half);
    let mut right = offset_polyline_miter(pts, -half);
    right.reverse();
    let mut out = left;
    out.extend(right);
    out
}

const RB_CONNECT_TOLERANCE_M: f64 = 3.0;
const RB_OVERLAP_MARGIN_M: f64 = 0.5;

fn nudge_endpoint_into_roundabouts(
    out: &mut [Pt],
    idx: usize,
    ref_idx: usize,
    roundabouts: &[RoundaboutParams],
    outer_radius_for: &dyn Fn(&RoundaboutParams) -> f64,
) {
    let p = out[idx];
    let r = out[ref_idx];
    let dir_len = (p.0 - r.0).hypot(p.1 - r.1);
    if dir_len < 1e-6 {
        return;
    }
    let dir_x = (p.0 - r.0) / dir_len;
    let dir_y = (p.1 - r.1) / dir_len;

    for rb in roundabouts {
        let outer_r = outer_radius_for(rb);
        let d = (p.0 - rb.center.0).hypot(p.1 - rb.center.1);
        if d <= 1e-6 || d > outer_r + RB_CONNECT_TOLERANCE_M {
            continue;
        }
        let push = (outer_r - d).max(0.0) + RB_OVERLAP_MARGIN_M;
        out[idx] = (p.0 + dir_x * push, p.1 + dir_y * push);
        return;
    }
}

fn nudge_polyline_into_roundabouts(
    pts: &[Pt],
    roundabouts: &[RoundaboutParams],
    outer_radius_for: &dyn Fn(&RoundaboutParams) -> f64,
) -> Vec<Pt> {
    if roundabouts.is_empty() || pts.len() < 2 {
        return pts.to_vec();
    }
    let mut out = pts.to_vec();
    let n = out.len();
    nudge_endpoint_into_roundabouts(&mut out, 0, 1, roundabouts, outer_radius_for);
    nudge_endpoint_into_roundabouts(&mut out, n - 1, n - 2, roundabouts, outer_radius_for);
    out
}

fn build_street_outer_ring(street: &Street, roundabouts: &[RoundaboutParams]) -> Vec<Pt> {
    let half = street.width_m / 2.0 + street.side_width_m.max(0.0);
    let pts = nudge_polyline_into_roundabouts(&street_polyline(street), roundabouts, &|rb: &RoundaboutParams| {
        rb.radius_m + rb.road_width_m / 2.0 + rb.sidewalk_width_m.max(0.0)
    });
    build_ring(&pts, half)
}

fn build_street_road_ring(street: &Street, roundabouts: &[RoundaboutParams]) -> Vec<Pt> {
    let pts = nudge_polyline_into_roundabouts(&street_polyline(street), roundabouts, &|rb: &RoundaboutParams| {
        rb.radius_m + rb.road_width_m / 2.0
    });
    build_ring(&pts, street.width_m / 2.0)
}

fn build_roundabout_outer_ring(rb: &RoundaboutParams) -> Vec<Pt> {
    crate::roundabout::roundabout_geometry(rb, None).side_outer
}

fn build_roundabout_road_ring(rb: &RoundaboutParams) -> Vec<Pt> {
    crate::roundabout::roundabout_geometry(rb, None).road_outer
}

pub fn build_road_network_rings(
    streets: &[Street],
    roundabouts: &[RoundaboutParams],
) -> Vec<Vec<Pt>> {
    let mut rings = Vec::new();
    for s in streets {
        if s.width_m <= 0.0 {
            continue;
        }
        let ring = build_street_outer_ring(s, roundabouts);
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

pub fn build_road_only_rings(streets: &[Street], roundabouts: &[RoundaboutParams]) -> Vec<Vec<Pt>> {
    let mut rings = Vec::new();
    for s in streets {
        if s.width_m <= 0.0 {
            continue;
        }
        let ring = build_street_road_ring(s, roundabouts);
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

const FILLET_MAX_RADIUS_M: f64 = 8.0;

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

    Some(CornerTangents {
        ta,
        tb,
        center,
        reff,
        a0,
        a1,
    })
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
        pts.push((
            tg.center.0 + aa.cos() * tg.reff,
            tg.center.1 + aa.sin() * tg.reff,
        ));
    }
    pts.push(tg.tb);
    Some(pts)
}

fn corner_chamfer_cut(prev: Pt, cur: Pt, next: Pt, r: f64) -> Option<Vec<Pt>> {
    let tg = compute_corner_tangents(prev, cur, next, r)?;
    Some(vec![tg.ta, tg.tb])
}
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
