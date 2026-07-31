use crate::math::{
    build_cut_polys, centroid, clip_to_strip, point_in_poly, poly_area, principal_axis,
    project_extents, Extent1D, PolyHit,
};
use crate::sanitize::{sanitize_ring, SanitizeRingOptions};
use crate::types::{
    CutResult, LotResult, ManzanoLoteMethod, SliceResult, SubdivisionMethod, SubdivisionOptions,
    SubdivisionResult,
};
use crate::types::Pt;
use serde_json::{json, Value};

const NARROW_RATIO: f64 = 1.6;

// ─── computeCuts ──────────────────────────────────────────────────────

fn compute_cuts(
    half_poly: &[Pt],
    half_ext: Extent1D,
    lx: f64,
    ly: f64,
    sx: f64,
    sy: f64,
    target_area_m2: f64,
    front_min_m: f64,
) -> Option<Vec<CutResult>> {
    let ext_sh = project_extents(half_poly, sx, sy);
    let real_depth_m = ext_sh.max - ext_sh.min;
    if real_depth_m < 0.001 {
        return None;
    }
    let nom_front_m = front_min_m.max(target_area_m2 / real_depth_m);
    let mut cuts: Vec<CutResult> = Vec::new();
    let mut t = half_ext.min;
    let mut lot_count = 0;

    while t < half_ext.max - 1e-9 {
        let remaining = half_ext.max - t;
        let rest_poly = clip_to_strip(half_poly, lx, ly, t, half_ext.max);
        if rest_poly.len() < 3 {
            break;
        }
        let rest_area_m2 = poly_area(&rest_poly);
        if rest_area_m2 < target_area_m2 * 0.5 {
            cuts.push(CutResult { t: half_ext.max, is_remnant: true });
            break;
        }
        let nom_front_w = nom_front_m;
        let n_remaining = (remaining / nom_front_w).round();
        if n_remaining <= 1.0 || remaining - nom_front_w < nom_front_w * 0.05 {
            cuts.push(CutResult {
                t: half_ext.max,
                is_remnant: rest_area_m2 < target_area_m2 * 0.5,
            });
            break;
        }

        let mut lo = front_min_m;
        let mut hi = remaining * 0.999;
        let mut best_f = nom_front_w;
        let mut best_err = f64::INFINITY;

        for _ in 0..120 {
            let mid = (lo + hi) / 2.0;
            let test_poly = clip_to_strip(half_poly, lx, ly, t, t + mid);
            if test_poly.len() < 3 {
                lo = mid;
                continue;
            }
            let area = poly_area(&test_poly);
            let err = area - target_area_m2;
            if err.abs() < best_err.abs() {
                best_err = err;
                best_f = mid;
            }
            if err.abs() <= 1e-6 {
                break;
            }
            if err < 0.0 {
                lo = mid;
            } else {
                hi = mid;
            }
        }

        if best_f < front_min_m * 0.99 {
            best_f = front_min_m;
        }
        t += best_f;
        cuts.push(CutResult { t, is_remnant: false });
        lot_count += 1;
        if lot_count > 500 {
            break;
        }
    }
    Some(cuts)
}

// ─── computeLotsOnHalf ──────────────────────────────────────────────────

fn compute_lots_on_half(
    full_poly: &[Pt],
    ext_l: Extent1D,
    ext_s: Extent1D,
    lx: f64,
    ly: f64,
    sx: f64,
    sy: f64,
    target_area_m2: f64,
    front_min_m: f64,
) -> Vec<LotResult> {
    let cuts = match compute_cuts(full_poly, ext_l, lx, ly, sx, sy, target_area_m2, front_min_m) {
        Some(c) => c,
        None => return Vec::new(),
    };
    let mut lots: Vec<LotResult> = Vec::new();
    let mut prev_t = ext_l.min;

    for cut in &cuts {
        let actual_end = cut.t.min(ext_l.max);
        if actual_end <= prev_t + 1e-6 {
            break;
        }
        let strip_poly = clip_to_strip(full_poly, lx, ly, prev_t, actual_end);
        if strip_poly.len() < 3 {
            prev_t = actual_end;
            continue;
        }
        let area_m2 = poly_area(&strip_poly);
        if area_m2 < 1e-6 {
            prev_t = actual_end;
            continue;
        }
        let ext_sh = project_extents(&strip_poly, sx, sy);
        let depth_m = ext_sh.max - ext_sh.min;
        lots.push(LotResult {
            pts: strip_poly,
            is_remnant: cut.is_remnant || area_m2 < target_area_m2 * 0.5,
            front_m: actual_end - prev_t,
            depth_m: if depth_m > 0.0 { depth_m } else { ext_s.max - ext_s.min },
            area_m2,
        });
        prev_t = actual_end;
        if actual_end >= ext_l.max - 1e-6 {
            break;
        }
    }

    if prev_t < ext_l.max - 1e-6 {
        let rem_poly = clip_to_strip(full_poly, lx, ly, prev_t, ext_l.max);
        if rem_poly.len() >= 3 {
            let area_m2 = poly_area(&rem_poly);
            if area_m2 > 1e-6 {
                lots.push(LotResult {
                    pts: rem_poly,
                    is_remnant: area_m2 < target_area_m2 * 0.5,
                    front_m: ext_l.max - prev_t,
                    depth_m: ext_s.max - ext_s.min,
                    area_m2,
                });
            }
        }
    }
    lots
}

