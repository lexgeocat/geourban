use crate::math::{centroid, convex_hull, poly_area};
use crate::types::{LotResult, Pt};
use std::cell::Cell;

const OP_BUDGET_MAX: i64 = 2_000_000;

thread_local! {
    static OP_BUDGET_REMAINING: Cell<i64> = const { Cell::new(OP_BUDGET_MAX) };
    static CURRENT_DIST_EPS: Cell<f64> = const { Cell::new(1e-7) };
}

fn tick_op_budget() -> bool {
    OP_BUDGET_REMAINING.with(|c| {
        let v = c.get();
        if v <= 0 {
            return false;
        }
        c.set(v - 1);
        true
    })
}

fn reset_op_budget() {
    OP_BUDGET_REMAINING.with(|c| c.set(OP_BUDGET_MAX));
}

fn dist_eps_for_poly(pts: &[Pt]) -> f64 {
    let mut min_x = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for p in pts {
        if p.0 < min_x {
            min_x = p.0;
        }
        if p.0 > max_x {
            max_x = p.0;
        }
        if p.1 < min_y {
            min_y = p.1;
        }
        if p.1 > max_y {
            max_y = p.1;
        }
    }
    let dx = (max_x - min_x).max(0.0);
    let dy = (max_y - min_y).max(0.0);
    let diag = dx.hypot(dy);
    (diag * 1e-12_f64).max(1e-7)
}

fn set_current_dist_eps(pts: &[Pt]) {
    let eps = dist_eps_for_poly(pts);
    CURRENT_DIST_EPS.with(|c| c.set(eps));
}

fn current_dist_eps() -> f64 {
    CURRENT_DIST_EPS.with(|c| c.get())
}

const MAX_HB_DIM: i64 = 400;
const MAX_HB_TOTAL_LOTS: usize = 1200;

fn lerp(a: Pt, b: Pt, t: f64) -> Pt {
    (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)
}

fn dist(a: Pt, b: Pt) -> f64 {
    (b.0 - a.0).hypot(b.1 - a.1)
}

fn bisect<F: Fn(f64) -> f64 + ?Sized>(f: &F, lo: f64, hi: f64, target: f64) -> f64 {
    let mut a = lo;
    let mut b = hi;
    for _ in 0..60 {
        if !tick_op_budget() {
            break;
        }
        let m = (a + b) / 2.0;
        if f(m) < target {
            a = m;
        } else {
            b = m;
        }
    }
    (a + b) / 2.0
}

fn min_area_bounding_quad(pts: &[Pt]) -> Vec<Pt> {
    let hull = convex_hull(pts);
    if hull.len() < 3 {
        let min_x = pts.iter().map(|p| p.0).fold(f64::INFINITY, f64::min);
        let max_x = pts.iter().map(|p| p.0).fold(f64::NEG_INFINITY, f64::max);
        let min_y = pts.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
        let max_y = pts.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);
        return vec![
            (min_x, min_y),
            (max_x, min_y),
            (max_x, max_y),
            (min_x, max_y),
        ];
    }

    struct Best {
        area: f64,
        min_x: f64,
        max_x: f64,
        min_y: f64,
        max_y: f64,
        ang: f64,
    }
    let mut best: Option<Best> = None;
    for i in 0..hull.len() {
        let a = hull[i];
        let b = hull[(i + 1) % hull.len()];
        let ang = (b.1 - a.1).atan2(b.0 - a.0);
        let cs = (-ang).cos();
        let sn = (-ang).sin();
        let mut min_x = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        for p in &hull {
            let rx = p.0 * cs - p.1 * sn;
            let ry = p.0 * sn + p.1 * cs;
            if rx < min_x {
                min_x = rx;
            }
            if rx > max_x {
                max_x = rx;
            }
            if ry < min_y {
                min_y = ry;
            }
            if ry > max_y {
                max_y = ry;
            }
        }
        let area = (max_x - min_x) * (max_y - min_y);
        if best.as_ref().is_none_or(|b| area < b.area) {
            best = Some(Best {
                area,
                min_x,
                max_x,
                min_y,
                max_y,
                ang,
            });
        }
    }
    let best = best.unwrap();
    let cs = best.ang.cos();
    let sn = best.ang.sin();
    let corners: [Pt; 4] = [
        (best.min_x, best.min_y),
        (best.max_x, best.min_y),
        (best.max_x, best.max_y),
        (best.min_x, best.max_y),
    ];
    corners
        .iter()
        .map(|&(rx, ry)| (rx * cs - ry * sn, rx * sn + ry * cs))
        .collect()
}

fn line_line(p1: Pt, d1: Pt, p2: Pt, d2: Pt) -> Option<Pt> {
    let den = d1.0 * d2.1 - d1.1 * d2.0;
    if den.abs() < 1e-9 {
        return None;
    }
    let t = ((p2.0 - p1.0) * d2.1 - (p2.1 - p1.1) * d2.0) / den;
    Some((p1.0 + t * d1.0, p1.1 + t * d1.1))
}

