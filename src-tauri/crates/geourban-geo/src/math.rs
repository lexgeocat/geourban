use std::collections::HashMap;

use crate::types::Pt;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Extent1D {
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PrincipalAxis {
    pub ux: f64,
    pub uy: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct PolyHit {
    pub seg_idx: usize,
    pub u: f64,
    pub pt: Pt,
}

#[derive(Debug, Clone)]
pub struct CutPolys {
    pub poly1: Vec<Pt>,
    pub poly2: Vec<Pt>,
    pub cut_a: Pt,
    pub cut_b: Pt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PolyHitRole {
    A,
    B,
}

pub fn poly_area(pts: &[Pt]) -> f64 {
    let n = pts.len();
    let mut a = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        a += pts[i].0 * pts[j].1 - pts[j].0 * pts[i].1;
    }
    (a / 2.0).abs()
}

pub fn centroid(pts: &[Pt]) -> Pt {
    let mut cx = 0.0;
    let mut cy = 0.0;
    for p in pts {
        cx += p.0;
        cy += p.1;
    }
    let n = pts.len() as f64;
    (cx / n, cy / n)
}

pub fn convex_hull(pts: &[Pt]) -> Vec<Pt> {
    let mut arr: Vec<Pt> = pts.to_vec();
    arr.sort_by(|a, b| {
        if a.0 != b.0 {
            a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
        } else {
            a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)
        }
    });
    if arr.len() < 3 {
        return arr;
    }

    let cross =
        |o: Pt, a: Pt, b: Pt| -> f64 { (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0) };

    let mut lower: Vec<Pt> = Vec::new();
    for &p in &arr {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], p) <= 0.0 {
            lower.pop();
        }
        lower.push(p);
    }

    let mut upper: Vec<Pt> = Vec::new();
    for &p in arr.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], p) <= 0.0 {
            upper.pop();
        }
        upper.push(p);
    }

    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

pub fn ring_perimeter(pts: &[Pt]) -> f64 {
    let n = pts.len();
    if n == 0 {
        return 0.0;
    }
    let mut per = 0.0;
    for i in 0..n {
        let a = pts[i];
        let b = pts[(i + 1) % n];
        per += (b.0 - a.0).hypot(b.1 - a.1);
    }
    per
}

pub fn path_length(pts: &[Pt]) -> f64 {
    if pts.is_empty() {
        return 0.0;
    }
    let mut total = 0.0;
    for i in 0..pts.len() - 1 {
        let dx = pts[i + 1].0 - pts[i].0;
        let dy = pts[i + 1].1 - pts[i].1;
        total += dx.hypot(dy);
    }
    total
}

pub fn orient_ring_ccw(ring: &[Pt]) -> Vec<Pt> {
    let n = ring.len();
    let mut area = 0.0;
    for i in 0..n {
        let p = ring[i];
        let q = ring[(i + 1) % n];
        area += p.0 * q.1 - q.0 * p.1;
    }
    if area >= 0.0 {
        ring.to_vec()
    } else {
        let mut rev = ring.to_vec();
        rev.reverse();
        rev
    }
}

fn side(pt: Pt, lp1: Pt, lp2: Pt) -> f64 {
    (lp2.0 - lp1.0) * (pt.1 - lp1.1) - (lp2.1 - lp1.1) * (pt.0 - lp1.0)
}

fn line_line_intersect(a: Pt, b: Pt, c: Pt, d: Pt) -> Option<Pt> {
    let dx1 = b.0 - a.0;
    let dy1 = b.1 - a.1;
    let dx2 = d.0 - c.0;
    let dy2 = d.1 - c.1;
    let denom = dx1 * dy2 - dy1 * dx2;
    if denom.abs() < 1e-12 {
        return None;
    }
    let t = ((c.0 - a.0) * dy2 - (c.1 - a.1) * dx2) / denom;
    Some((a.0 + t * dx1, a.1 + t * dy1))
}