// ─── subdivideHalf ──────────────────────────────────────────────────────

fn subdivide_half(
    poly: &[Pt],
    lx: f64,
    ly: f64,
    sx: f64,
    sy: f64,
    ext_l: Extent1D,
    target_area_m2: f64,
    front_min_m: f64,
    _is_remnant: bool,
    out: &mut Vec<LotResult>,
) {
    let mut t = ext_l.min;
    let mut lot_count = 0;
    let ext_sh = project_extents(poly, sx, sy);
    let half_depth_m = (ext_sh.max - ext_sh.min).max(0.001);

    while t < ext_l.max - 1e-9 {
        let remaining = ext_l.max - t;
        let rest_poly = clip_to_strip(poly, lx, ly, t, ext_l.max);
        if rest_poly.len() < 3 {
            break;
        }
        let rest_area = poly_area(&rest_poly);
        let probe_width = (front_min_m * 0.5).min(remaining * 0.1);
        let col_probe = clip_to_strip(poly, lx, ly, t, t + probe_width.max(0.5));
        let mut depth_local = half_depth_m;
        if col_probe.len() >= 3 {
            let e_p = project_extents(&col_probe, sx, sy);
            let d = e_p.max - e_p.min;
            if d > 0.5 {
                depth_local = d;
            }
        }
        let nom_front_m = front_min_m.max(target_area_m2 / depth_local);
        let nom_front_w = nom_front_m;
        let n_remaining = (remaining / nom_front_w).round();

        if rest_area < target_area_m2 * 0.5
            || n_remaining <= 1.0
            || remaining - nom_front_w < nom_front_w * 0.05
        {
            let ext_sr = project_extents(&rest_poly, sx, sy);
            out.push(LotResult {
                pts: rest_poly,
                is_remnant: true,
                front_m: remaining,
                depth_m: ext_sr.max - ext_sr.min,
                area_m2: rest_area,
            });
            break;
        }

        let mut lo = front_min_m * 0.1;
        let mut hi = remaining * 0.9999;
        let mut best_f = nom_front_w;
        let mut best_err = f64::INFINITY;

        for _ in 0..160 {
            let mid = (lo + hi) / 2.0;
            let test = clip_to_strip(poly, lx, ly, t, t + mid);
            if test.len() < 3 {
                lo = mid;
                continue;
            }
            let area = poly_area(&test);
            let err = area - target_area_m2;
            if err.abs() < best_err.abs() {
                best_err = err;
                best_f = mid;
            }
            if err.abs() <= 1e-6 {
                break;
            }
            if err < 0.0 {
                lo = mid;
            } else {
                hi = mid;
            }
        }

        if best_f < front_min_m * 0.99 {
            best_f = front_min_m;
        }
        let lot_poly = clip_to_strip(poly, lx, ly, t, t + best_f);
        if lot_poly.len() < 3 || poly_area(&lot_poly) < 0.5 {
            break;
        }
        let area_m2 = poly_area(&lot_poly);
        let ext_sl = project_extents(&lot_poly, sx, sy);
        out.push(LotResult {
            pts: lot_poly,
            is_remnant: false,
            front_m: best_f,
            depth_m: ext_sl.max - ext_sl.min,
            area_m2,
        });
        t += best_f;
        lot_count += 1;
        if lot_count > 500 {
            break;
        }
    }
}

// ─── subdivideManzanoAuto (PCA / modo2) ────────────────────────────────