fn unfillet_manzano(ring_in: &[Pt]) -> Vec<Pt> {
    let mut pts: Vec<Pt> = ring_in.to_vec();
    if pts.len() > 1 {
        let f = pts[0];
        let l = *pts.last().unwrap();
        if (f.0 - l.0).abs() < 1e-9 && (f.1 - l.1).abs() < 1e-9 {
            pts.pop();
        }
    }
    let m = pts.len();
    if m < 3 {
        return pts;
    }

    let mut edir: Vec<Pt> = Vec::with_capacity(m);
    let mut elen: Vec<f64> = Vec::with_capacity(m);
    for k in 0..m {
        let a = pts[k];
        let b = pts[(k + 1) % m];
        let dx = b.0 - a.0;
        let dy = b.1 - a.1;
        let l = dx.hypot(dy);
        elen.push(l);
        edir.push(if l > 1e-9 {
            (dx / l, dy / l)
        } else {
            (0.0, 0.0)
        });
    }
    const ANG: f64 = 4.0 * std::f64::consts::PI / 180.0;
    let mut is_break = vec![false; m];
    for k in 0..m {
        let p = edir[(k + m - 1) % m];
        let c = edir[k];
        let d = (p.0 * c.0 + p.1 * c.1).clamp(-1.0, 1.0);
        is_break[k] = d.acos() > ANG;
    }
    let starts: Vec<usize> = (0..m).filter(|&k| is_break[k]).collect();
    if starts.len() < 2 {
        return pts;
    }

    struct Run {
        s: Pt,
        e: Pt,
        len: f64,
        dir: Pt,
    }
    let mut runs: Vec<Run> = Vec::new();
    let r_count = starts.len();
    for s in 0..r_count {
        let a = starts[s];
        let b = starts[(s + 1) % r_count];
        let mut l = 0.0;
        let mut kk = a;
        loop {
            l += elen[kk];
            let nk = (kk + 1) % m;
            if nk == b {
                break;
            }
            kk = nk;
        }
        let sp = pts[a];
        let ep = pts[b];
        let dx = ep.0 - sp.0;
        let dy = ep.1 - sp.1;
        let dl_raw = dx.hypot(dy);
        let dl = if dl_raw != 0.0 { dl_raw } else { 1.0 };
        runs.push(Run {
            s: sp,
            e: ep,
            len: l,
            dir: (dx / dl, dy / dl),
        });
    }

    const MAX_FILLET_R: f64 = 8.0;
    let arc_chord = 2.0 * MAX_FILLET_R * (0.18_f64 / 2.0).sin();
    let l_min = (arc_chord * 1.6_f64).max(1.0);
    let major: Vec<&Run> = runs.iter().filter(|r| r.len >= l_min).collect();
    if major.len() < 3 {
        return pts;
    }

    let p_count = major.len();
    let mut v: Vec<Pt> = Vec::with_capacity(p_count);
    for j in 0..p_count {
        let prev = major[(j + p_count - 1) % p_count];
        let cur = major[j];
        let ip = line_line(prev.s, prev.dir, cur.s, cur.dir);
        let far = match ip {
            Some(p) => {
                dist(p, prev.e) > prev.len * 4.0 + 60.0 || dist(p, cur.s) > cur.len * 4.0 + 60.0
            }
            None => true,
        };
        let ip = match ip {
            Some(p) if !far => p,
            _ => ((prev.e.0 + cur.s.0) / 2.0, (prev.e.1 + cur.s.1) / 2.0),
        };
        v.push(ip);
    }
    v
}

fn mzn_quad_approx(mzn_pts: &[Pt]) -> Vec<Pt> {
    let v = unfillet_manzano(mzn_pts);
    if v.len() == 4 {
        return v;
    }
    min_area_bounding_quad(mzn_pts)
}

