//! Puerto de `src/geo/roads/fragmentReconciliation.ts`.
//!
//! Reconcilia los fragmentos resultantes de recortar manzanos contra la
//! red vial (`compute_manzanos`) con los miembros ya existentes en el
//! proyecto (manzanos previamente creados), para preservar su identidad
//! (id, lotes hijos, método de subdivisión) a través de ediciones.
//!
//! Requiere GEOS (`ring_intersection_area`, definida en `boolean_ops.rs`)
//! para calcular el área de solapamiento entre cada par
//! fragmento×miembro — por eso este módulo, igual que `boolean_ops`, solo
//! compila contenido real bajo el feature `geos-backend`.
#![cfg(feature = "geos-backend")]

use serde::{Deserialize, Serialize};

use crate::boolean_ops::ring_intersection_area;
use crate::math::poly_area;
use crate::sanitize::{sanitize_ring, SanitizeRingOptions};
use crate::types::Pt;

/// <- `MATCH_MIN_RATIO` (fragmentReconciliation.ts).
pub const MATCH_MIN_RATIO: f64 = 0.35;

/// Umbral de pares candidatos (fragmentos × miembros) a partir del cual se
/// emite una advertencia de posible lentitud — mismo valor que
/// `MATCH_COMPLEXITY_WARNING` en el TS de origen.
const MATCH_COMPLEXITY_WARNING: usize = 20_000;

/// <- `FragmentAssignment<T>` (fragmentReconciliation.ts), especializado a
/// índices: `member_idx` reemplaza la referencia genérica `T` — el caller
/// (geo_bridge.rs) es quien sabe a qué miembro real corresponde cada
/// índice.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FragmentAssignment {
    pub fragment_idx: usize,
    pub member_idx: Option<usize>,
    pub overlap_area: f64,
}

struct Candidate {
    frag_idx: usize,
    member_idx: usize,
    overlap: f64,
}

