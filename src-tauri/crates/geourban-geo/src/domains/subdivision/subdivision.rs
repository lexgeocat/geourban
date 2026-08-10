use crate::kernel::math::{clip_to_strip, poly_area, principal_axis, project_extents, Extent1D};
use crate::kernel::sanitize::{sanitize_ring, SanitizeRingOptions};
use crate::kernel::types::Pt;
use crate::kernel::types::{CutResult, LotResult, ManzanoLoteMethod};

const NARROW_RATIO: f64 = 1.6;

#[allow(clippy::too_many_arguments)]
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
            cuts.push(CutResult {
                t: half_ext.max,
                is_remnant: true,
            });
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
        cuts.push(CutResult {
            t,
            is_remnant: false,
        });
        lot_count += 1;
        if lot_count > 500 {
            break;
        }
    }
    Some(cuts)
}

#[allow(clippy::too_many_arguments)]
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
    let cuts = match compute_cuts(
        full_poly,
        ext_l,
        lx,
        ly,
        sx,
        sy,
        target_area_m2,
        front_min_m,
    ) {
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
            continue;
        }
        let area_m2 = poly_area(&strip_poly);
        if area_m2 < 1e-6 {
            continue;
        }
        let ext_sh = project_extents(&strip_poly, sx, sy);
        let depth_m = ext_sh.max - ext_sh.min;
        lots.push(LotResult {
            pts: strip_poly,
            is_remnant: cut.is_remnant || area_m2 < target_area_m2 * 0.5,
            front_m: actual_end - prev_t,
            depth_m: if depth_m > 0.0 {
                depth_m
            } else {
                ext_s.max - ext_s.min
            },
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
        } else if lots.is_empty() {
            let area_m2 = poly_area(full_poly);
            if area_m2 > 1e-6 {
                lots.push(LotResult {
                    pts: full_poly.to_vec(),
                    is_remnant: true,
                    front_m: ext_l.max - ext_l.min,
                    depth_m: ext_s.max - ext_s.min,
                    area_m2,
                });
            }
        }
    }
    lots
}

