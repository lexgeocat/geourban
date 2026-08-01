//! Test de paridad TS (JSTS, geoOperations.ts::computeManzanos) <-> Rust
//! (GEOS, boolean_ops.rs::compute_manzanos). Cierra la Fase 2.3: hasta
//! ahora `boolean_ops.rs` solo tenia smoke tests triviales sin comparar
//! contra el motor JS con geometria representativa (union + diferencia
//! sobre parcelas + calles, incluyendo fragmentacion en MultiPolygon).
//!
//! Single source of truth = tests/fixtures/computeManzanosParitySnapshot.json,
//! generado por `npm run parity:sync`.

#![cfg(feature = "geos-backend")]

use geourban_geo::boolean_ops::compute_manzanos;
use serde::Deserialize;
use std::path::PathBuf;

const AREA_TOL_M2: f64 = 1e-2;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotSummary {
    fragment_count: usize,
    total_area: f64,
    areas_by_parcel: Vec<Vec<f64>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotFixture {
    name: String,
    summary: SnapshotSummary,
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
    p.push("computeManzanosParitySnapshot.json");
    p
}

fn approx(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol
}

fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<(f64, f64)> {
    vec![(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
}

/// Sincronizada con `computeManzanosParityFixtures.ts`.
fn fixture_inputs(name: &str) -> (Vec<Vec<Vec<(f64, f64)>>>, Vec<Vec<(f64, f64)>>) {
    match name {
        "single_road_bisects_square_parcel" => (
            vec![vec![rect(0.0, 0.0, 100.0, 100.0)]],
            vec![rect(-10.0, 45.0, 110.0, 55.0)],
        ),
        "two_perpendicular_roads_grid" => (
            vec![vec![rect(0.0, 0.0, 100.0, 100.0)]],
            vec![
                rect(-10.0, 45.0, 110.0, 55.0),
                rect(45.0, -10.0, 55.0, 110.0),
            ],
        ),
        "road_outside_parcel_leaves_parcel_intact" => (
            vec![vec![rect(0.0, 0.0, 50.0, 50.0)]],
            vec![rect(200.0, 200.0, 210.0, 260.0)],
        ),
        "road_clips_a_single_corner" => (
            vec![vec![rect(0.0, 0.0, 40.0, 40.0)]],
            vec![rect(30.0, 30.0, 50.0, 50.0)],
        ),
        "two_parcels_one_shared_road" => (
            vec![
                vec![rect(0.0, 0.0, 40.0, 40.0)],
                vec![rect(60.0, 0.0, 100.0, 40.0)],
            ],
            vec![rect(38.0, -10.0, 62.0, 50.0)],
        ),
        other => panic!(
            "Fixture desconocida en snapshot: {other}. Actualiza `fixture_inputs` en \
             tests/parity_compute_manzanos.rs y computeManzanosParityFixtures.ts."
        ),
    }
}

fn poly_area(ring: &[(f64, f64)]) -> f64 {
    let n = ring.len();
    let mut a = 0.0;
    for i in 0..n {
        let j = (i + 1) % n;
        a += ring[i].0 * ring[j].1 - ring[j].0 * ring[i].1;
    }
    (a / 2.0).abs()
}

#[test]
fn parity_con_snapshot_ts() {
    let path = snapshot_path();
    assert!(
        path.exists(),
        "Snapshot ausente en {}.\nCorre `npm run parity:sync` y luego:\n\
         cargo test -p geourban-geo --features geos-backend --test parity_compute_manzanos",
        path.display()
    );
    let raw = std::fs::read_to_string(&path).expect("leer snapshot");
    let snap: Snapshot = serde_json::from_str(&raw).expect("parsear snapshot");
    assert!(!snap.fixtures.is_empty(), "snapshot sin fixtures");

    for fx in &snap.fixtures {
        let (parcels, road_network) = fixture_inputs(&fx.name);
        let fragments = compute_manzanos(&parcels, &road_network);

        assert_eq!(
            fragments.len(),
            fx.summary.fragment_count,
            "{}: fragment_count difiere (rust={} ts={})",
            fx.name,
            fragments.len(),
            fx.summary.fragment_count,
        );

        let total_area: f64 = fragments.iter().map(|f| poly_area(&f.rings[0])).sum();
        assert!(
            approx(total_area, fx.summary.total_area, AREA_TOL_M2),
            "{}: totalArea difiere (rust={:.4} ts={:.4})",
            fx.name,
            total_area,
            fx.summary.total_area,
        );

        let mut areas_by_parcel: Vec<Vec<f64>> = vec![Vec::new(); parcels.len()];
        for f in &fragments {
            areas_by_parcel[f.orig_parcel_index].push(poly_area(&f.rings[0]));
        }
        for arr in &mut areas_by_parcel {
            arr.sort_by(|a, b| a.partial_cmp(b).unwrap());
        }

        assert_eq!(
            areas_by_parcel.len(),
            fx.summary.areas_by_parcel.len(),
            "{}: cantidad de parcelas difiere",
            fx.name
        );
        for (p, (actual, expected)) in areas_by_parcel
            .iter()
            .zip(fx.summary.areas_by_parcel.iter())
            .enumerate()
        {
            assert_eq!(
                actual.len(),
                expected.len(),
                "{}: parcela {p} tiene distinta cantidad de fragmentos (rust={} ts={})",
                fx.name,
                actual.len(),
                expected.len(),
            );
            for (k, (a, e)) in actual.iter().zip(expected.iter()).enumerate() {
                assert!(
                    approx(*a, *e, AREA_TOL_M2),
                    "{}: parcela {p} fragmento {k} difiere (rust={:.4} ts={:.4})",
                    fx.name,
                    a,
                    e,
                );
            }
        }
    }
}
