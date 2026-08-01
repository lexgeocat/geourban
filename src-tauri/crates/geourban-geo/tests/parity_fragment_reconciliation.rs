//! Test de paridad TS ↔ Rust para `match_fragments_to_members`.
//!
//! Single source of truth = `tests/fixtures/fragRecParitySnapshot.json`.
//! El test TS (`src/geo/roads/__parity__/fragmentReconciliation.parity.test.ts`)
//! lo genera y `npm run parity:sync` lo copia a este path. Si no existe,
//! el test falla con un mensaje claro.
//!
//! Criterio de éxito: el motor Rust produce el mismo count de assignments,
//! los mismos `member_idx` (Some/None) y `overlap_area` que el motor TS,
//! dentro de tolerancia.

#![cfg(feature = "geos-backend")]

use geourban_geo::fragment_reconciliation::match_fragments_to_members;
use serde::Deserialize;
use std::path::PathBuf;

const AREA_TOL_M2: f64 = 1e-3;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotAssignment {
    fragment_idx: usize,
    member_idx: Option<usize>,
    overlap_area: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotFixture {
    name: String,
    fragment_count: usize,
    member_count: usize,
    assignments: Vec<SnapshotAssignment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    #[allow(dead_code)]
    version: u32,
    #[allow(dead_code)]
    generated_at: String,
    fixtures: Vec<SnapshotFixture>,
}

fn snapshot_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests");
    p.push("fixtures");
    p.push("fragRecParitySnapshot.json");
    p
}

fn approx(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol
}

/// Cuadrado abierto (4 vértices). Misma función que en las fixtures TS.
fn sq(x0: f64, y0: f64, side: f64) -> Vec<(f64, f64)> {
    vec![
        (x0, y0),
        (x0 + side, y0),
        (x0 + side, y0 + side),
        (x0, y0 + side),
    ]
}

/// Mapa de fixtures → datos de entrada. Sincronizado con
/// `src/geo/roads/__parity__/fragmentReconciliationParityFixtures.ts`.
/// Si la lista allá cambia, este mapa debe actualizarse.
fn fixture_inputs(name: &str) -> (Vec<Vec<(f64, f64)>>, Vec<Vec<(f64, f64)>>) {
    match name {
        "caso_identidad" => (
            vec![sq(0.0, 0.0, 10.0)],
            vec![sq(0.0, 0.0, 10.0)],
        ),
        "caso_parcial" => (
            vec![sq(1.0, 1.0, 9.0)],
            vec![sq(0.0, 0.0, 10.0)],
        ),
        "caso_sin_match" => (
            vec![sq(0.0, 0.0, 10.0)],
            vec![sq(100.0, 100.0, 10.0)],
        ),
        "caso_bajo_umbral" => (
            vec![sq(9.5, 9.5, 10.0)],
            vec![sq(0.0, 0.0, 10.0)],
        ),
        "caso_multi_fragmentos" => (
            vec![sq(0.0, 0.0, 10.0), sq(30.0, 30.0, 10.0)],
            vec![sq(0.0, 0.0, 10.0), sq(30.0, 30.0, 10.0)],
        ),
        "caso_competencia" => (
            vec![sq(0.0, 0.0, 12.0), sq(0.0, 0.0, 8.0)],
            vec![sq(0.0, 0.0, 20.0)],
        ),
        other => panic!(
            "Fixture desconocida en snapshot: {other}. \
             Actualiza `fixture_inputs` en tests/parity_fragment_reconciliation.rs \
             y fragmentReconciliationParityFixtures.ts para mantenerlas sincronizadas."
        ),
    }
}

#[test]
fn parity_con_snapshot_ts() {
    let path = snapshot_path();
    assert!(
        path.exists(),
        "Snapshot ausente en {}.\n\
         Corré `npm run parity:sync` desde la raiz del repo y volvé a correr `cargo test`.\n\
         El test NO skipea: la primera corrida tiene que romper hasta que\n\
         el snapshot esté commiteado en el repo.",
        path.display()
    );
    let raw = std::fs::read_to_string(&path).expect("leer snapshot");
    let snap: Snapshot = serde_json::from_str(&raw).expect("parsear snapshot");

    assert!(!snap.fixtures.is_empty(), "snapshot sin fixtures");

    for fx in &snap.fixtures {
        let (fragments, member_rings) = fixture_inputs(&fx.name);

        // Sanity: el snapshot concuerda con el conteo de inputs.
        assert_eq!(
            fragments.len(),
            fx.fragment_count,
            "{}: fragment_count difiere",
            fx.name
        );
        assert_eq!(
            member_rings.len(),
            fx.member_count,
            "{}: member_count difiere",
            fx.name
        );

        let assignments = match_fragments_to_members(&fragments, &member_rings);

        // Mismo conteo de assignments.
        assert_eq!(
            assignments.len(),
            fx.assignments.len(),
            "{}: assignment count difiere (rust={} ts={})",
            fx.name,
            assignments.len(),
            fx.assignments.len(),
        );

        // Comparar cada assignment en el mismo orden.
        for (i, (a, e)) in assignments.iter().zip(fx.assignments.iter()).enumerate() {
            assert_eq!(
                a.fragment_idx, e.fragment_idx,
                "{}: assignments[{}].fragment_idx difiere (rust={} ts={})",
                fx.name, i, a.fragment_idx, e.fragment_idx,
            );
            assert_eq!(
                a.member_idx, e.member_idx,
                "{}: assignments[{}].member_idx difiere (rust={:?} ts={:?})",
                fx.name, i, a.member_idx, e.member_idx,
            );
            assert!(
                approx(a.overlap_area, e.overlap_area, AREA_TOL_M2),
                "{}: assignments[{}].overlap_area difiere (rust={:.6} ts={:.6} diff={:.6})",
                fx.name,
                i,
                a.overlap_area,
                e.overlap_area,
                (a.overlap_area - e.overlap_area).abs(),
            );
        }
    }
}
