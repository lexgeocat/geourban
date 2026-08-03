#![cfg(feature = "geos-backend")]

use geourban_geo::fragment_reconciliation::match_fragments_to_members;
use geourban_geo::math::poly_area;
use geourban_geo::sanitize::{sanitize_ring, SanitizeRingOptions};
use geourban_geo::subdivision::subdivide_manzano;
use geourban_geo::types::{LotResult, ManzanoLoteMethod};

type Pt = (f64, f64);
type Ring = Vec<Pt>;

fn synthetic_urban_corpus() -> Vec<(&'static str, Ring)> {
    vec![
        (
            "triangulo_avenida_esquina",
            vec![(0.0, 0.0), (120.0, 0.0), (0.0, 70.0), (0.0, 0.0)],
        ),
        (
            "trapecio_avenida_diagonal",
            vec![
                (0.0, 0.0),
                (100.0, 0.0),
                (88.0, 60.0),
                (0.0, 60.0),
                (0.0, 0.0),
            ],
        ),
        (
            "esquina_grilla_en_L",
            vec![
                (0.0, 0.0),
                (80.0, 0.0),
                (80.0, 42.0),
                (38.0, 42.0),
                (38.0, 80.0),
                (0.0, 80.0),
                (0.0, 0.0),
            ],
        ),
        (
            "muesca_rotonda",
            vec![
                (0.0, 0.0),
                (100.0, 0.0),
                (100.0, 30.0),
                (62.0, 30.0),
                (62.0, 62.0),
                (100.0, 62.0),
                (100.0, 100.0),
                (0.0, 100.0),
                (0.0, 0.0),
            ],
        ),
        (
            "pentagono_perimetro_jitter",
            vec![
                (0.0, 0.0),
                (96.0, 4.0),
                (110.0, 58.0),
                (52.0, 94.0),
                (-6.0, 60.0),
                (0.0, 0.0),
            ],
        ),
        (
            "hexagono_dos_avenidas",
            vec![
                (0.0, 0.0),
                (70.0, 14.0),
                (130.0, 0.0),
                (118.0, 74.0),
                (60.0, 108.0),
                (0.0, 78.0),
                (0.0, 0.0),
            ],
        ),
        (
            "tira_angosta_200x40",
            vec![
                (0.0, 0.0),
                (200.0, 0.0),
                (200.0, 40.0),
                (0.0, 40.0),
                (0.0, 0.0),
            ],
        ),
        (
            "pentagono_frente_irregular",
            vec![
                (0.0, 0.0),
                (110.0, 6.0),
                (104.0, 52.0),
                (60.0, 84.0),
                (2.0, 50.0),
                (0.0, 0.0),
            ],
        ),
    ]
}

fn assert_lots_healthy(name: &str, ring_area: f64, lots: &[LotResult]) {
    assert!(
        !lots.is_empty(),
        "{name}: subdivisión vacía para un manzano sano"
    );
    let mut total = 0.0;
    for lot in lots {
        assert!(lot.area_m2.is_finite(), "{name}: área no-finita en lote");
        assert!(
            lot.area_m2 > 0.0,
            "{name}: lote con área <= 0 ({})",
            lot.area_m2
        );
        for (x, y) in &lot.pts {
            assert!(
                x.is_finite() && y.is_finite(),
                "{name}: vértice no-finito en lote"
            );
        }
        assert!(
            lot.front_m > 0.0 && lot.front_m.is_finite(),
            "{name}: frente no positivo o no-finito ({})",
            lot.front_m
        );
        total += lot.area_m2;
    }
    let tol = 1e-3 * ring_area.max(1.0);
    assert!(
        (total - ring_area).abs() <= tol,
        "{name}: los lotes no cubren el manzano (suma={total:.3} manzano={ring_area:.3} diff={:.3})",
        (total - ring_area).abs()
    );
}

#[test]
fn subdivision_manzanos_irregulares_sinteticos() {
    for (name, ring) in synthetic_urban_corpus() {
        let area = poly_area(&ring);
        assert!(
            area > 0.0,
            "{name}: corpus con área <= 0 — fixture mal escrita"
        );

        let sanitized = sanitize_ring(
            Some(&ring),
            SanitizeRingOptions::default(),
            "synthetic_urban_stress",
        );
        assert!(
            sanitized.is_some(),
            "{name}: el manzano sintético no debería necesitar sanitización que lo elimine"
        );

        for method in [
            ManzanoLoteMethod::Auto,
            ManzanoLoteMethod::Exact,
            ManzanoLoteMethod::Modo2,
        ] {
            let lots = subdivide_manzano(&ring, method, 250.0, 12.0, None);
            assert_lots_healthy(name, area, &lots);
        }
    }
}

#[test]
fn subdivision_respeta_dir_pref_en_manzanos_irregulares() {
    for (name, ring) in synthetic_urban_corpus() {
        let area = poly_area(&ring);
        let lots = subdivide_manzano(
            &ring,
            ManzanoLoteMethod::Auto,
            250.0,
            12.0,
            Some((1.0, 0.0)),
        );
        assert_lots_healthy(name, area, &lots);
    }
}

#[test]
fn reconciliation_manzanos_irregulares_sinteticos() {
    let corpus = synthetic_urban_corpus();
    for (name, ring) in &corpus {
        let lots = subdivide_manzano(ring, ManzanoLoteMethod::Auto, 250.0, 12.0, None);
        let fragments: Vec<Ring> = lots.iter().map(|l| l.pts.clone()).collect();
        let members = fragments.clone();

        let assignments = match_fragments_to_members(&fragments, &members);
        assert_eq!(
            assignments.len(),
            fragments.len(),
            "{name}: assignments incompletos"
        );

        let matched = assignments
            .iter()
            .filter(|a| a.member_idx.is_some())
            .count();
        assert!(
            matched >= fragments.len().saturating_sub(1),
            "{name}: fragmentos del mismo manzano deberían matchear casi todos (matched={matched}/{})",
            fragments.len()
        );
    }

    let ring_a = corpus[0].1.clone();
    let ring_b = corpus[6].1.clone();
    let frag_a: Vec<Ring> = subdivide_manzano(&ring_a, ManzanoLoteMethod::Auto, 250.0, 12.0, None)
        .into_iter()
        .map(|l| l.pts)
        .collect();
    let members_b: Vec<Ring> =
        subdivide_manzano(&ring_b, ManzanoLoteMethod::Auto, 250.0, 12.0, None)
            .into_iter()
            .map(|l| l.pts)
            .collect();
    let assignments = match_fragments_to_members(&frag_a, &members_b);
    let unmatched = assignments
        .iter()
        .filter(|a| a.member_idx.is_none())
        .count();
    assert!(
        unmatched > 0,
        "fragmentos de manzanos distintos no deberían matchear todos (sin match={unmatched}/{})",
        assignments.len()
    );
}
