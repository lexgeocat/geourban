use std::time::Instant;

use geos::{ContextHandle, CoordDimensions, CoordSeq, Geom, Geometry, GeometryTypes};
use serde::Serialize;
use std::cell::RefCell;

use crate::math::orient_ring_ccw;
use crate::roads::{
    build_road_network_rings, build_road_only_rings, round_ring_reflex, ExtraM, ForceTreat,
};
use crate::sanitize::{sanitize_ring, sanitize_rings, SanitizeRingOptions};
use crate::types::{CornerMode, Pt, RoundaboutParams, Street};
pub const MAX_UNION_POINTS: usize = 15_000;
pub const MAX_UNION_SHAPES: usize = 800;
pub const UNION_TIME_WARNING_MS: u64 = 300;
const UNION_PRECISION: f64 = 1e6;

fn round_for_union(v: f64) -> f64 {
    (v * UNION_PRECISION).round() / UNION_PRECISION
}

fn round_ring_for_union(ring: &[Pt]) -> Vec<Pt> {
    ring.iter()
        .map(|&(x, y)| (round_for_union(x), round_for_union(y)))
        .collect()
}

fn close_ring(ring: &[Pt]) -> Vec<Pt> {
    if ring.is_empty() {
        return ring.to_vec();
    }
    let f = ring[0];
    let l = *ring.last().unwrap();
    if (f.0 - l.0).abs() > 1e-9 || (f.1 - l.1).abs() > 1e-9 {
        let mut out = ring.to_vec();
        out.push(f);
        out
    } else {
        ring.to_vec()
    }
}

thread_local! {
    static GEOS_CTX: RefCell<Option<ContextHandle<'static>>> = const { RefCell::new(None) };
}

fn ensure_geos_ctx() {
    GEOS_CTX.with(|cell| {
        let mut borrow = cell.borrow_mut();
        if borrow.is_none() {
            let ctx = ContextHandle::init().expect("GEOS_init_r no debería fallar");
            let ctx: ContextHandle<'static> =
        unsafe { std::mem::transmute::<ContextHandle<'_>, ContextHandle<'static>>(ctx) };
            *borrow = Some(ctx);
        }
    });
}

fn ring_to_linear_ring(ring: &[Pt]) -> Result<Geometry<'static>, geos::Error> {
    let closed = close_ring(ring);
    let n = closed.len();
    let mut cs = CoordSeq::new(n as u32, CoordDimensions::TwoD)?;
    for (i, &(x, y)) in closed.iter().enumerate() {
        cs.set_x(i, x)?;
        cs.set_y(i, y)?;
    }
    let geom = Geometry::create_linear_ring(cs)?;
    Ok(unsafe { std::mem::transmute::<Geometry<'_>, Geometry<'static>>(geom) })
}

fn ring_to_polygon(ring: &[Pt]) -> Result<Geometry<'static>, geos::Error> {
    let shell = ring_to_linear_ring(ring)?;
    let poly = Geometry::create_polygon(shell, vec![])?;
    Ok(unsafe { std::mem::transmute::<Geometry<'_>, Geometry<'static>>(poly) })
}
pub(crate) fn ring_intersection_area(a: &[Pt], b: &[Pt]) -> f64 {
    if a.len() < 3 || b.len() < 3 {
        return 0.0;
    }
    ensure_geos_ctx();

    let poly_a = match ring_to_polygon(a) {
        Ok(p) => p,
        Err(err) => {
            log::warn!(
                "fragmentReconciliation: no se pudo construir el polígono A ({} vértices) para intersección — overlap=0. {err:?}",
                a.len(),
            );
            return 0.0;
        }
    };
    let poly_b = match ring_to_polygon(b) {
        Ok(p) => p,
        Err(err) => {
            log::warn!(
                "fragmentReconciliation: no se pudo construir el polígono B ({} vértices) para intersección — overlap=0. {err:?}",
                b.len(),
            );
            return 0.0;
        }
    };

    match poly_a.intersection(&poly_b) {
        Ok(inter) => inter.area().unwrap_or(0.0).max(0.0),
        Err(err) => {
            log::warn!(
                "fragmentReconciliation: intersection() falló — overlap=0 para este par. aVertices={} bVertices={} {err:?}",
                a.len(),
                b.len(),
            );
            0.0
        }
    }
}

