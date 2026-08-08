use serde_json::{Map, Value};

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