pub fn clip_half_plane(pts: &[Pt], lp1: Pt, lp2: Pt, keep_side: i32) -> Vec<Pt> {
    if pts.len() < 3 {
        return Vec::new();
    }
    let n = pts.len();
    let mut out: Vec<Pt> = Vec::new();
    for i in 0..n {
        let cur = pts[i];
        let nxt = pts[(i + 1) % n];
        let sc = side(cur, lp1, lp2);
        let sn = side(nxt, lp1, lp2);
        let cur_in = if keep_side > 0 {
            sc >= -1e-9
        } else {
            sc <= 1e-9
        };
        let nxt_in = if keep_side > 0 {
            sn >= -1e-9
        } else {
            sn <= 1e-9
        };
        if cur_in {
            out.push(cur);
        }
        if cur_in != nxt_in {
            if let Some(inter) = line_line_intersect(cur, nxt, lp1, lp2) {
                out.push(inter);
            }
        }
    }
    if out.len() >= 3 {
        out
    } else {
        Vec::new()
    }
}

pub fn point_in_poly(x: f64, y: f64, poly: &[Pt]) -> bool {
    let n = poly.len();
    if n == 0 {
        return false;
    }
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = poly[i];
        let (xj, yj) = poly[j];
        j = i;
        if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
            inside = !inside;
        }
    }
    inside
}

pub fn segment_intersects_poly(a: Pt, b: Pt, poly: &[Pt]) -> bool {
    if point_in_poly(a.0, a.1, poly) || point_in_poly(b.0, b.1, poly) {
        return true;
    }

    let abx = b.0 - a.0;
    let aby = b.1 - a.1;

    let n = poly.len();
    if n == 0 {
        return false;
    }
    let mut j = n - 1;
    for i in 0..n {
        let (xi, yi) = poly[i];
        let (xj, yj) = poly[j];
        j = i;

        let dx = xj - xi;
        let dy = yj - yi;
        let denom = abx * dy - aby * dx;
        if denom == 0.0 {
            continue; // paralelos
        }
        let qx = a.0 - xi;
        let qy = a.1 - yi;
        let t = -(qx * dy - qy * dx) / denom;
        let u = -(qx * aby - qy * abx) / denom;
        if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) {
            return true;
        }
    }
    false
}

pub fn build_cut_polys(wp: &[Pt], h_a: PolyHit, h_b: PolyHit) -> Option<CutPolys> {
    let n = wp.len();
    if n == 0 {
        return None;
    }

    let mut ins: HashMap<usize, Vec<(f64, Pt, PolyHitRole)>> = HashMap::new();

    let ua = h_a.u.max(0.0).min(1.0);
    let ub = h_b.u.max(0.0).min(1.0);
    ins.entry(h_a.seg_idx)
        .or_default()
        .push((ua, h_a.pt, PolyHitRole::A));
    ins.entry(h_b.seg_idx)
        .or_default()
        .push((ub, h_b.pt, PolyHitRole::B));

    for list in ins.values_mut() {
        list.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(std::cmp::Ordering::Equal));
    }

    let mut verts: Vec<(Pt, Option<PolyHitRole>)> = Vec::new();
    for i in 0..n {
        verts.push((wp[i], None));
        if let Some(list) = ins.get(&i) {
            for &(_, pt, role) in list {
                verts.push((pt, Some(role)));
            }
        }
    }

    let mut idx_a: Option<usize> = None;
    let mut idx_b: Option<usize> = None;
    for (i, v) in verts.iter().enumerate() {
        match v.1 {
            Some(PolyHitRole::A) => idx_a = Some(i),
            Some(PolyHitRole::B) => idx_b = Some(i),
            None => {}
        }
    }
    let (idx_a, idx_b) = match (idx_a, idx_b) {
        (Some(a), Some(b)) => (a, b),
        _ => return None,
    };

    let lv = verts.len();

    let mut p1: Vec<Pt> = Vec::new();
    let mut i = idx_a;
    let mut st = 0usize;
    loop {
        p1.push(verts[i].0);
        i = (i + 1) % lv;
        st += 1;
        if i == idx_b || st > lv + 2 {
            break;
        }
    }
    p1.push(verts[idx_b].0);

    let mut p2: Vec<Pt> = Vec::new();
    let mut i = idx_b;
    let mut st = 0usize;
    loop {
        p2.push(verts[i].0);
        i = (i + 1) % lv;
        st += 1;
        if i == idx_a || st > lv + 2 {
            break;
        }
    }
    p2.push(verts[idx_a].0);

    if p1.len() < 3 || p2.len() < 3 {
        return None;
    }

    Some(CutPolys {
        poly1: p1,
        poly2: p2,
        cut_a: h_a.pt,
        cut_b: h_b.pt,
    })
}