fn rings_to_polygon(rings: &[Vec<Pt>]) -> Result<Geometry<'static>, geos::Error> {
    let shell = ring_to_linear_ring(&rings[0])?;
    let mut holes = Vec::with_capacity(rings.len().saturating_sub(1));
    for hole in rings.iter().skip(1) {
        holes.push(ring_to_linear_ring(hole)?);
    }
    let poly = Geometry::create_polygon(shell, holes)?;
    Ok(unsafe { std::mem::transmute::<Geometry<'_>, Geometry<'static>>(poly) })
}

fn coord_seq_to_ring(cs: &CoordSeq) -> Result<Vec<Pt>, geos::Error> {
    let n = cs.size()?;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        out.push((cs.get_x(i)?, cs.get_y(i)?));
    }
    Ok(out)
}
fn polygon_to_rings<'a, G: Geom<'a>>(poly: &G) -> Result<Vec<Vec<Pt>>, geos::Error> {
    let mut rings = Vec::new();
    let exterior = poly.get_exterior_ring()?;
    rings.push(coord_seq_to_ring(&exterior.get_coord_seq()?)?);

    let n_holes = poly.get_num_interior_rings()?;
    for i in 0..n_holes {
        let hole = poly.get_interior_ring_n(i as u32)?;
        rings.push(coord_seq_to_ring(&hole.get_coord_seq()?)?);
    }
    Ok(rings)
}

fn split_into_polygon_geoms(
    geom: &Geometry<'static>,
) -> Result<Vec<Geometry<'static>>, geos::Error> {
    let geom_type = geom.geometry_type();
    match geom_type {
        GeometryTypes::Polygon => {
            if geom.is_empty()? {
                Ok(Vec::new())
            } else {
                let rings = polygon_to_rings(geom)?;
                Ok(vec![rings_to_polygon(&rings)?])
            }
        }
        GeometryTypes::MultiPolygon | GeometryTypes::GeometryCollection => {
            let n = geom.get_num_geometries()?;
            let mut out = Vec::with_capacity(n);
            for i in 0..n {
                let part = geom.get_geometry_n(i)?;
                if part.geometry_type() == GeometryTypes::Polygon && !part.is_empty()? {
                    let rings = polygon_to_rings(&part)?;
                    out.push(rings_to_polygon(&rings)?);
                }
            }
            Ok(out)
        }
        _ => Ok(Vec::new()),
    }
}

fn geometry_to_polygons(geom: &Geometry<'static>) -> Result<Vec<Vec<Vec<Pt>>>, geos::Error> {
    let geom_type = geom.geometry_type();
    match geom_type {
        GeometryTypes::Polygon => {
            if geom.is_empty()? {
                Ok(Vec::new())
            } else {
                Ok(vec![polygon_to_rings(geom)?])
            }
        }
        GeometryTypes::MultiPolygon | GeometryTypes::GeometryCollection => {
            let n = geom.get_num_geometries()?;
            let mut out = Vec::with_capacity(n);
            for i in 0..n {
                let part = geom.get_geometry_n(i)?;
                if part.geometry_type() == GeometryTypes::Polygon && !part.is_empty()? {
                    out.push(polygon_to_rings(&part)?);
                }
            }
            Ok(out)
        }
        _ => Ok(Vec::new()),
    }
}