#[allow(clippy::too_many_arguments)]
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

        let mut lo = front_min_m.max(1e-6);
        let mut hi = (remaining * 0.9999).max(lo);
        let mut best_f = nom_front_w.max(lo).min(hi);
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
        if best_f < front_min_m {
            best_f = front_min_m.min(remaining);
        }

        let lot_poly = clip_to_strip(poly, lx, ly, t, t + best_f);
        if lot_poly.len() < 3 || poly_area(&lot_poly) < 0.5 {
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
        return compute_lots_on_half(
            mzn_pts,
            ext_l,
            ext_s,
            lx,
            ly,
            sx,
            sy,
            target_area_m2,
            front_min_m,
        );
    }

    let s_mid = (ext_s.min + ext_s.max) / 2.0;
    let half_bot = clip_to_strip(mzn_pts, sx, sy, ext_s.min, s_mid);
    let half_top = clip_to_strip(mzn_pts, sx, sy, s_mid, ext_s.max);
    let half_bot_ok = half_bot.len() >= 3 && poly_area(&half_bot) >= target_area_m2 * 0.1;
    let half_top_ok = half_top.len() >= 3 && poly_area(&half_top) >= target_area_m2 * 0.1;

    if !half_bot_ok && !half_top_ok {
        return compute_lots_on_half(
            mzn_pts,
            ext_l,
            ext_s,
            lx,
            ly,
            sx,
            sy,
            target_area_m2,
            front_min_m,
        );
    }
    if !half_bot_ok {
        let ext_l_top = project_extents(&half_top, lx, ly);
        let ext_s_top = project_extents(&half_top, sx, sy);
        return compute_lots_on_half(
            &half_top,
            ext_l_top,
            ext_s_top,
            lx,
            ly,
            sx,
            sy,
            target_area_m2,
            front_min_m,
        );
    }
    if !half_top_ok {
        let ext_l_bot = project_extents(&half_bot, lx, ly);
        let ext_s_bot = project_extents(&half_bot, sx, sy);
        return compute_lots_on_half(
            &half_bot,
            ext_l_bot,
            ext_s_bot,
            lx,
            ly,
            sx,
            sy,
            target_area_m2,
            front_min_m,
        );
    }

    let ext_l_bot = project_extents(&half_bot, lx, ly);
    let ext_l_top = project_extents(&half_top, lx, ly);
    let span_bot = ext_l_bot.max - ext_l_bot.min;
    let span_top = ext_l_top.max - ext_l_top.min;
    let master_idx = if span_top > span_bot { 1 } else { 0 };
    let master_poly: &[Pt] = if master_idx == 0 {
        &half_bot
    } else {
        &half_top
    };
    let master_ext = if master_idx == 0 {
        ext_l_bot
    } else {
        ext_l_top
    };
    let master_cuts = compute_cuts(
        master_poly,
        master_ext,
        lx,
        ly,
        sx,
        sy,
        target_area_m2,
        front_min_m,
    );

    let master_cuts = match master_cuts {
        Some(c) if !c.is_empty() => c,
        _ => {
            let mut all_lots = Vec::new();
            let ext_s_bot2 = project_extents(&half_bot, sx, sy);
            all_lots.extend(compute_lots_on_half(
                &half_bot,
                ext_l_bot,
                ext_s_bot2,
                lx,
                ly,
                sx,
                sy,
                target_area_m2,
                front_min_m,
            ));
            let ext_s_top2 = project_extents(&half_top, sx, sy);
            all_lots.extend(compute_lots_on_half(
                &half_top,
                ext_l_top,
                ext_s_top2,
                lx,
                ly,
                sx,
                sy,
                target_area_m2,
                front_min_m,
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
        subdivide_half(
            mzn_pts,
            lx,
            ly,
            sx,
            sy,
            ext_l,
            target_area_m2,
            front_min_m,
            false,
            &mut all_lots,
        );
    } else {
        let s_mid = (ext_s.min + ext_s.max) / 2.0;
        let half_bot = clip_to_strip(mzn_pts, sx, sy, ext_s.min, s_mid);
        let half_top = clip_to_strip(mzn_pts, sx, sy, s_mid, ext_s.max);
        let half_bot_ok = half_bot.len() >= 3 && poly_area(&half_bot) >= target_area_m2 * 0.1;
        let half_top_ok = half_top.len() >= 3 && poly_area(&half_top) >= target_area_m2 * 0.1;

        if !half_bot_ok && !half_top_ok {
            subdivide_half(
                mzn_pts,
                lx,
                ly,
                sx,
                sy,
                ext_l,
                target_area_m2,
                front_min_m,
                false,
                &mut all_lots,
            );
        } else if !half_bot_ok {
            let ext_l_top = project_extents(&half_top, lx, ly);
            subdivide_half(
                &half_top,
                lx,
                ly,
                sx,
                sy,
                ext_l_top,
                target_area_m2,
                front_min_m,
                false,
                &mut all_lots,
            );
        } else if !half_top_ok {
            let ext_l_bot = project_extents(&half_bot, lx, ly);
            subdivide_half(
                &half_bot,
                lx,
                ly,
                sx,
                sy,
                ext_l_bot,
                target_area_m2,
                front_min_m,
                false,
                &mut all_lots,
            );
        } else {
            let ext_l_bot = project_extents(&half_bot, lx, ly);
            subdivide_half(
                &half_bot,
                lx,
                ly,
                sx,
                sy,
                ext_l_bot,
                target_area_m2,
                front_min_m,
                false,
                &mut all_lots,
            );
            let ext_l_top = project_extents(&half_top, lx, ly);
            subdivide_half(
                &half_top,
                lx,
                ly,
                sx,
                sy,
                ext_l_top,
                target_area_m2,
                front_min_m,
                false,
                &mut all_lots,
            );
        }
    }
    all_lots
}

fn sanitize_lot_results(lots: Vec<LotResult>, context: &str) -> Vec<LotResult> {
    let mut out = Vec::with_capacity(lots.len());
    for lot in lots {
        let cleaned = match sanitize_ring(
            Some(lot.pts.as_slice()),
            SanitizeRingOptions::default(),
            context,
        ) {
            Some(c) => c,
            None => continue,
        };
        let mut pts = cleaned;
        pts.pop(); // sanitize_ring cierra el anillo; volvemos a anillo abierto (== `.slice(0,-1)` en TS)

        let area_m2 = if lot.area_m2.is_finite() {
            lot.area_m2
        } else {
            poly_area(&pts)
        };
        let front_m = if lot.front_m.is_finite() {
            lot.front_m
        } else {
            0.0
        };
        let depth_m = if lot.depth_m.is_finite() {
            lot.depth_m
        } else {
            0.0
        };

        out.push(LotResult {
            pts,
            area_m2,
            front_m,
            depth_m,
            ..lot
        });
    }
    out
}

const MIN_FRONTAGE_MERGE_TOL_M: f64 = 1e-3;
const MIN_FRONTAGE_MIN_SHARED_EDGE_M: f64 = 0.3;

fn bbox_front_depth(pts: &[Pt]) -> (f64, f64) {
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
    (dx.min(dy), dx.max(dy))
}

fn shared_edge_length(a: &[Pt], b: &[Pt]) -> f64 {
    const EPS: f64 = 0.05;
    let na = a.len();
    let nb = b.len();
    if na < 2 || nb < 2 {
        return 0.0;
    }
    let mut total = 0.0;
    for i in 0..na {
        let a1 = a[i];
        let a2 = a[(i + 1) % na];
        for j in 0..nb {
            let b1 = b[j];
            let b2 = b[(j + 1) % nb];
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

fn union_two_lot_rings(a: &[Pt], b: &[Pt]) -> Option<Vec<Pt>> {
    let merged = crate::boolean_ops::union_rings(
        &[a.to_vec(), b.to_vec()],
        "subdivisionAlgorithms.enforceMinFrontage",
    );
    if merged.len() != 1 || merged[0].len() != 1 {
        return None;
    }
    let mut ring = merged[0][0].clone();
    if ring.len() > 1 {
        let (fx, fy) = ring[0];
        let (lxp, lyp) = ring[ring.len() - 1];
        if (fx - lxp).abs() < 1e-9 && (fy - lyp).abs() < 1e-9 {
            ring.pop();
        }
    }
    let mut cleaned = sanitize_ring(
        Some(ring.as_slice()),
        SanitizeRingOptions::default(),
        "subdivisionAlgorithms.enforceMinFrontage.merged",
    )?;
    cleaned.pop(); // volver a anillo abierto, como el resto del módulo
    Some(cleaned)
}

fn enforce_min_frontage(lots: Vec<LotResult>, front_min_m: f64) -> Vec<LotResult> {
    if front_min_m <= 0.0 || lots.len() < 2 {
        return lots;
    }
    let before = lots.len();
    let mut lots = lots;
    let max_passes = before + 8;
    let mut pass = 0;
    let mut merges = 0usize;

    loop {
        pass += 1;
        if pass > max_passes {
            break;
        }
        let offender = lots.iter().position(|l| {
            !l.is_remnant && l.front_m > 1e-6 && l.front_m < front_min_m - MIN_FRONTAGE_MERGE_TOL_M
        });
        let idx = match offender {
            Some(v) => v,
            None => break,
        };

        let mut best_j: Option<usize> = None;
        let mut best_shared = 0.0_f64;
        for j in 0..lots.len() {
            if j == idx {
                continue;
            }
            let shared = shared_edge_length(&lots[idx].pts, &lots[j].pts);
            if shared > best_shared {
                best_shared = shared;
                best_j = Some(j);
            }
        }

        let j = match best_j {
            Some(v) => v,
            None => {
                lots[idx].is_remnant = true;
                continue;
            }
        };
        if best_shared < MIN_FRONTAGE_MIN_SHARED_EDGE_M {
            lots[idx].is_remnant = true;
            continue;
        }

        let merged_pts = match union_two_lot_rings(&lots[idx].pts, &lots[j].pts) {
            Some(pts) if pts.len() >= 3 => pts,
            _ => {
                lots[idx].is_remnant = true;
                continue;
            }
        };

        let area_m2 = poly_area(&merged_pts);
        let (front_m, depth_m) = bbox_front_depth(&merged_pts);
        let still_short = front_m < front_min_m - MIN_FRONTAGE_MERGE_TOL_M;

        let (lo, hi) = if idx < j { (idx, j) } else { (j, idx) };
        lots.remove(hi);
        lots.remove(lo);
        lots.push(LotResult {
            pts: merged_pts,
            is_remnant: still_short,
            front_m,
            depth_m,
            area_m2,
        });
        merges += 1;
    }

    if merges > 0 {
        log::warn!(
            "subdivisionAlgorithms.enforceMinFrontage: {} lote(s) fusionados para respetar el frente mínimo de {:.2} m ({} -> {} lotes).",
            merges, front_min_m, before, lots.len(),
        );
    }

    lots
}

fn fill_lot_coverage_gaps(outer_ring: &[Pt], lots: &[LotResult]) -> Vec<LotResult> {
    const MIN_GAP_AREA_M2: f64 = 0.5;
    let covering: Vec<Vec<Pt>> = lots.iter().map(|l| l.pts.clone()).collect();
    let gaps = crate::kernel::boolean_ops::fill_polygon_gaps(outer_ring, &covering);
    gaps.into_iter()
        .filter_map(|ring| {
            let area_m2 = poly_area(&ring);
            if area_m2 < MIN_GAP_AREA_M2 {
                return None;
            }
            let n = ring.len();
            let mut best = 0.0_f64;
            for i in 0..n {
                let a = ring[i];
                let b = ring[(i + 1) % n];
                let l = (b.0 - a.0).hypot(b.1 - a.1);
                if l > best {
                    best = l;
                }
            }
            let (front_m, depth_m) = if best > 1e-6 { (best, area_m2 / best) } else { (0.0, 0.0) };
            log::warn!(
                "subdivisionAlgorithms: hueco de {area_m2:.2} m² sin lotizar detectado — se agrega como lote remanente."
            );
            Some(LotResult { pts: ring, is_remnant: true, front_m, depth_m, area_m2 })
        })
        .collect()
}

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

    if pts.iter().any(|p| !p.0.is_finite() || !p.1.is_finite()) {
        return Vec::new();
    }
    let first = pts[0];
    let last = *pts.last().unwrap();
    if first.0 != last.0 || first.1 != last.1 {
        pts.push(first);
    }

    let lots = match method {
        ManzanoLoteMethod::Exact => {
            subdivide_manzano_exact(&pts, target_area_m2, front_min_m, dir_pref)
        }
        ManzanoLoteMethod::Modo2 => {
            subdivide_manzano_auto(&pts, target_area_m2, front_min_m, dir_pref)
        }
        ManzanoLoteMethod::Auto => {
            crate::subdivision_cabecera_cuerpo::subdivide_manzano_cabecera_cuerpo(
                &pts,
                target_area_m2,
                front_min_m,
                dir_pref,
            )
        }
    };
    let sanitized = sanitize_lot_results(lots, "subdivisionAlgorithms.subdivideManzano");

    let mut result = match method {
        ManzanoLoteMethod::Auto => sanitized,
        _ => enforce_min_frontage(sanitized, front_min_m),
    };

    let gaps = fill_lot_coverage_gaps(&pts, &result);
    if !gaps.is_empty() {
        result.extend(gaps);
    }
    result
}
