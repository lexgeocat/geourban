use serde::{Deserialize, Serialize};

use crate::kernel::boolean_ops::ring_intersection_area;
use crate::kernel::math::poly_area;
use crate::kernel::sanitize::{sanitize_ring, SanitizeRingOptions};
use crate::kernel::types::Pt;
pub const MATCH_MIN_RATIO: f64 = 0.35;
const MATCH_COMPLEXITY_WARNING: usize = 20_000;
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

    for (fi, assigned) in frag_assigned.iter().enumerate() {
        if !*assigned {
            assignments.push(FragmentAssignment {
                fragment_idx: fi,
                member_idx: None,
                overlap_area: 0.0,
            });
        }
    }

    assignments
}