fn union_polygons_with_retry(
    polygons: &[Vec<Vec<Pt>>],
    warn_prefix: &str,
) -> Option<Geometry<'static>> {
    ensure_geos_ctx();
    let base: Vec<Geometry<'static>> = polygons
        .iter()
        .filter_map(|rings| rings_to_polygon(rings).ok())
        .collect();
    if base.is_empty() {
        return None;
    }

    match unary_union_of_geoms(base) {
        Ok(unioned) => Some(unioned),
        Err(err1) => {
            log::warn!(
                "{warn_prefix}: unión directa falló, reintentando con auto-limpieza por polígono individual. {err1:?}"
            );

            let retry_base: Vec<Geometry<'static>> = polygons
                .iter()
                .filter_map(|rings| rings_to_polygon(rings).ok())
                .collect();

            let mut self_cleaned: Vec<Geometry<'static>> = Vec::new();
            for g in &retry_base {
                match g.unary_union() {
                    Ok(cleaned) => match split_into_polygon_geoms(&cleaned) {
                        Ok(parts) => self_cleaned.extend(parts),
                        Err(err_split) => log::warn!(
                            "{warn_prefix}: no se pudieron separar los componentes de un polígono auto-limpiado — se descarta. {err_split:?}"
                        ),
                    },
                    Err(err_self) => log::warn!(
                        "{warn_prefix}: auto-limpieza de un polígono individual también falló — se descarta. {err_self:?}"
                    ),
                }
            }

            if self_cleaned.is_empty() {
                return None;
            }

            match unary_union_of_geoms(self_cleaned) {
                Ok(unioned) => Some(unioned),
                Err(err2) => {
                    log::warn!(
                        "{warn_prefix}: unión falló sin recuperación (revisá si alguna vía tiene una curva muy cerrada para su ancho/offset): {err2:?}"
                    );
                    None
                }
            }
        }
    }
}

