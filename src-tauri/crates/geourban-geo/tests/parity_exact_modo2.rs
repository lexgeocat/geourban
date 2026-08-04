use geourban_geo::subdivision::{subdivide_manzano_auto, subdivide_manzano_exact};
use serde::Deserialize;
use std::path::PathBuf;

const AREA_TOL_M2: f64 = 1e-3;
const LEN_TOL_M: f64 = 1e-3;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotFixture {
    name: String,
    method: String,
    target_area_m2: f64,
    front_min_m: f64,
    #[serde(default)]
    dir_pref: Option<DirPref>,
    summary: SnapshotSummary,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirPref {
    ax: f64,
    ay: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotSummary {
    count: usize,
    total_area: f64,
    bbox_area: f64,
    remnant_count: usize,
    areas: Vec<f64>,
    front_ms: Vec<f64>,
    depth_ms: Vec<f64>,
    #[serde(default)]
    #[allow(dead_code)]
    ring_area: f64,
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
    p.push("paritySnapshotExactModo2.json");
    p
}

fn approx(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol
}

fn parse_ring(name: &str) -> Vec<(f64, f64)> {
    if name.ends_with("rectangulo_100x60_target_600") {
        vec![(0.0, 0.0), (100.0, 0.0), (100.0, 60.0), (0.0, 60.0)]
    } else if name.ends_with("rectangulo_angosto_200x40_target_400") {
        vec![(0.0, 0.0), (200.0, 0.0), (200.0, 40.0), (0.0, 40.0)]
    } else if name.ends_with("trapecio_80x80_dir_x") {
        vec![(0.0, 0.0), (80.0, 0.0), (80.0, 80.0), (20.0, 80.0)]
    } else if name.ends_with("cuadrado_40x40_target_200") {
        vec![(0.0, 0.0), (40.0, 0.0), (40.0, 40.0), (0.0, 40.0)]
    } else if name.ends_with("forma_L_dir_y") {
        vec![
            (0.0, 0.0),
            (50.0, 0.0),
            (50.0, 30.0),
            (30.0, 30.0),
            (30.0, 50.0),
            (0.0, 50.0),
        ]
    } else {
        panic!(
            "Fixture desconocida en snapshot: {name}. Actualiza `parse_ring` en \
             tests/parity_exact_modo2.rs para mantener sincronizado el snapshot de tests/fixtures/."
        )
    }
}

#[test]
fn parity_con_snapshot_ts() {
    let path = snapshot_path();
    assert!(
        path.exists(),
        "Snapshot ausente en {}.\n\
         Los fixtures de paridad están CONGELADOS desde Fase 2.7 — no hay\n\
         script de sync (`npm run parity:sync` no existe). El snapshot se\n\
         edita a mano en este mismo crate bajo tests/fixtures/. Si lo\n\
         borraste por accidente, restaurá la versión commiteada del repo.",
        path.display()
    );
    let raw = std::fs::read_to_string(&path).expect("leer snapshot");
    let snap: Snapshot = serde_json::from_str(&raw).expect("parsear snapshot");
    assert!(!snap.fixtures.is_empty(), "snapshot sin fixtures");

    for fx in &snap.fixtures {
        let dir_pref = fx.dir_pref.as_ref().map(|d| (d.ax, d.ay));
        let ring = parse_ring(&fx.name);

        let lots = match fx.method.as_str() {
            "exact" => subdivide_manzano_exact(&ring, fx.target_area_m2, fx.front_min_m, dir_pref),
            "modo2" => subdivide_manzano_auto(&ring, fx.target_area_m2, fx.front_min_m, dir_pref),
            other => panic!("{}: metodo desconocido en snapshot: {other}", fx.name),
        };

        assert_eq!(
            lots.len(),
            fx.summary.count,
            "{}: count difiere (rust={} ts={})",
            fx.name,
            lots.len(),
            fx.summary.count
        );

        let rem = lots.iter().filter(|l| l.is_remnant).count();
        assert_eq!(
            rem, fx.summary.remnant_count,
            "{}: remnant_count difiere",
            fx.name
        );

        let total_area: f64 = lots.iter().map(|l| l.area_m2).sum();
        assert!(
            approx(total_area, fx.summary.total_area, AREA_TOL_M2),
            "{}: totalArea difiere (rust={:.6} ts={:.6})",
            fx.name,
            total_area,
            fx.summary.total_area
        );

        let (mut min_x, mut min_y, mut max_x, mut max_y) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for l in &lots {
            for p in &l.pts {
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
        }
        let bbox_area = if min_x.is_finite() {
            (max_x - min_x) * (max_y - min_y)
        } else {
            0.0
        };
        assert!(
            approx(bbox_area, fx.summary.bbox_area, AREA_TOL_M2),
            "{}: bboxArea difiere",
            fx.name
        );

        assert_eq!(lots.len(), fx.summary.areas.len(), "{}: areas.len", fx.name);
        for (i, l) in lots.iter().enumerate() {
            assert!(
                approx(l.area_m2, fx.summary.areas[i], AREA_TOL_M2),
                "{}: areas[{}] difiere (rust={} ts={})",
                fx.name,
                i,
                l.area_m2,
                fx.summary.areas[i]
            );
            assert!(
                approx(l.front_m, fx.summary.front_ms[i], LEN_TOL_M),
                "{}: fronts[{}] difiere",
                fx.name,
                i
            );
            assert!(
                approx(l.depth_m, fx.summary.depth_ms[i], LEN_TOL_M),
                "{}: depths[{}] difiere",
                fx.name,
                i
            );
        }
        for l in &lots {
            assert!(l.area_m2 > 0.0, "{}: lote con area <= 0", fx.name);
        }
    }
}