pub fn clip_to_strip(pts: &[Pt], ax: f64, ay: f64, min_t: f64, max_t: f64) -> Vec<Pt> {
    if pts.len() < 3 {
        return Vec::new();
    }
    let nx = -ay;
    let ny = ax;

    let min_pt: Pt = (min_t * ax, min_t * ay);
    let p1: Pt = (min_pt.0 + nx, min_pt.1 + ny);
    let p2: Pt = (min_pt.0 - nx, min_pt.1 - ny);
    let test_min: Pt = ((min_t + 1.0) * ax, (min_t + 1.0) * ay);
    let s_min = side(test_min, p1, p2);
    let clipped = clip_half_plane(pts, p1, p2, if s_min >= 0.0 { 1 } else { -1 });
    if clipped.len() < 3 {
        return Vec::new();
    }

    let max_pt: Pt = (max_t * ax, max_t * ay);
    let p3: Pt = (max_pt.0 + nx, max_pt.1 + ny);
    let p4: Pt = (max_pt.0 - nx, max_pt.1 - ny);
    let test_max: Pt = ((max_t - 1.0) * ax, (max_t - 1.0) * ay);
    let s_max = side(test_max, p3, p4);
    clip_half_plane(&clipped, p3, p4, if s_max >= 0.0 { 1 } else { -1 })
}

pub fn principal_axis(pts: &[Pt]) -> PrincipalAxis {
    let n = pts.len() as f64;
    let mut mx = 0.0;
    let mut my = 0.0;
    for p in pts {
        mx += p.0;
        my += p.1;
    }
    mx /= n;
    my /= n;

    let mut cxx = 0.0;
    let mut cxy = 0.0;
    let mut cyy = 0.0;
    for p in pts {
        let dx = p.0 - mx;
        let dy = p.1 - my;
        cxx += dx * dx;
        cxy += dx * dy;
        cyy += dy * dy;
    }

    let trace = cxx + cyy;
    let det = cxx * cyy - cxy * cxy;
    let disc = ((trace * trace) / 4.0 - det).max(0.0).sqrt();
    let l1 = trace / 2.0 + disc;

    let ex: f64;
    let ey: f64;
    if cxy.abs() > 1e-10 {
        ex = l1 - cyy;
        ey = cxy;
    } else if cxx >= cyy {
        ex = 1.0;
        ey = 0.0;
    } else {
        ex = 0.0;
        ey = 1.0;
    }

    let raw_len = (ex * ex + ey * ey).sqrt();
    let len = if raw_len == 0.0 { 1.0 } else { raw_len };
    let mut ux = ex / len;
    let mut uy = ey / len;
    if ux < 0.0 || (ux.abs() < 1e-9 && uy < 0.0) {
        ux = -ux;
        uy = -uy;
    }

    PrincipalAxis { ux, uy }
}

pub fn project_extents(pts: &[Pt], ax: f64, ay: f64) -> Extent1D {
    let mut mn = f64::INFINITY;
    let mut mx = f64::NEG_INFINITY;
    for p in pts {
        let t = p.0 * ax + p.1 * ay;
        if t < mn {
            mn = t;
        }
        if t > mx {
            mx = t;
        }
    }
    Extent1D { min: mn, max: mx }
}

const LOD_MIN_SEGMENTS: u32 = 8;
const LOD_MAX_SEGMENTS: u32 = 160;

pub fn resolution_aware_segments(radius_map_units: f64, resolution: f64, px_error: f64) -> u32 {
    if !(radius_map_units > 0.0) || !(resolution > 0.0) {
        return LOD_MIN_SEGMENTS;
    }
    let error_map_units = px_error * resolution;
    let ratio = (error_map_units / radius_map_units).min(1.0);
    let max_angle = 2.0 * (1.0 - ratio).acos();
    if !(max_angle > 0.0) || !max_angle.is_finite() {
        return LOD_MAX_SEGMENTS;
    }
    let needed = ((2.0 * std::f64::consts::PI) / max_angle).ceil() as u32;
    needed.max(LOD_MIN_SEGMENTS).min(LOD_MAX_SEGMENTS)
}