fn order_quad_long(pts: &[Pt]) -> [Pt; 4] {
    let cx = pts.iter().map(|p| p.0).sum::<f64>() / 4.0;
    let cy = pts.iter().map(|p| p.1).sum::<f64>() / 4.0;
    let mut sorted: Vec<Pt> = pts.to_vec();
    sorted.sort_by(|a, b| {
        let ang_a = (a.1 - cy).atan2(a.0 - cx);
        let ang_b = (b.1 - cy).atan2(b.0 - cx);
        ang_a
            .partial_cmp(&ang_b)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let len_a = (dist(sorted[0], sorted[1]) + dist(sorted[2], sorted[3])) / 2.0;
    let len_b = (dist(sorted[1], sorted[2]) + dist(sorted[3], sorted[0])) / 2.0;
    if len_a <= len_b {
        [sorted[0], sorted[1], sorted[2], sorted[3]]
    } else {
        [sorted[1], sorted[2], sorted[3], sorted[0]]
    }
}

fn default_baseline_dir(mzn_pts: &[Pt]) -> Pt {
    let quad = mzn_quad_approx(mzn_pts);
    let ordered = order_quad_long(&quad);
    let (ax, ay) = ordered[0];
    let (dx, dy) = ordered[3];
    let lx = dx - ax;
    let ly = dy - ay;
    let len = lx.hypot(ly).max(1e-9);
    let (ux, uy) = (lx / len, ly / len);
    (-uy, ux)
}

fn hb_clean_poly(pts_in: Vec<Pt>) -> Vec<Pt> {
    let mut p = pts_in;
    let mut changed = true;
    let eps = current_dist_eps();
    let guard_max = p.len() + 64;
    let mut guard = 0usize;
    while changed && p.len() > 3 && guard < guard_max {
        changed = false;
        guard += 1;
        let n = p.len();
        for i in 0..n {
            let b = p[i];
            let a = p[(i + n - 1) % n];
            let c = p[(i + 1) % n];
            let d1 = (b.0 - a.0).hypot(b.1 - a.1);
            let d2 = (c.0 - b.0).hypot(c.1 - b.1);
            if d1 < eps || d2 < eps {
                p.remove(i);
                changed = true;
                break;
            }
            let ux1 = (b.0 - a.0) / d1;
            let uy1 = (b.1 - a.1) / d1;
            let ux2 = (c.0 - b.0) / d2;
            let uy2 = (c.1 - b.1) / d2;
            let dot = ux1 * ux2 + uy1 * uy2;
            let cross = ux1 * uy2 - uy1 * ux2;
            if dot < -0.999 || (dot > 0.99999 && cross.abs() < 1e-5) {
                p.remove(i);
                changed = true;
                break;
            }
        }
    }
    p
}

fn hb_clip_poly_half(poly: &[Pt], nx: f64, ny: f64, sign: f64, d: f64) -> Vec<Pt> {
    if poly.is_empty() {
        return Vec::new();
    }
    if !tick_op_budget() {
        return Vec::new();
    }
    let inside = |p: Pt| sign * (p.0 * nx + p.1 * ny) >= d - 1e-10;
    let mut result: Vec<Pt> = Vec::new();
    let n = poly.len();
    for i in 0..n {
        let cur = poly[i];
        let nxt = poly[(i + 1) % n];
        let c_in = inside(cur);
        let n_in = inside(nxt);
        if c_in {
            result.push(cur);
        }
        if c_in != n_in {
            let dc = sign * (cur.0 * nx + cur.1 * ny) - d;
            let dn = sign * (nxt.0 * nx + nxt.1 * ny) - d;
            let t = dc / (dc - dn);
            result.push((cur.0 + t * (nxt.0 - cur.0), cur.1 + t * (nxt.1 - cur.1)));
        }
    }
    hb_clean_poly(result)
}

fn hb_strip_area(poly: &[Pt], ux: f64, uy: f64, t0: f64, t1: f64) -> f64 {
    let p = hb_clip_poly_half(poly, ux, uy, 1.0, t0);
    let p = hb_clip_poly_half(&p, ux, uy, -1.0, -t1);
    if p.len() >= 3 {
        poly_area(&p)
    } else {
        0.0
    }
}

fn hb_poly_slice_at_u(pts: &[Pt], ux: f64, uy: f64, t: f64) -> Vec<Pt> {
    let n = pts.len();
    let mut hits: Vec<Pt> = Vec::new();
    for i in 0..n {
        let a = pts[i];
        let b = pts[(i + 1) % n];
        let ua = a.0 * ux + a.1 * uy;
        let ub = b.0 * ux + b.1 * uy;
        if (ub - ua).abs() < 1e-12 {
            continue;
        }
        if !((ua <= t && ub >= t) || (ub <= t && ua >= t)) {
            continue;
        }
        let frac = (t - ua) / (ub - ua);
        hits.push((a.0 + frac * (b.0 - a.0), a.1 + frac * (b.1 - a.1)));
    }
    let mut uniq: Vec<Pt> = Vec::new();
    for p in hits {
        if !uniq.iter().any(|&q| (p.0 - q.0).hypot(p.1 - q.1) < 1e-8) {
            uniq.push(p);
        }
    }
    uniq
}

#[allow(clippy::too_many_arguments)]
fn hb_poly_slice_at_u_clamped(
    poly: &[Pt],
    ux: f64,
    uy: f64,
    t: f64,
    vx: f64,
    vy: f64,
    u_min: f64,
    u_max: f64,
) -> Vec<Pt> {
    const EPS: f64 = 1e-6;
    let at_edge = (t - u_min).abs() < EPS || (t - u_max).abs() < EPS;
    if at_edge {
        let is_min = (t - u_min).abs() < EPS;
        let tol = (u_max - u_min) * 0.02 + EPS;
        let candidates: Vec<Pt> = poly
            .iter()
            .copied()
            .filter(|p| {
                let u = p.0 * ux + p.1 * uy;
                if is_min {
                    u <= u_min + tol
                } else {
                    u >= u_max - tol
                }
            })
            .collect();
        if candidates.len() >= 2 {
            let mut sorted = candidates;
            sorted.sort_by(|a, b| {
                let ka = a.0 * vx + a.1 * vy;
                let kb = b.0 * vx + b.1 * vy;
                ka.partial_cmp(&kb).unwrap_or(std::cmp::Ordering::Equal)
            });
            return vec![sorted[0], *sorted.last().unwrap()];
        }
        if candidates.len() == 1 {
            return vec![candidates[0], candidates[0]];
        }
    }
    let mut raw = hb_poly_slice_at_u(poly, ux, uy, t);
    raw.sort_by(|a, b| {
        let ka = a.0 * vx + a.1 * vy;
        let kb = b.0 * vx + b.1 * vy;
        ka.partial_cmp(&kb).unwrap_or(std::cmp::Ordering::Equal)
    });
    raw
}

#[derive(Debug, Clone, Copy)]
struct HbConfig {
    body_cols: i64,
    body_rows: i64,
    head_rows: i64,
    min_area: f64,
    head_depth: f64,
    min_frente: f64,
}

fn hb_get_cfg(block_area: f64, target_area_m2: f64, front_min_m: f64) -> HbConfig {
    let min_area = target_area_m2.max(0.0);
    let min_frente = front_min_m.max(0.0);
    let head_depth = if min_frente > 0.0 {
        (min_area / min_frente).max(5.0)
    } else {
        20.0
    };
    let body_cols: i64 = 2;
    if min_area > 0.0 && block_area > 0.0 {
        let head_rows: i64 = 1;
        let head_area = 2.0 * head_rows as f64 * 2.0 * min_area;
        let body_area = (block_area - head_area).max(0.0);
        let body_lots = (body_area / min_area).floor().max(1.0);
        let body_rows = ((body_lots / body_cols as f64).round().max(1.0) as i64).min(MAX_HB_DIM);
        HbConfig {
            body_cols,
            body_rows,
            head_rows,
            min_area,
            head_depth,
            min_frente,
        }
    } else {
        HbConfig {
            body_cols,
            body_rows: 6,
            head_rows: 1,
            min_area: 0.0,
            head_depth,
            min_frente,
        }
    }
}

struct HeadPlan {
    head_cols1: i64,
    head_cols2: i64,
    target_lot_area: f64,
}

#[allow(clippy::too_many_arguments)]
fn hb_auto_head_plan(
    total_area: f64,
    u_min: f64,
    u_max: f64,
    width_at_u: impl Fn(f64) -> f64,
    head_rows: i64,
    body_rows: i64,
    body_cols: i64,
    min_area: f64,
    target_depth: f64,
) -> HeadPlan {
    let d = if target_depth > 0.0 {
        target_depth
    } else {
        20.0
    };
    if head_rows <= 0 {
        let target_lot_area = if min_area > 0.0 {
            min_area
        } else if body_rows * body_cols > 0 {
            total_area / (body_rows * body_cols) as f64
        } else {
            0.0
        };
        return HeadPlan {
            head_cols1: 0,
            head_cols2: 0,
            target_lot_area,
        };
    }

    let measure = |area: f64| -> (i64, i64) {
        let frontage = (area / d).max(1e-6);
        let depth = head_rows as f64 * d;
        let u_a = (u_min + depth).min(u_max);
        let u_b = (u_max - depth).max(u_min);
        let w1 = width_at_u((u_min + u_a) / 2.0).max(1e-6);
        let w2 = width_at_u((u_max + u_b) / 2.0).max(1e-6);
        let c1 = ((w1 / frontage).floor() as i64).clamp(1, MAX_HB_DIM);
        let c2 = ((w2 / frontage).floor() as i64).clamp(1, MAX_HB_DIM);
        (c1, c2)
    };

    let mut target = if min_area > 0.0 {
        min_area
    } else {
        total_area / (body_rows * body_cols + 2 * head_rows * 2) as f64
    };
    let mut c1: i64 = 1;
    let mut c2: i64 = 1;
    let iters = if min_area > 0.0 { 1 } else { 5 };
    for _ in 0..iters {
        let (m1, m2) = measure(target);
        c1 = m1;
        c2 = m2;
        if min_area > 0.0 {
            break;
        }
        let tl = body_rows * body_cols + head_rows * (c1 + c2);
        target = if tl > 0 {
            total_area / tl as f64
        } else {
            target
        };
    }
    HeadPlan {
        head_cols1: c1,
        head_cols2: c2,
        target_lot_area: target,
    }
}

#[allow(clippy::too_many_arguments)]
fn hb_fit_body_rows(
    total_area: f64,
    target: f64,
    head_rows: i64,
    head_cols1: i64,
    head_cols2: i64,
    body_cols: i64,
    body_rows: i64,
    use_fixed_area: bool,
) -> i64 {
    if !use_fixed_area || head_rows <= 0 || target <= 0.0 || body_cols <= 0 {
        return body_rows.max(1);
    }
    let head_l = (head_rows * (head_cols1 + head_cols2)) as f64;
    let cap = ((total_area / target) - head_l) / body_cols as f64;
    (cap.round() as i64).clamp(1, MAX_HB_DIM)
}

#[derive(Debug, Clone)]
struct HbLot {
    pts: Vec<Pt>,
    area: f64,
    zone: String,
    is_remainder: bool,
}

struct Divider {
    nx: f64,
    ny: f64,
    d: f64,
}

fn hb_min_by<F: Fn(Pt) -> f64>(arr: &[Pt], key: F) -> Pt {
    *arr.iter()
        .reduce(|a, b| if key(*b) < key(*a) { b } else { a })
        .unwrap()
}
fn hb_max_by<F: Fn(Pt) -> f64>(arr: &[Pt], key: F) -> Pt {
    *arr.iter()
        .reduce(|a, b| if key(*b) > key(*a) { b } else { a })
        .unwrap()
}

#[allow(clippy::too_many_arguments)]
fn hb_build_zone(
    work_poly: &[Pt],
    ux: f64,
    uy: f64,
    vx: f64,
    vy: f64,
    u_min: f64,
    u_max: f64,
    u_a: f64,
    u_b: f64,
    n_rows: i64,
    n_cols: i64,
    zone: &str,
    remainder_lot: bool,
    lots: &mut Vec<HbLot>,
    lot_budget: &mut usize,
) {
    if n_rows <= 0 || n_cols <= 0 || *lot_budget == 0 {
        return;
    }
    let mut zone_poly = hb_clip_poly_half(work_poly, ux, uy, 1.0, u_a);
    zone_poly = hb_clip_poly_half(&zone_poly, ux, uy, -1.0, -u_b);
    if zone_poly.len() < 3 {
        return;
    }
    let zone_total = poly_area(&zone_poly);

    let u_key = |p: Pt| p.0 * ux + p.1 * uy;
    let v_key = |p: Pt| p.0 * vx + p.1 * vy;
    let epsu = (u_max - u_min) * 1e-6 + 1e-9;
    let on_a: Vec<Pt> = zone_poly
        .iter()
        .copied()
        .filter(|&p| (u_key(p) - u_a).abs() < epsu)
        .collect();
    let on_b: Vec<Pt> = zone_poly
        .iter()
        .copied()
        .filter(|&p| (u_key(p) - u_b).abs() < epsu)
        .collect();

    let skew_ok = on_a.len() >= 2 && on_b.len() >= 2;
    let (top_lo, top_hi, bot_lo, bot_hi) = if skew_ok {
        (
            Some(hb_min_by(&on_a, v_key)),
            Some(hb_max_by(&on_a, v_key)),
            Some(hb_min_by(&on_b, v_key)),
            Some(hb_max_by(&on_b, v_key)),
        )
    } else {
        (None, None, None, None)
    };

    let v_min_z = zone_poly
        .iter()
        .map(|&p| v_key(p))
        .fold(f64::INFINITY, f64::min);
    let v_max_z = zone_poly
        .iter()
        .map(|&p| v_key(p))
        .fold(f64::NEG_INFINITY, f64::max);
    let v_span_z = v_max_z - v_min_z;

    let divider_at = |f: f64| -> Divider {
        if !skew_ok {
            return Divider {
                nx: vx,
                ny: vy,
                d: v_min_z + f * v_span_z,
            };
        }
        let pt = lerp(top_lo.unwrap(), top_hi.unwrap(), f);
        let pb = lerp(bot_lo.unwrap(), bot_hi.unwrap(), f);
        let dx = pb.0 - pt.0;
        let dy = pb.1 - pt.1;
        let len = dx.hypot(dy);
        let (mut nx, mut ny) = if len < 1e-9 {
            (vx, vy)
        } else {
            (dy / len, -dx / len)
        };
        if nx * vx + ny * vy < 0.0 {
            nx = -nx;
            ny = -ny;
        }
        Divider {
            nx,
            ny,
            d: nx * pt.0 + ny * pt.1,
        }
    };

    let col_area_up_to_f = |f: f64| -> f64 {
        if f <= 1e-12 {
            return 0.0;
        }
        if f >= 1.0 {
            return zone_total;
        }
        let l = divider_at(f);
        let sub = hb_clip_poly_half(&zone_poly, l.nx, l.ny, -1.0, -l.d);
        if sub.len() >= 3 {
            poly_area(&sub)
        } else {
            0.0
        }
    };

    let n_cols_eff = n_cols.min((*lot_budget as i64 + 2).max(1));
    let col_target = zone_total / n_cols_eff as f64;
    let mut f_cuts: Vec<f64> = vec![0.0];
    for c in 0..n_cols_eff - 1 {
        f_cuts.push(bisect(
            &col_area_up_to_f,
            0.0,
            1.0,
            (c + 1) as f64 * col_target,
        ));
    }
    f_cuts.push(1.0);

    for c in 0..n_cols_eff {
        if *lot_budget == 0 {
            break;
        }
        let ci = c as usize;
        let f0 = f_cuts.get(ci).copied().unwrap_or(1.0);
        let f1 = f_cuts.get(ci + 1).copied().unwrap_or(1.0);
        let l0 = divider_at(f0);
        let l1 = divider_at(f1);
        let mut col_poly = zone_poly.clone();
        if f0 > 1e-9 {
            col_poly = hb_clip_poly_half(&col_poly, l0.nx, l0.ny, 1.0, l0.d);
        }
        if f1 < 1.0 - 1e-9 {
            col_poly = hb_clip_poly_half(&col_poly, l1.nx, l1.ny, -1.0, -l1.d);
        }
        if col_poly.len() < 3 {
            continue;
        }
        let col_area = poly_area(&col_poly);
        let cell_target = col_area / n_rows as f64;
        let is_last_cell_col = remainder_lot && c == n_cols_eff - 1;

        let u_projs_col: Vec<f64> = col_poly.iter().map(|&p| u_key(p)).collect();
        let u_min_c = u_projs_col.iter().cloned().fold(f64::INFINITY, f64::min);
        let u_max_c = u_projs_col
            .iter()
            .cloned()
            .fold(f64::NEG_INFINITY, f64::max);
        let row_area_up_to = |u_cut: f64| -> f64 {
            let sub = hb_clip_poly_half(&col_poly, ux, uy, 1.0, u_min_c);
            let sub = hb_clip_poly_half(&sub, ux, uy, -1.0, -u_cut);
            if sub.len() >= 3 {
                poly_area(&sub)
            } else {
                0.0
            }
        };
        let mut row_cuts: Vec<f64> = vec![u_min_c];
        for r in 0..n_rows - 1 {
            row_cuts.push(bisect(
                &row_area_up_to,
                u_min_c,
                u_max_c,
                (r + 1) as f64 * cell_target,
            ));
        }
        row_cuts.push(u_max_c);

        for r in 0..n_rows {
            if *lot_budget == 0 {
                break;
            }
            let ri = r as usize;
            let r0 = row_cuts.get(ri).copied().unwrap_or(u_max_c);
            let r1 = row_cuts.get(ri + 1).copied().unwrap_or(u_max_c);
            let mut lot = hb_clip_poly_half(&col_poly, ux, uy, 1.0, r0);
            lot = hb_clip_poly_half(&lot, ux, uy, -1.0, -r1);
            if lot.len() < 3 {
                continue;
            }
            let area = poly_area(&lot);
            lots.push(HbLot {
                pts: lot,
                area,
                zone: zone.to_string(),
                is_remainder: is_last_cell_col && r == n_rows - 1,
            });
            *lot_budget -= 1;
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn hb_build_body_zone(
    work_poly: &[Pt],
    ux: f64,
    uy: f64,
    vx: f64,
    vy: f64,
    u_min: f64,
    u_max: f64,
    min_frente: f64,
    target_lot_area: f64, // <-- NUEVO
    area_up_to: &dyn Fn(f64) -> f64,
    n_rows: i64,
    n_cols: i64,
    u_a: f64,
    u_b: f64,
    lots: &mut Vec<HbLot>,
    lot_budget: &mut usize,
) {
    if n_rows <= 0 || n_cols <= 0 || *lot_budget == 0 {
        return;
    }
    let zone_total = hb_strip_area(work_poly, ux, uy, u_a, u_b);
    if zone_total <= 0.0 {
        return;
    }

    let row_target = zone_total / n_rows as f64;
    let area_at_a = area_up_to(u_a);
    let mut row_cuts: Vec<f64> = vec![u_a];
    for r in 0..n_rows - 1 {
        if !tick_op_budget() {
            break;
        }
        let a_target = area_at_a + (r + 1) as f64 * row_target;
        let cut = bisect(area_up_to, u_a, u_b, a_target).max(u_a).min(u_b);
        row_cuts.push(cut);
    }
    row_cuts.push(u_b);

    let actual_rows = row_cuts.len().saturating_sub(1);

    for r in 0..actual_rows {
        if *lot_budget == 0 {
            break;
        }
        let ra = row_cuts[r];
        let rb = row_cuts[r + 1];
        if rb <= ra + 1e-9 {
            continue;
        }

        let mut strip_poly = hb_clip_poly_half(work_poly, ux, uy, 1.0, ra);
        strip_poly = hb_clip_poly_half(&strip_poly, ux, uy, -1.0, -rb);
        if strip_poly.len() < 3 {
            continue;
        }

        let slice_a = hb_poly_slice_at_u_clamped(work_poly, ux, uy, ra, vx, vy, u_min, u_max);
        let slice_b = hb_poly_slice_at_u_clamped(work_poly, ux, uy, rb, vx, vy, u_min, u_max);
        if slice_a.len() < 2 || slice_b.len() < 2 {
            continue;
        }

        let qa = slice_a[0];
        let qb = *slice_a.last().unwrap();
        let qd = slice_b[0];
        let qc = *slice_b.last().unwrap();

        let cut_line_at = |t: f64| -> Divider {
            let p1 = lerp(qa, qb, t);
            let p2 = lerp(qd, qc, t);
            let dx = p2.0 - p1.0;
            let dy = p2.1 - p1.1;
            let len = dx.hypot(dy);
            if len < 1e-9 {
                return Divider {
                    nx: vx,
                    ny: vy,
                    d: p1.0 * vx + p1.1 * vy,
                };
            }
            let (mut nx, mut ny) = (-dy / len, dx / len);
            if nx * vx + ny * vy < 0.0 {
                nx = -nx;
                ny = -ny;
            }
            Divider {
                nx,
                ny,
                d: nx * p1.0 + ny * p1.1,
            }
        };

        let lot_area_at = |t0: f64, t1: f64| -> f64 {
            let c0 = cut_line_at(t0);
            let c1 = cut_line_at(t1);
            let sub = if t0 > 1e-9 {
                hb_clip_poly_half(&strip_poly, c0.nx, c0.ny, 1.0, c0.d)
            } else {
                strip_poly.clone()
            };
            let sub = if t1 < 1.0 - 1e-9 {
                hb_clip_poly_half(&sub, c1.nx, c1.ny, -1.0, -c1.d)
            } else {
                sub
            };
            if sub.len() >= 3 {
                poly_area(&sub)
            } else {
                0.0
            }
        };

        let row_area = lot_area_at(0.0, 1.0);
        if row_area < 1e-9 {
            continue;
        }
        let row_len_u = (rb - ra).abs();

        let local_ancho = if row_len_u > 1e-9 {
            row_area / row_len_u
        } else {
            0.0
        };

        let force_single_col =
            min_frente > 0.0 && n_cols > 1 && (local_ancho / n_cols as f64) <= min_frente;

        if force_single_col {
            let n_sub = if target_lot_area > 1e-6 {
                ((row_area / target_lot_area).round() as i64).max(1)
            } else {
                1
            };

            if n_sub <= 1 {
                lots.push(HbLot {
                    pts: strip_poly,
                    area: row_area,
                    zone: "body".to_string(),
                    is_remainder: false,
                });
                *lot_budget -= 1;
                continue;
            }

            let area_at_ra = area_up_to(ra);
            let sub_target = row_area / n_sub as f64;
            let mut sub_cuts: Vec<f64> = vec![ra];
            for k in 0..n_sub - 1 {
                if !tick_op_budget() {
                    break;
                }
                let a_target = area_at_ra + (k + 1) as f64 * sub_target;
                let cut = bisect(area_up_to, ra, rb, a_target).max(ra).min(rb);
                sub_cuts.push(cut);
            }
            sub_cuts.push(rb);

            for k in 0..sub_cuts.len().saturating_sub(1) {
                if *lot_budget == 0 {
                    break;
                }
                let sa = sub_cuts[k];
                let sb = sub_cuts[k + 1];
                if sb <= sa + 1e-9 {
                    continue;
                }
                let mut sub_poly = hb_clip_poly_half(work_poly, ux, uy, 1.0, sa);
                sub_poly = hb_clip_poly_half(&sub_poly, ux, uy, -1.0, -sb);
                if sub_poly.len() < 3 {
                    continue;
                }
                let sub_area = poly_area(&sub_poly);
                if sub_area < 1e-6 {
                    continue;
                }
                lots.push(HbLot {
                    pts: sub_poly,
                    area: sub_area,
                    zone: "body".to_string(),
                    is_remainder: false,
                });
                *lot_budget -= 1;
            }
            continue;
        }

        let n_cols_here = n_cols;
        let col_target = row_area / n_cols_here as f64;
        let cum_t = |t: f64| lot_area_at(0.0, t);
        let mut col_cuts: Vec<f64> = vec![0.0];
        for c in 0..n_cols_here - 1 {
            if !tick_op_budget() {
                break;
            }
            let ci = c as usize;
            let prev = col_cuts[ci];
            let cut = bisect(&cum_t, prev, 1.0, (c + 1) as f64 * col_target)
                .max(prev)
                .min(1.0);
            col_cuts.push(cut);
        }
        col_cuts.push(1.0);
        let actual_cols = col_cuts.len().saturating_sub(1);

        for c in 0..actual_cols {
            if *lot_budget == 0 {
                break;
            }
            let t0 = col_cuts[c];
            let t1 = col_cuts[c + 1];
            if t1 <= t0 + 1e-9 {
                continue;
            }
            let c0 = cut_line_at(t0);
            let c1 = cut_line_at(t1);
            let mut col_poly = if t0 > 1e-9 {
                hb_clip_poly_half(&strip_poly, c0.nx, c0.ny, 1.0, c0.d)
            } else {
                strip_poly.clone()
            };
            col_poly = if t1 < 1.0 - 1e-9 {
                hb_clip_poly_half(&col_poly, c1.nx, c1.ny, -1.0, -c1.d)
            } else {
                col_poly
            };
            if col_poly.len() < 3 {
                continue;
            }
            let area = poly_area(&col_poly);
            if area < 1e-6 {
                continue;
            }
            lots.push(HbLot {
                pts: col_poly,
                area,
                zone: "body".to_string(),
                is_remainder: false,
            });
            *lot_budget -= 1;
        }
    }
}

fn hb_lotize_with_baseline(mzn_pts: &[Pt], cfg: HbConfig, baseline: (Pt, Pt)) -> Vec<HbLot> {
    let body_cols = cfg.body_cols;
    let body_rows = cfg.body_rows;
    let head_rows = cfg.head_rows;
    let min_area = cfg.min_area;
    let head_depth = cfg.head_depth;
    let min_frente = cfg.min_frente;

    let work_poly = mzn_pts;

    let dx_b = baseline.1 .0 - baseline.0 .0;
    let dy_b = baseline.1 .1 - baseline.0 .1;
    let len_b = dx_b.hypot(dy_b);
    if len_b < 1e-9 {
        return Vec::new();
    }

    let vx = dx_b / len_b;
    let vy = dy_b / len_b;
    let ux = -vy;
    let uy = vx;

    let u_projs: Vec<f64> = work_poly.iter().map(|p| p.0 * ux + p.1 * uy).collect();
    let u_min = u_projs.iter().cloned().fold(f64::INFINITY, f64::min);
    let u_max = u_projs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    if u_max - u_min < 1e-9 {
        return Vec::new();
    }

    let total_area = hb_strip_area(work_poly, ux, uy, u_min, u_max);
    if total_area <= 0.0 {
        return Vec::new();
    }
    let use_fixed_area = min_area > 0.0;
    let area_up_to = |u_cut: f64| hb_strip_area(work_poly, ux, uy, u_min, u_cut);

    let width_at_u = |uu: f64| -> f64 {
        let pts = hb_poly_slice_at_u(work_poly, ux, uy, uu);
        if pts.len() < 2 {
            return 0.0;
        }
        let vs: Vec<f64> = pts.iter().map(|p| p.0 * vx + p.1 * vy).collect();
        vs.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
            - vs.iter().cloned().fold(f64::INFINITY, f64::min)
    };

    let plan = hb_auto_head_plan(
        total_area, u_min, u_max, width_at_u, head_rows, body_rows, body_cols, min_area, head_depth,
    );
    let mut head_cols1 = plan.head_cols1;
    let mut head_cols2 = plan.head_cols2;
    let target_lot_area = plan.target_lot_area;

    if use_fixed_area && head_rows > 0 && target_lot_area > 0.0 && total_area > 0.0 {
        let min_body_area = body_cols as f64 * target_lot_area;
        let max_head_area = (total_area - min_body_area).max(0.0);
        let max_head_slots = (max_head_area / (head_rows as f64 * target_lot_area)).floor();
        let current_total = head_cols1 + head_cols2;

        if max_head_slots < 1.0 {
            head_cols1 = 0;
            head_cols2 = 0;
        } else if current_total as f64 > max_head_slots {
            let ratio = max_head_slots / current_total as f64;
            head_cols1 = ((head_cols1 as f64 * ratio).floor() as i64).max(1);
            head_cols2 = ((head_cols2 as f64 * ratio).floor() as i64).max(1);
        }
    }

    let b_rows = hb_fit_body_rows(
        total_area,
        target_lot_area,
        head_rows,
        head_cols1,
        head_cols2,
        body_cols,
        body_rows,
        use_fixed_area,
    );

    let (u_h1, u_h2) = if head_rows <= 0 {
        (u_min, u_max)
    } else {
        let head_area1 = head_rows as f64 * head_cols1 as f64 * target_lot_area;
        let body_area = b_rows as f64 * body_cols as f64 * target_lot_area;
        let uh1 = bisect(&area_up_to, u_min, u_max, head_area1);
        let uh2 = bisect(&area_up_to, uh1, u_max, head_area1 + body_area)
            .max(uh1)
            .min(u_max);
        (uh1, uh2)
    };

    let mut lots: Vec<HbLot> = Vec::new();
    let mut lot_budget: usize = MAX_HB_TOTAL_LOTS;

    if head_rows > 0 {
        hb_build_zone(
            work_poly,
            ux,
            uy,
            vx,
            vy,
            u_min,
            u_max,
            u_min,
            u_h1,
            head_rows,
            head_cols1,
            "head1",
            use_fixed_area,
            &mut lots,
            &mut lot_budget,
        );
    }

    hb_build_body_zone(
        work_poly,
        ux,
        uy,
        vx,
        vy,
        u_min,
        u_max,
        min_frente,
        target_lot_area, // <-- NUEVO
        &area_up_to,
        b_rows,
        body_cols,
        u_h1,
        u_h2,
        &mut lots,
        &mut lot_budget,
    );

    if head_rows > 0 {
        hb_build_zone(
            work_poly,
            ux,
            uy,
            vx,
            vy,
            u_min,
            u_max,
            u_h2,
            u_max,
            head_rows,
            head_cols2,
            "head2",
            use_fixed_area,
            &mut lots,
            &mut lot_budget,
        );
    }

    lots
}

fn hb_merge_polys(a: &[Pt], b: &[Pt]) -> Vec<Pt> {
    let merged = crate::boolean_ops::union_rings(
        &[a.to_vec(), b.to_vec()],
        "subdivisionCabeceraCuerpo.hbMergeHeadRemainders",
    );
    if merged.len() == 1 && merged[0].len() == 1 {
        let mut ring = merged[0][0].clone();
        if ring.len() > 1 {
            let (fx, fy) = ring[0];
            let (lxp, lyp) = ring[ring.len() - 1];
            if (fx - lxp).abs() < 1e-9 && (fy - lyp).abs() < 1e-9 {
                ring.pop();
            }
        }
        if ring.len() >= 3 {
            return ring;
        }
    }
    hb_convex_hull_merge(a, b)
}

fn hb_convex_hull_merge(a: &[Pt], b: &[Pt]) -> Vec<Pt> {
    let mut combined = Vec::with_capacity(a.len() + b.len());
    combined.extend_from_slice(a);
    combined.extend_from_slice(b);
    convex_hull(&combined)
}

fn hb_shared_edge_len(a: &[Pt], b: &[Pt]) -> f64 {
    const EPS: f64 = 0.5;
    let mut total = 0.0;
    for i in 0..a.len() {
        let a1 = a[i];
        let a2 = a[(i + 1) % a.len()];
        for j in 0..b.len() {
            let b1 = b[j];
            let b2 = b[(j + 1) % b.len()];
            let dax = a2.0 - a1.0;
            let day = a2.1 - a1.1;
            let dbx = b2.0 - b1.0;
            let dby = b2.1 - b1.1;
            let len_a = dax.hypot(day);
            let len_b = dbx.hypot(dby);
            if len_a < 1e-9 || len_b < 1e-9 {
                continue;
            }
            let cross = (dax * dby - day * dbx).abs() / (len_a * len_b);
            if cross > 0.05 {
                continue;
            }
            let cx = b1.0 - a1.0;
            let cy = b1.1 - a1.1;
            if (cx * day - cy * dax).abs() / len_a > EPS {
                continue;
            }
            let p_b1 = (cx * dax + cy * day) / len_a;
            let p_b2 = p_b1 + (dbx * dax + dby * day) / len_a;
            let lo = p_b1.min(p_b2).max(0.0);
            let hi = p_b1.max(p_b2).min(len_a);
            if hi > lo + EPS {
                total += hi - lo;
            }
        }
    }
    total
}

fn hb_merge_head_remainders(lots: Vec<HbLot>, target_lot_area: f64) -> Vec<HbLot> {
    if target_lot_area <= 0.0 {
        return lots;
    }
    const THRESHOLD: f64 = 0.8;

    let mut result = lots;
    let guard_max = result.len() + 8;
    let mut guard = 0usize;
    loop {
        guard += 1;
        if guard > guard_max || !tick_op_budget() {
            break;
        }
        let rem_idx = result
            .iter()
            .position(|l| l.zone.starts_with("head") && l.area < target_lot_area * THRESHOLD);
        let rem_idx = match rem_idx {
            Some(i) => i,
            None => break,
        };

        let mut best_idx: Option<usize> = None;
        let mut best_shared = -1.0_f64;
        for i in 0..result.len() {
            if i == rem_idx || !result[i].zone.starts_with("head") {
                continue;
            }
            let shared = hb_shared_edge_len(&result[rem_idx].pts, &result[i].pts);
            if shared > best_shared {
                best_shared = shared;
                best_idx = Some(i);
            }
        }
        let best_idx = match best_idx {
            Some(i) if best_shared >= 0.1 => i,
            _ => break,
        };

        let merged_pts = hb_merge_polys(&result[rem_idx].pts, &result[best_idx].pts);
        let merged_area = poly_area(&merged_pts);
        let merged_zone = result[best_idx].zone.clone();
        let merged_lot = HbLot {
            pts: merged_pts,
            area: merged_area,
            zone: merged_zone,
            is_remainder: false,
        };

        let insert_at = rem_idx.min(best_idx);
        let i_hi = rem_idx.max(best_idx);
        let i_lo = insert_at;
        result.remove(i_hi);
        result.remove(i_lo);
        result.insert(insert_at, merged_lot);
    }
    result
}

fn lot_front_depth_from_longest_edge(pts: &[Pt], area: f64) -> (f64, f64) {
    let n = pts.len();
    if n < 2 {
        return (0.0, 0.0);
    }
    let mut best_len = 0.0_f64;
    for i in 0..n {
        let a = pts[i];
        let b = pts[(i + 1) % n];
        let l = (b.0 - a.0).hypot(b.1 - a.1);
        if l > best_len {
            best_len = l;
        }
    }
    if best_len < 1e-6 {
        return (0.0, 0.0);
    }
    (best_len, area / best_len)
}

pub fn subdivide_manzano_cabecera_cuerpo(
    mzn_pts: &[Pt],
    target_area_m2: f64,
    front_min_m: f64,
    dir_pref: Option<(f64, f64)>,
) -> Vec<LotResult> {
    if mzn_pts.len() < 3 {
        return Vec::new();
    }
    reset_op_budget();
    set_current_dist_eps(mzn_pts);

    let block_area = poly_area(mzn_pts);
    if block_area < target_area_m2 * 0.15 {
        return Vec::new();
    }

    let baseline: (Pt, Pt) = {
        let c = centroid(mzn_pts);
        let (ax, ay) = match dir_pref {
            Some(d) => d,
            None => default_baseline_dir(mzn_pts),
        };
        (c, (c.0 + ax, c.1 + ay))
    };

    let cfg = hb_get_cfg(block_area, target_area_m2, front_min_m);
    let mut raw = hb_lotize_with_baseline(mzn_pts, cfg, baseline);
    if cfg.min_area > 0.0 {
        raw = hb_merge_head_remainders(raw, cfg.min_area);
    }
    raw.retain(|l| l.area >= 0.5);

    raw.into_iter()
        .map(|l| {
            let (front_m, depth_m) = lot_front_depth_from_longest_edge(&l.pts, l.area);
            LotResult {
                front_m,
                depth_m,
                area_m2: l.area,
                is_remnant: l.is_remainder,
                pts: l.pts,
            }
        })
        .collect()
}