fn unary_union_of_geoms(polys: Vec<Geometry<'static>>) -> Result<Geometry<'static>, geos::Error> {
    let mut it = polys.into_iter();
    let first = it
        .next()
        .expect("unary_union_of_geoms: llamar solo con `polys` no vacío");
    match it.next() {
        None => {
            let result: Geometry<'static> = first.unary_union()?;
            Ok(unsafe { std::mem::transmute::<Geometry<'_>, Geometry<'static>>(result) })
        }
        Some(second) => {
            let mut rest = vec![first, second];
            rest.extend(it);
            let collection = Geometry::create_geometry_collection(rest)?;
            let result: Geometry<'static> = collection.unary_union()?;
            Ok(unsafe { std::mem::transmute::<Geometry<'_>, Geometry<'static>>(result) })
        }
    }
}

pub fn union_rings(rings: &[Vec<Pt>], context: &str) -> Vec<Vec<Vec<Pt>>> {
    if rings.is_empty() {
        return Vec::new();
    }

    let sanitized = sanitize_rings(rings, SanitizeRingOptions::default(), context);
    if sanitized.is_empty() {
        return Vec::new();
    }

    let total_points: usize = sanitized.iter().map(|r| r.len()).sum();
    if total_points > MAX_UNION_POINTS || sanitized.len() > MAX_UNION_SHAPES {
        log::warn!(
            "roadNetworkNet: unión omitida — {} anillo(s) / {} punto(s) totales supera el límite de seguridad \
             (shapes: {MAX_UNION_SHAPES}, points: {MAX_UNION_POINTS}). Se dibuja cada calle sin fusionar. \
             Revisá geometría de vías por segmentos degenerados o duplicados.",
            sanitized.len(),
            total_points,
        );
        return sanitized.into_iter().map(|r| vec![r]).collect();
    }

    let rounded_polys: Vec<Vec<Vec<Pt>>> = sanitized
        .iter()
        .filter(|r| r.len() >= 3)
        .map(|r| vec![round_ring_for_union(r)])
        .collect();

    let t0 = Instant::now();
    let unioned = union_polygons_with_retry(&rounded_polys, "roadNetworkNet");
    let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
    if elapsed_ms > UNION_TIME_WARNING_MS as f64 {
        log::warn!(
            "roadNetworkNet: unión de {} polígono(s) ({} pts) tardó {:.0}ms. Si esto se repite seguido, es indicio \
             de geometría degenerada o de una red vial demasiado densa.",
            rounded_polys.len(),
            total_points,
            elapsed_ms,
        );
    }

    match unioned.and_then(|g| geometry_to_polygons(&g).ok()) {
        Some(polys) if !polys.is_empty() => polys,
        _ => sanitized.into_iter().map(|r| vec![r]).collect(),
    }
}

pub fn robust_union_road_network(road_network: &[Vec<Vec<Pt>>]) -> Option<Geometry<'static>> {
    let mut polys: Vec<Vec<Vec<Pt>>> = Vec::new();

    for rings in road_network {
        if rings.is_empty() {
            continue;
        }
        let mut sanitized_rings: Vec<Vec<Pt>> = Vec::new();
        for (ring_idx, ring) in rings.iter().enumerate() {
            let ctx = if ring_idx == 0 {
                "geoOperations.robustUnionRoadNetwork.outer"
            } else {
                "geoOperations.robustUnionRoadNetwork.hole"
            };
            if let Some(clean) =
                sanitize_ring(Some(ring.as_slice()), SanitizeRingOptions::default(), ctx)
            {
                sanitized_rings.push(clean);
            }
        }
        if sanitized_rings.is_empty() {
            continue;
        }
        let rounded: Vec<Vec<Pt>> = sanitized_rings
            .iter()
            .map(|r| round_ring_for_union(r))
            .collect();
        if rounded[0].len() >= 4 {
            polys.push(rounded);
        }
    }

    if polys.is_empty() {
        return None;
    }

    let total_points: usize = polys
        .iter()
        .map(|p| p.iter().map(|r| r.len()).sum::<usize>())
        .sum();
    let t0 = Instant::now();
    let result = union_polygons_with_retry(&polys, "computeManzanos");
    let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
    if elapsed_ms > UNION_TIME_WARNING_MS as f64 {
        log::warn!(
            "computeManzanos: unión de red vial ({} polígono(s), {} pts) tardó {:.0}ms — si esto se repite seguido, \
             revisá geometría de vías por segmentos degenerados o duplicados.",
            polys.len(),
            total_points,
            elapsed_ms,
        );
    }
    result
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManzanoFragment {
    pub orig_parcel_index: usize,
    pub rings: Vec<Vec<Pt>>,
}

pub fn compute_manzanos(
    parcels: &[Vec<Vec<Pt>>],
    road_network: &[Vec<Pt>],
) -> Vec<ManzanoFragment> {
    ensure_geos_ctx();
    let road_network_polys: Vec<Vec<Vec<Pt>>> = road_network
        .iter()
        .filter(|r| r.len() >= 3)
        .map(|r| vec![r.clone()])
        .collect();
    let road_union = robust_union_road_network(&road_network_polys);

    let mut out: Vec<ManzanoFragment> = Vec::new();

    for (index, parcel_rings) in parcels.iter().enumerate() {
        if parcel_rings.is_empty() {
            continue;
        }
        let parcel_geom = match rings_to_polygon(parcel_rings) {
            Ok(g) => g,
            Err(err) => {
                log::warn!(
                    "computeManzanos: parcela {index} con geometría inválida, se descarta. {err:?}"
                );
                continue;
            }
        };

        let diff_geom: Geometry<'static> = match &road_union {
            Some(ru) => match parcel_geom.difference(ru) {
                Ok(d) => unsafe {
                    std::mem::transmute::<Geometry<'_>, Geometry<'static>>(d)
                },
                Err(err) => {
                    log::warn!(
                        "computeManzanos: difference() falló para la parcela {index}: {err:?}"
                    );
                    continue;
                }
            },
            None => parcel_geom,
        };

        if diff_geom.is_empty().unwrap_or(true) {
            continue;
        }

        let sub_polygons = match split_into_polygon_geoms(&diff_geom) {
            Ok(v) => v,
            Err(err) => {
                log::warn!(
                    "computeManzanos: no se pudieron separar los sub-polígonos de la parcela {index}: {err:?}"
                );
                continue;
            }
        };

        for sub in &sub_polygons {
            if sub.is_empty().unwrap_or(true) {
                continue;
            }
            let area = sub.area().unwrap_or(0.0);
            if area < 0.5 {
                continue;
            }
            let raw_rings = match polygon_to_rings(sub) {
                Ok(r) => r,
                Err(err) => {
                    log::warn!(
                        "computeManzanos: no se pudieron extraer los anillos de un sub-polígono de la parcela {index}: {err:?}"
                    );
                    continue;
                }
            };

            match sanitize_manzano_fragment_rings(
                &raw_rings,
                &format!("computeManzanos.fragment[parcel={index}]"),
            ) {
                Some(cleaned) => out.push(ManzanoFragment {
                    orig_parcel_index: index,
                    rings: cleaned,
                }),
                None => log::warn!(
                    "computeManzanos: fragmento de la parcela {index} descartado tras sanitización (geometría degenerada)"
                ),
            }
        }
    }

    out
}