/// <- `subdivideManzanoAuto`
pub fn subdivide_manzano_auto(
    mzn_pts: &[Pt],
    target_area_m2: f64,
    front_min_m: f64,
    dir_pref: Option<(f64, f64)>,
) -> Vec<LotResult> {
    if mzn_pts.len() < 3 {
        return Vec::new();
    }
    let total_area = poly_area(mzn_pts);
    if total_area < target_area_m2 * 0.15 {
        return Vec::new();
    }

    let (lx, ly) = match dir_pref {
        Some((ax, ay)) => (ax, ay),
        None => {
            let pa = principal_axis(mzn_pts);
            (pa.ux, pa.uy)
        }
    };
    let (sx, sy) = (-ly, lx);
    let ext_s = project_extents(mzn_pts, sx, sy);
    let ext_l = project_extents(mzn_pts, lx, ly);
    let total_short_m = ext_s.max - ext_s.min;
    let nom_depth_m = target_area_m2 / front_min_m.max(1.0);
    let is_narrow = total_short_m < NARROW_RATIO * nom_depth_m;

    if is_narrow {
        return compute_lots_on_half(mzn_pts, ext_l, ext_s, lx, ly, sx, sy, target_area_m2, front_min_m);
    }

    let s_mid = (ext_s.min + ext_s.max) / 2.0;
    let half_bot = clip_to_strip(mzn_pts, sx, sy, ext_s.min, s_mid);
    let half_top = clip_to_strip(mzn_pts, sx, sy, s_mid, ext_s.max);
    let half_bot_ok = half_bot.len() >= 3 && poly_area(&half_bot) >= target_area_m2 * 0.1;
    let half_top_ok = half_top.len() >= 3 && poly_area(&half_top) >= target_area_m2 * 0.1;

    if !half_bot_ok && !half_top_ok {
        return compute_lots_on_half(mzn_pts, ext_l, ext_s, lx, ly, sx, sy, target_area_m2, front_min_m);
    }
    if !half_bot_ok {
        let ext_l_top = project_extents(&half_top, lx, ly);
        let ext_s_top = project_extents(&half_top, sx, sy);
        return compute_lots_on_half(&half_top, ext_l_top, ext_s_top, lx, ly, sx, sy, target_area_m2, front_min_m);
    }
    if !half_top_ok {
        let ext_l_bot = project_extents(&half_bot, lx, ly);
        let ext_s_bot = project_extents(&half_bot, sx, sy);
        return compute_lots_on_half(&half_bot, ext_l_bot, ext_s_bot, lx, ly, sx, sy, target_area_m2, front_min_m);
    }

    let ext_l_bot = project_extents(&half_bot, lx, ly);
    let ext_l_top = project_extents(&half_top, lx, ly);
    let span_bot = ext_l_bot.max - ext_l_bot.min;
    let span_top = ext_l_top.max - ext_l_top.min;
    let master_idx = if span_top > span_bot { 1 } else { 0 };
    let master_poly: &[Pt] = if master_idx == 0 { &half_bot } else { &half_top };
    let master_ext = if master_idx == 0 { ext_l_bot } else { ext_l_top };
    let master_cuts = compute_cuts(master_poly, master_ext, lx, ly, sx, sy, target_area_m2, front_min_m);

    let master_cuts = match master_cuts {
        Some(c) if !c.is_empty() => c,
        _ => {
            let mut all_lots = Vec::new();
            let ext_s_bot2 = project_extents(&half_bot, sx, sy);
            all_lots.extend(compute_lots_on_half(
                &half_bot, ext_l_bot, ext_s_bot2, lx, ly, sx, sy, target_area_m2, front_min_m,
            ));
            let ext_s_top2 = project_extents(&half_top, sx, sy);
            all_lots.extend(compute_lots_on_half(
                &half_top, ext_l_top, ext_s_top2, lx, ly, sx, sy, target_area_m2, front_min_m,
            ));
            return all_lots;
        }
    };

    let mut all_lots: Vec<LotResult> = Vec::new();
    for (half_poly, half_ext) in [(&half_bot, ext_l_bot), (&half_top, ext_l_top)] {
        let ext_sh = project_extents(half_poly, sx, sy);
        let real_depth_m = (ext_sh.max - ext_sh.min).max(0.001);
        let my_min = half_ext.min;
        let my_max = half_ext.max;
        let mut prev_t = my_min;

        for cut in &master_cuts {
            let actual_end = cut.t.min(my_max);
            if actual_end <= prev_t + 1e-6 {
                continue;
            }
            let strip_poly = clip_to_strip(half_poly, lx, ly, prev_t, actual_end);
            if strip_poly.len() < 3 {
                continue;
            }
            let area_m2 = poly_area(&strip_poly);
            if area_m2 < 0.5 {
                continue;
            }
            let ext_s_strip = project_extents(&strip_poly, sx, sy);
            let depth_m = (ext_s_strip.max - ext_s_strip.min).max(real_depth_m);
            let is_remnant = cut.is_remnant || area_m2 < target_area_m2 * 0.5;
            all_lots.push(LotResult {
                pts: strip_poly,
                is_remnant,
                front_m: actual_end - prev_t,
                depth_m,
                area_m2,
            });
            prev_t = actual_end;
            if actual_end >= my_max - 1e-6 {
                break;
            }
        }

        if prev_t < my_max - 1e-6 {
            let rem_poly = clip_to_strip(half_poly, lx, ly, prev_t, my_max);
            if rem_poly.len() >= 3 {
                let area_m2 = poly_area(&rem_poly);
                if area_m2 >= 0.5 {
                    let ext_s_rem = project_extents(&rem_poly, sx, sy);
                    all_lots.push(LotResult {
                        pts: rem_poly,
                        is_remnant: area_m2 < target_area_m2 * 0.5,
                        front_m: my_max - prev_t,
                        depth_m: (ext_s_rem.max - ext_s_rem.min).max(real_depth_m),
                        area_m2,
                    });
                }
            }
        }
    }
    all_lots
}

