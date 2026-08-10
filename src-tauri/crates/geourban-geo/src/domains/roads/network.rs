use serde::Serialize;

use crate::kernel::boolean_ops::union_rings;
use crate::kernel::math::orient_ring_ccw;
use crate::kernel::types::{CornerMode, Pt, RoundaboutParams, Street};
use crate::roads::{build_road_network_rings, build_road_only_rings, round_ring_reflex, ExtraM, ForceTreat};

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadNetworkNet {
    pub road: Vec<Vec<Vec<Pt>>>,
    pub outer: Vec<Vec<Vec<Pt>>>,
}

fn dist_to_segment(p: Pt, a: Pt, b: Pt) -> f64 {
    let dx = b.0 - a.0;
    let dy = b.1 - a.1;
    let len_sq = dx * dx + dy * dy;
    if len_sq < 1e-9 {
        return (p.0 - a.0).hypot(p.1 - a.1);
    }
    let t = (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len_sq).clamp(0.0, 1.0);
    (p.0 - (a.0 + t * dx)).hypot(p.1 - (a.1 + t * dy))
}

fn side_extra_at(pt: Pt, streets: &[Street], roundabouts: &[RoundaboutParams]) -> f64 {
    let mut best = 0.0_f64;

    for s in streets {
        let sw = s.side_width_m.max(0.0);
        if sw <= best {
            continue;
        }
        let mut pts = vec![s.start];
        if let Some(wp) = &s.waypoints {
            pts.extend(wp.iter().copied());
        }
        pts.push(s.end);
        let reach = s.width_m / 2.0 + sw + 3.0;
        for i in 0..pts.len().saturating_sub(1) {
            if dist_to_segment(pt, pts[i], pts[i + 1]) < reach {
                best = best.max(sw);
                break;
            }
        }
    }

    for rb in roundabouts {
        let sw = rb.sidewalk_width_m.max(0.0);
        if sw <= best {
            continue;
        }
        let d = (pt.0 - rb.center.0).hypot(pt.1 - rb.center.1);
        if (d - (rb.radius_m + rb.road_width_m / 2.0)).abs() < rb.road_width_m + sw + 3.0 {
            best = best.max(sw);
        }
    }

    best
}

fn process_polygons(
    polygons: &[Vec<Vec<Pt>>],
    extra: &dyn Fn(Pt) -> f64,
    corner_mode: CornerMode,
) -> Vec<Vec<Vec<Pt>>> {
    polygons
        .iter()
        .map(|rings| {
            rings
                .iter()
                .enumerate()
                .map(|(idx, ring)| {
                    let oriented = orient_ring_ccw(ring);
                    round_ring_reflex(
                        &oriented,
                        ExtraM::Fn(extra),
                        idx > 0,
                        corner_mode,
                        ForceTreat::Fixed(false),
                    )
                })
                .collect()
        })
        .collect()
}

pub fn compute_road_network_net(
    streets: &[Street],
    roundabouts: &[RoundaboutParams],
    corner_mode: CornerMode,
) -> RoadNetworkNet {
    let road_rings_raw = build_road_only_rings(streets, roundabouts);
    let outer_rings_raw = build_road_network_rings(streets, roundabouts);

    let road_union = union_rings(&road_rings_raw, "roadNetworkNet.unionRings.road");
    let outer_union = union_rings(&outer_rings_raw, "roadNetworkNet.unionRings.outer");

    let side_extra = |pt: Pt| side_extra_at(pt, streets, roundabouts);
    let zero_extra = |_pt: Pt| 0.0_f64;

    RoadNetworkNet {
        road: process_polygons(&road_union, &side_extra, corner_mode),
        outer: process_polygons(&outer_union, &zero_extra, corner_mode),
    }
}