fn sanitize_manzano_fragment_rings(rings: &[Vec<Pt>], context: &str) -> Option<Vec<Vec<Pt>>> {
    if rings.is_empty() {
        return None;
    }
    let outer = sanitize_ring(
        Some(rings[0].as_slice()),
        SanitizeRingOptions::default(),
        &format!("{context}.outer"),
    )?;

    let mut out = Vec::with_capacity(rings.len());
    out.push(outer);
    for (i, hole) in rings.iter().skip(1).enumerate() {
        if let Some(cleaned) = sanitize_ring(
            Some(hole.as_slice()),
            SanitizeRingOptions::default(),
            &format!("{context}.hole[{i}]"),
        ) {
            out.push(cleaned);
        }
    }
    Some(out)
}

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

pub fn fill_polygon_gaps(outer_ring: &[Pt], covering_rings: &[Vec<Pt>]) -> Vec<Vec<Pt>> {
    if outer_ring.len() < 3 {
        return Vec::new();
    }
    let sanitized_outer = match sanitize_ring(
        Some(outer_ring),
        SanitizeRingOptions::default(),
        "subdivision.fillPolygonGaps.outer",
    ) {
        Some(r) => r,
        None => return Vec::new(),
    };

    ensure_geos_ctx();
    let poly_outer = match ring_to_polygon(&sanitized_outer) {
        Ok(p) => p,
        Err(err) => {
            log::warn!(
                "subdivision.fillPolygonGaps: no se pudo construir el polígono exterior: {err:?}"
            );
            return Vec::new();
        }
    };

    let covering_sanitized = sanitize_rings(
        covering_rings,
        SanitizeRingOptions::default(),
        "subdivision.fillPolygonGaps.covering",
    );
    let covering_polys: Vec<Vec<Vec<Pt>>> = covering_sanitized
        .into_iter()
        .filter(|r| r.len() >= 4)
        .map(|r| vec![r])
        .collect();
    if covering_polys.is_empty() {
        return vec![sanitized_outer];
    }

    let union_cover =
        match union_polygons_with_retry(&covering_polys, "subdivision.fillPolygonGaps") {
            Some(u) => u,
            None => return vec![sanitized_outer],
        };

    let diff: Geometry<'static> = match poly_outer.difference(&union_cover) {
        Ok(d) => unsafe { std::mem::transmute::<Geometry<'_>, Geometry<'static>>(d) },
        Err(err) => {
            log::warn!("subdivision.fillPolygonGaps: difference() falló buscando huecos: {err:?}");
            return Vec::new();
        }
    };

    if diff.is_empty().unwrap_or(true) {
        return Vec::new();
    }

    let parts = match split_into_polygon_geoms(&diff) {
        Ok(p) => p,
        Err(err) => {
            log::warn!("subdivision.fillPolygonGaps: no se pudieron separar los fragmentos de hueco: {err:?}");
            return Vec::new();
        }
    };

    parts
        .iter()
        .filter_map(|p| polygon_to_rings(p).ok())
        .filter_map(|rings| rings.into_iter().next())
        .collect()
}