// ─── subdivideManzanoExact ──────────────────────────────────────────────

/// <- `subdivideManzanoExact`
pub fn subdivide_manzano_exact(
    mzn_pts: &[Pt],
    target_area_m2: f64,
    front_min_m: f64,
    dir_pref: Option<(f64, f64)>,
) -> Vec<LotResult> {
    if mzn_pts.len() < 3 {
        return Vec::new();
    }
    let total_area = poly_area(mzn_pts);
    if total_area < target_area_m2 * 0.15 {
        return Vec::new();
    }

    let (lx, ly) = match dir_pref {
        Some((ax, ay)) => (ax, ay),
        None => {
            let pa = principal_axis(mzn_pts);
            (pa.ux, pa.uy)
        }
    };
    let (sx, sy) = (-ly, lx);
    let ext_s = project_extents(mzn_pts, sx, sy);
    let nom_depth_w = target_area_m2 / front_min_m.max(1.0);
    let total_depth_m = ext_s.max - ext_s.min;
    let global_narrow = total_depth_m < NARROW_RATIO * nom_depth_w;
    let ext_l = project_extents(mzn_pts, lx, ly);
    let mut all_lots: Vec<LotResult> = Vec::new();

    if global_narrow {
        subdivide_half(mzn_pts, lx, ly, sx, sy, ext_l, target_area_m2, front_min_m, false, &mut all_lots);
    } else {
        let s_mid = (ext_s.min + ext_s.max) / 2.0;
        let half_bot = clip_to_strip(mzn_pts, sx, sy, ext_s.min, s_mid);
        let half_top = clip_to_strip(mzn_pts, sx, sy, s_mid, ext_s.max);
        let half_bot_ok = half_bot.len() >= 3 && poly_area(&half_bot) >= target_area_m2 * 0.1;
        let half_top_ok = half_top.len() >= 3 && poly_area(&half_top) >= target_area_m2 * 0.1;

        if !half_bot_ok && !half_top_ok {
            subdivide_half(mzn_pts, lx, ly, sx, sy, ext_l, target_area_m2, front_min_m, false, &mut all_lots);
        } else if !half_bot_ok {
            let ext_l_top = project_extents(&half_top, lx, ly);
            subdivide_half(&half_top, lx, ly, sx, sy, ext_l_top, target_area_m2, front_min_m, false, &mut all_lots);
        } else if !half_top_ok {
            let ext_l_bot = project_extents(&half_bot, lx, ly);
            subdivide_half(&half_bot, lx, ly, sx, sy, ext_l_bot, target_area_m2, front_min_m, false, &mut all_lots);
        } else {
            let ext_l_bot = project_extents(&half_bot, lx, ly);
            subdivide_half(&half_bot, lx, ly, sx, sy, ext_l_bot, target_area_m2, front_min_m, false, &mut all_lots);
            let ext_l_top = project_extents(&half_top, lx, ly);
            subdivide_half(&half_top, lx, ly, sx, sy, ext_l_top, target_area_m2, front_min_m, false, &mut all_lots);
        }
    }
    all_lots
}

// ─── sliceBisectManzano (manual-slice) ─────────────────────────────────

