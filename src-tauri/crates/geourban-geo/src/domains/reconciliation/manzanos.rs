use geos::{Geom, Geometry};

use crate::kernel::boolean_ops::{
    ensure_geos_ctx, polygon_to_rings, robust_union_road_network, rings_to_polygon,
    split_into_polygon_geoms,
};
use crate::kernel::lifetime::extend_geometry_lifetime;
use crate::kernel::sanitize::{sanitize_ring, SanitizeRingOptions};
use crate::kernel::types::Pt;

#[derive(Debug, Clone, serde::Serialize)]
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
                Ok(d) => extend_geometry_lifetime(d),
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