/// <- `matchFragmentsToMembers` (fragmentReconciliation.ts).
///
/// Sanea ambos lados, calcula el área de solapamiento GEOS de cada par
/// válido, y asigna greedy por mayor solapamiento primero — un fragmento o
/// miembro ya asignado no se reconsidera. Un fragmento sin asignación
/// (por no alcanzar `MATCH_MIN_RATIO`, o por no solapar con nada) queda
/// con `member_idx: None` — indica "es una entidad nueva, sin miembro
/// previo que reciclar".
pub fn match_fragments_to_members(
    fragments: &[Vec<Pt>],
    member_rings: &[Vec<Pt>],
) -> Vec<FragmentAssignment> {
    let sanitized_fragments: Vec<Option<Vec<Pt>>> = fragments
        .iter()
        .map(|f| {
            sanitize_ring(
                Some(f.as_slice()),
                SanitizeRingOptions::default(),
                "fragmentReconciliation.matchFragmentsToMembers.fragment",
            )
        })
        .collect();
    let sanitized_members: Vec<Option<Vec<Pt>>> = member_rings
        .iter()
        .map(|m| {
            sanitize_ring(
                Some(m.as_slice()),
                SanitizeRingOptions::default(),
                "fragmentReconciliation.matchFragmentsToMembers.member",
            )
        })
        .collect();

    let valid_frag_idxs: Vec<usize> = sanitized_fragments
        .iter()
        .enumerate()
        .filter_map(|(i, r)| match r {
            Some(ring) if poly_area(ring) > 0.0 => Some(i),
            _ => None,
        })
        .collect();
    let valid_member_idxs: Vec<usize> = sanitized_members
        .iter()
        .enumerate()
        .filter_map(|(i, r)| r.as_ref().map(|_| i))
        .collect();

    let total_pairs = valid_frag_idxs
        .len()
        .saturating_mul(valid_member_idxs.len());
    if total_pairs > MATCH_COMPLEXITY_WARNING {
        log::warn!(
            "fragmentReconciliation: matchFragmentsToMembers procesando {} fragmento(s) × {} miembro(s) = {} pares candidatos — puede ser lento. Revisá si hay demasiadas vías cruzándose en la misma zona.",
            valid_frag_idxs.len(),
            valid_member_idxs.len(),
            total_pairs,
        );
    }

    let mut candidates: Vec<Candidate> = Vec::new();
    for &fi in &valid_frag_idxs {
        let frag_ring = sanitized_fragments[fi]
            .as_ref()
            .expect("fi proviene de valid_frag_idxs, que ya filtró None");
        for &mi in &valid_member_idxs {
            let member_ring = sanitized_members[mi]
                .as_ref()
                .expect("mi proviene de valid_member_idxs, que ya filtró None");
            let overlap = ring_intersection_area(frag_ring, member_ring);
            if overlap > 0.0 {
                candidates.push(Candidate {
                    frag_idx: fi,
                    member_idx: mi,
                    overlap,
                });
            }
        }
    }

    candidates.sort_by(|a, b| {
        b.overlap
            .partial_cmp(&a.overlap)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut frag_assigned = vec![false; fragments.len()];
    let mut member_assigned = vec![false; member_rings.len()];
    let mut assignments: Vec<FragmentAssignment> = Vec::new();

    for c in &candidates {
        if frag_assigned[c.frag_idx] || member_assigned[c.member_idx] {
            continue;
        }
        let frag_area = poly_area(
            sanitized_fragments[c.frag_idx]
                .as_ref()
                .expect("candidato construido solo desde fragmentos ya saneados"),
        );
        let ratio = if frag_area > 0.0 {
            c.overlap / frag_area
        } else {
            0.0
        };
        if ratio < MATCH_MIN_RATIO {
            continue;
        }
        assignments.push(FragmentAssignment {
            fragment_idx: c.frag_idx,
            member_idx: Some(c.member_idx),
            overlap_area: c.overlap,
        });
        frag_assigned[c.frag_idx] = true;
        member_assigned[c.member_idx] = true;
    }

    for fi in 0..fragments.len() {
        if !frag_assigned[fi] {
            assignments.push(FragmentAssignment {
                fragment_idx: fi,
                member_idx: None,
                overlap_area: 0.0,
            });
        }
    }

    assignments
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x0: f64, y0: f64, side: f64) -> Vec<Pt> {
        vec![
            (x0, y0),
            (x0 + side, y0),
            (x0 + side, y0 + side),
            (x0, y0 + side),
        ]
    }

    #[test]
    fn asigna_fragmento_al_miembro_con_mayor_solapamiento() {
        let member = square(0.0, 0.0, 10.0);
        let fragment = square(0.0, 0.0, 9.0); // 90% del área del miembro

        let assignments = match_fragments_to_members(&[fragment], &[member]);
        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].fragment_idx, 0);
        assert_eq!(assignments[0].member_idx, Some(0));
        assert!(assignments[0].overlap_area > 0.0);
    }

    #[test]
    fn no_asigna_si_el_solapamiento_no_alcanza_match_min_ratio() {
        let member = square(0.0, 0.0, 10.0);
        // Solo se solapa en una esquina angosta (~1% de su propia área).
        let fragment = square(9.5, 9.5, 5.0);

        let assignments = match_fragments_to_members(&[fragment], &[member]);
        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].member_idx, None);
    }

    #[test]
    fn fragmento_sin_ningun_miembro_cercano_queda_sin_asignar() {
        let member = square(100.0, 100.0, 10.0);
        let fragment = square(0.0, 0.0, 10.0);

        let assignments = match_fragments_to_members(&[fragment], &[member]);
        assert_eq!(assignments.len(), 1);
        assert_eq!(assignments[0].member_idx, None);
        assert_eq!(assignments[0].overlap_area, 0.0);
    }

    #[test]
    fn dos_fragmentos_no_compiten_por_el_mismo_miembro_una_vez_asignado() {
        let member = square(0.0, 0.0, 20.0);
        let frag_a = square(0.0, 0.0, 12.0); // mayor solapamiento (144)
        let frag_b = square(0.0, 0.0, 8.0); // menor solapamiento (64)

        let assignments = match_fragments_to_members(&[frag_a, frag_b], &[member]);
        let a0 = assignments.iter().find(|a| a.fragment_idx == 0).unwrap();
        let a1 = assignments.iter().find(|a| a.fragment_idx == 1).unwrap();
        assert_eq!(a0.member_idx, Some(0));
        assert_eq!(a1.member_idx, None);
    }
}