/// <- `sliceBisectManzano`
pub fn slice_bisect_manzano(
    wp: &[Pt],
    target_area_m2: f64,
    frente_seg: (Pt, Pt),
    aux_seg: (Pt, Pt),
) -> Option<SliceResult> {
    const TOL_M2: f64 = 1e-6;
    let total_area = poly_area(wp);
    let aux_dx = aux_seg.1 .0 - aux_seg.0 .0;
    let aux_dy = aux_seg.1 .1 - aux_seg.0 .1;
    let aux_len = aux_dx.hypot(aux_dy);
    if aux_len < 1e-10 {
        return None;
    }
    let adv_x = aux_dx / aux_len;
    let adv_y = aux_dy / aux_len;
    let cut_x = -aux_dy / aux_len;
    let cut_y = aux_dx / aux_len;
    let cen = centroid(wp);
    let cen_adv_proj = cen.0 * adv_x + cen.1 * adv_y;
    let projs: Vec<f64> = wp.iter().map(|p| p.0 * adv_x + p.1 * adv_y).collect();
    let proj_min = projs.iter().cloned().fold(f64::INFINITY, f64::min);
    let proj_max = projs.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let proj_range = proj_max - proj_min;
    if proj_range < 1e-9 {
        return None;
    }

    const N_FRENTE: usize = 11;
    let mut frente_points: Vec<Pt> = Vec::with_capacity(N_FRENTE + 1);
    for k in 0..=N_FRENTE {
        let kf = k as f64 / N_FRENTE as f64;
        frente_points.push((
            frente_seg.0 .0 + (frente_seg.1 .0 - frente_seg.0 .0) * kf,
            frente_seg.0 .1 + (frente_seg.1 .1 - frente_seg.0 .1) * kf,
        ));
    }
    let frente_adv_projs: Vec<f64> = frente_points.iter().map(|p| p.0 * adv_x + p.1 * adv_y).collect();
    let frente_proj_med = (frente_adv_projs.iter().cloned().fold(f64::INFINITY, f64::min)
        + frente_adv_projs.iter().cloned().fold(f64::NEG_INFINITY, f64::max))
        / 2.0;
    let frente_es_min = (frente_proj_med - proj_min).abs() <= (frente_proj_med - proj_max).abs();

    let fragment_contains_fronte = |poly: &[Pt]| -> bool {
        let mut cnt = 0usize;
        for p in &frente_points {
            if point_in_poly(p.0, p.1, poly) {
                cnt += 1;
            }
        }
        cnt as f64 >= (frente_points.len() as f64 * 0.5).ceil()
    };

    struct RawHit {
        x: f64,
        y: f64,
        seg_idx: usize,
        u: f64,
        t_cut: f64,
    }

    let eval_t = |t: f64| -> Option<SliceResult> {
        let proj = if frente_es_min {
            proj_min + t * proj_range
        } else {
            proj_max - t * proj_range
        };
        let ox = cen.0 + (proj - cen_adv_proj) * adv_x;
        let oy = cen.1 + (proj - cen_adv_proj) * adv_y;
        const FAR: f64 = 1e7;
        let r_a: Pt = (ox + cut_x * FAR, oy + cut_y * FAR);
        let r_b: Pt = (ox - cut_x * FAR, oy - cut_y * FAR);
        let n = wp.len();
        let mut raw_hits: Vec<RawHit> = Vec::new();
        for i in 0..n {
            let a = wp[i];
            let b = wp[(i + 1) % n];
            let d1x = b.0 - a.0;
            let d1y = b.1 - a.1;
            let d2x = r_b.0 - r_a.0;
            let d2y = r_b.1 - r_a.1;
            let denom = d1x * d2y - d1y * d2x;
            if denom.abs() < 1e-10 {
                continue;
            }
            let tt = ((r_a.0 - a.0) * d2y - (r_a.1 - a.1) * d2x) / denom;
            let u = ((r_a.0 - a.0) * d1y - (r_a.1 - a.1) * d1x) / denom;
            if tt < -1e-9 || tt > 1.0 + 1e-9 || u < -1e-9 || u > 1.0 + 1e-9 {
                continue;
            }
            raw_hits.push(RawHit {
                x: a.0 + tt * d1x,
                y: a.1 + tt * d1y,
                seg_idx: i,
                u: tt.max(0.0).min(1.0),
                t_cut: u,
            });
        }
        if raw_hits.len() < 2 {
            return None;
        }
        raw_hits.sort_by(|a, b| a.t_cut.partial_cmp(&b.t_cut).unwrap_or(std::cmp::Ordering::Equal));
        let mut hits: Vec<RawHit> = Vec::new();
        hits.push(raw_hits.remove(0));
        for h in raw_hits {
            let last = hits.last().unwrap();
            if (h.x - last.x).hypot(h.y - last.y) > 1e-6 {
                hits.push(h);
            }
        }
        if hits.len() < 2 {
            return None;
        }

        for i in 0..hits.len() - 1 {
            let h_a = &hits[i];
            let h_b = &hits[i + 1];
            let mx = (h_a.x + h_b.x) / 2.0;
            let my = (h_a.y + h_b.y) / 2.0;
            if !point_in_poly(mx, my, wp) {
                continue;
            }
            let sl = build_cut_polys(
                wp,
                PolyHit { seg_idx: h_a.seg_idx, u: h_a.u, pt: (h_a.x, h_a.y) },
                PolyHit { seg_idx: h_b.seg_idx, u: h_b.u, pt: (h_b.x, h_b.y) },
            );
            let sl = match sl {
                Some(s) if s.poly1.len() >= 3 && s.poly2.len() >= 3 => s,
                _ => continue,
            };
            let p1_has_f = fragment_contains_fronte(&sl.poly1);
            let p2_has_f = fragment_contains_fronte(&sl.poly2);
            let (front, rest) = if p1_has_f && !p2_has_f {
                (sl.poly1, sl.poly2)
            } else if p2_has_f && !p1_has_f {
                (sl.poly2, sl.poly1)
            } else {
                let f_mx = (frente_seg.0 .0 + frente_seg.1 .0) / 2.0;
                let f_my = (frente_seg.0 .1 + frente_seg.1 .1) / 2.0;
                let c1 = centroid(&sl.poly1);
                let c2 = centroid(&sl.poly2);
                let d1 = (c1.0 - f_mx).hypot(c1.1 - f_my);
                let d2 = (c2.0 - f_mx).hypot(c2.1 - f_my);
                if d1 <= d2 {
                    (sl.poly1, sl.poly2)
                } else {
                    (sl.poly2, sl.poly1)
                }
            };
            let area_m2 = poly_area(&front);
            return Some(SliceResult { front, rest, area_m2 });
        }
        None
    };

    const N_SAMPLES: usize = 50;
    struct Sample {
        t: f64,
        area_m2: f64,
    }
    let mut samples: Vec<Sample> = Vec::new();
    for k in 1..N_SAMPLES {
        let t = k as f64 / N_SAMPLES as f64;
        if let Some(ev) = eval_t(t) {
            samples.push(Sample { t, area_m2: ev.area_m2 });
        }
    }
    if samples.is_empty() {
        return None;
    }

    struct Cross {
        lo: f64,
        hi: f64,
    }
    let mut crosses: Vec<Cross> = Vec::new();
    for i in 0..samples.len() - 1 {
        let s0 = &samples[i];
        let s1 = &samples[i + 1];
        if (s0.area_m2 - target_area_m2) * (s1.area_m2 - target_area_m2) <= 0.0 {
            crosses.push(Cross { lo: s0.t, hi: s1.t });
        }
    }

    let (mut best_lo, mut best_hi): (Option<f64>, Option<f64>) = (None, None);
    if crosses.is_empty() {
        let mut best_sample = &samples[0];
        let mut best_err = f64::INFINITY;
        for s in &samples {
            let e = (s.area_m2 - target_area_m2).abs();
            if e < best_err {
                best_err = e;
                best_sample = s;
            }
        }
        return eval_t(best_sample.t);
    }

    if crosses.len() == 1 {
        best_lo = Some(crosses[0].lo);
        best_hi = Some(crosses[0].hi);
    } else {
        let mut best_score = f64::INFINITY;
        for cr in &crosses {
            let t_mid = (cr.lo + cr.hi) / 2.0;
            let ev_mid = match eval_t(t_mid) {
                Some(e) => e,
                None => continue,
            };
            let rel_err = (ev_mid.area_m2 - target_area_m2).abs() / total_area;
            let t_penalty = (t_mid - 0.5).abs() * 0.05;
            let score = rel_err + t_penalty;
            if score < best_score {
                best_score = score;
                best_lo = Some(cr.lo);
                best_hi = Some(cr.hi);
            }
        }
        if best_lo.is_none() {
            best_lo = Some(crosses[0].lo);
            best_hi = Some(crosses[0].hi);
        }
    }

    let best_lo = best_lo.unwrap();
    let best_hi = best_hi.unwrap();

    let ev_lo0 = match eval_t(best_lo) {
        Some(e) => e,
        None => return eval_t((best_lo + best_hi) / 2.0),
    };
    let increasing = ev_lo0.area_m2 < target_area_m2;
    let mut lo = best_lo;
    let mut hi = best_hi;
    let mut best: Option<SliceResult> = None;
    let mut best_err = f64::INFINITY;

    for _ in 0..200 {
        let mid = (lo + hi) / 2.0;
        match eval_t(mid) {
            None => {
                let ev_q1 = eval_t(lo + (mid - lo) * 0.5);
                let ev_q2 = eval_t(mid + (hi - mid) * 0.5);
                if let Some(e1) = &ev_q1 {
                    let err1 = (e1.area_m2 - target_area_m2).abs();
                    if err1 < best_err {
                        best_err = err1;
                        best = Some(e1.clone());
                    }
                }
                if let Some(e2) = &ev_q2 {
                    let err2 = (e2.area_m2 - target_area_m2).abs();
                    if err2 < best_err {
                        best_err = err2;
                        best = Some(e2.clone());
                    }
                }
                if ev_q1.is_some() {
                    hi = mid;
                } else if ev_q2.is_some() {
                    lo = mid;
                } else {
                    break;
                }
            }
            Some(ev) => {
                let err = (ev.area_m2 - target_area_m2).abs();
                if err < best_err {
                    best_err = err;
                    best = Some(ev.clone());
                }
                if err <= TOL_M2 {
                    break;
                }
                let err_signed = ev.area_m2 - target_area_m2;
                if increasing {
                    if err_signed < 0.0 {
                        lo = mid;
                    } else {
                        hi = mid;
                    }
                } else if err_signed > 0.0 {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
        }
    }
    best
}

// ─── Saneo + dispatchers ────────────────────────────────────────────────

fn sanitize_lot_results(lots: Vec<LotResult>, context: &str) -> Vec<LotResult> {
    let mut out = Vec::with_capacity(lots.len());
    for lot in lots {
        let cleaned = match sanitize_ring(Some(lot.pts.as_slice()), SanitizeRingOptions::default(), context) {
            Some(c) => c,
            None => continue,
        };
        let mut pts = cleaned;
        pts.pop(); // sanitize_ring cierra el anillo; acá volvemos a anillo abierto (== `.slice(0,-1)` en TS)
        out.push(LotResult { pts, ..lot });
    }
    out
}

/// <- `subdivideManzano` (dispatcher por `ManzanoLoteMethod`)
pub fn subdivide_manzano(
    ring_pts: &[Pt],
    method: ManzanoLoteMethod,
    target_area_m2: f64,
    front_min_m: f64,
    dir_pref: Option<(f64, f64)>,
) -> Vec<LotResult> {
    if ring_pts.len() < 3 {
        return Vec::new();
    }
    let mut pts: Vec<Pt> = ring_pts.to_vec();
    let first = pts[0];
    let last = *pts.last().unwrap();
    if first.0 != last.0 || first.1 != last.1 {
        pts.push(first);
    }
    let lots = match method {
        ManzanoLoteMethod::Exact => subdivide_manzano_exact(&pts, target_area_m2, front_min_m, dir_pref),
        ManzanoLoteMethod::Modo2 => subdivide_manzano_auto(&pts, target_area_m2, front_min_m, dir_pref),
        ManzanoLoteMethod::Auto => crate::subdivision_cabecera_cuerpo::subdivide_manzano_cabecera_cuerpo(
            &pts,
            target_area_m2,
            front_min_m,
            dir_pref,
        ),
    };
    sanitize_lot_results(lots, "subdivisionAlgorithms.subdivideManzano")
}

fn subdivision_method_to_str(m: SubdivisionMethod) -> &'static str {
    match m {
        SubdivisionMethod::Auto => "auto",
        SubdivisionMethod::Modo2 => "modo2",
        SubdivisionMethod::Exact => "exact",
        SubdivisionMethod::ManualSlice => "manual-slice",
    }
}

fn to_geojson_feature(pts: &[Pt], properties: Value) -> Value {
    let mut ring = pts.to_vec();
    let first = ring[0];
    let last = *ring.last().unwrap();
    if first.0 != last.0 || first.1 != last.1 {
        ring.push(first);
    }
    json!({
        "type": "Feature",
        "properties": properties,
        "geometry": crate::geojson::polygon_geometry_from_outer_ring(&ring),
    })
}

/// <- `subdivide` (dispatcher por `SubdivisionMethod`, incluye manual-slice).

pub fn subdivide(polygon_coordinates: &[Vec<Pt>], opts: &SubdivisionOptions) -> SubdivisionResult {
    let ring = match polygon_coordinates.first() {
        Some(r) if r.len() >= 3 => r,
        _ => {
            return SubdivisionResult {
                ok: false,
                features: Vec::new(),
                warnings: Vec::new(),
                error: Some("Polígono inválido".to_string()),
            };
        }
    };

    let mut pts: Vec<Pt> = ring.clone();
    let first = pts[0];
    let last = *pts.last().unwrap();
    if first.0 != last.0 || first.1 != last.1 {
        pts.push(first);
    }

    let target_area_m2 = opts.target_area_m2.unwrap_or(250.0);
    let front_min_m = opts.front_min_m.unwrap_or(12.0);
    let dir_pref = opts.dir_ax.map(|ax| (ax, opts.dir_ay.unwrap_or(0.0)));

    let mut warnings: Vec<String> = Vec::new();

    let lots: Vec<LotResult> = match opts.method {
        SubdivisionMethod::Auto => crate::subdivision_cabecera_cuerpo::subdivide_manzano_cabecera_cuerpo(
            &pts,
            target_area_m2,
            front_min_m,
            dir_pref,
        ),
        SubdivisionMethod::Modo2 => subdivide_manzano_auto(&pts, target_area_m2, front_min_m, dir_pref),
        SubdivisionMethod::Exact => subdivide_manzano_exact(&pts, target_area_m2, front_min_m, dir_pref),
        SubdivisionMethod::ManualSlice => {
            let bisect_result = if let Some(cut_line) = &opts.cut_line {
                let dx = cut_line.p2.0 - cut_line.p1.0;
                let dy = cut_line.p2.1 - cut_line.p1.1;
                let len = dx.hypot(dy);
                if len < 1e-10 {
                    return SubdivisionResult {
                        ok: false,
                        features: Vec::new(),
                        warnings,
                        error: Some("Línea de corte muy corta".to_string()),
                    };
                }
                let fake_frente = (cut_line.p1, cut_line.p2);
                let fake_aux = ((0.0, 0.0), (-dy / len, dx / len));
                slice_bisect_manzano(&pts, target_area_m2, fake_frente, fake_aux)
            } else if let (Some(frente_seg), Some(aux_seg)) = (&opts.frente_seg, &opts.aux_seg) {
                slice_bisect_manzano(
                    &pts,
                    target_area_m2,
                    (frente_seg.a, frente_seg.b),
                    (aux_seg.a, aux_seg.b),
                )
            } else {
                return SubdivisionResult {
                    ok: false,
                    features: Vec::new(),
                    warnings,
                    error: Some("Falta frenteSeg+auxSeg o cutLine para manual-slice".to_string()),
                };
            };

            match bisect_result {
                Some(r) => {
                    let front_area = poly_area(&r.front);
                    let rest_area = poly_area(&r.rest);
                    vec![
                        LotResult { pts: r.front, is_remnant: false, front_m: 0.0, depth_m: 0.0, area_m2: front_area },
                        LotResult { pts: r.rest, is_remnant: true, front_m: 0.0, depth_m: 0.0, area_m2: rest_area },
                    ]
                }
                None => {
                    return SubdivisionResult {
                        ok: false,
                        features: Vec::new(),
                        warnings,
                        error: Some("Bisección falló".to_string()),
                    };
                }
            }
        }
    };

    if lots.is_empty() {
        return SubdivisionResult {
            ok: false,
            features: Vec::new(),
            warnings,
            error: Some("No se generaron lotes".to_string()),
        };
    }

    let lots_len = lots.len();
    let sanitized_lots = sanitize_lot_results(lots, "subdivisionAlgorithms.subdivide");
    if sanitized_lots.is_empty() {
        return SubdivisionResult {
            ok: false,
            features: Vec::new(),
            warnings,
            error: Some("Los lotes generados quedaron con geometría degenerada tras el saneo".to_string()),
        };
    }
    if sanitized_lots.len() < lots_len {
        warnings.push(format!(
            "{} lote(s) descartado(s) por geometría degenerada.",
            lots_len - sanitized_lots.len()
        ));
    }

    let remnant_count = sanitized_lots.iter().filter(|l| l.is_remnant).count();
    warnings.push(format!(
        "{} lotes generados ({} remanentes)",
        sanitized_lots.len(),
        remnant_count
    ));

    let method_str = subdivision_method_to_str(opts.method);
    let features: Vec<Value> = sanitized_lots
        .iter()
        .enumerate()
        .map(|(i, lot)| {
            let label = if lot.is_remnant {
                format!("Remanente {}", i + 1)
            } else {
                format!("Lote {}", i + 1)
            };
            to_geojson_feature(
                &lot.pts,
                json!({
                    "subdivision": method_str,
                    "label": label,
                    "areaM2": lot.area_m2,
                    "frontM": lot.front_m,
                    "depthM": lot.depth_m,
                    "isRemnant": lot.is_remnant,
                }),
            )
        })
        .collect();

    SubdivisionResult { ok: true, features, warnings, error: None }
}