//! Fuzz/robustez para el motor de subdivisión (Fase 2.6,
//! auditoria-para-mejora.md). Replica, con el mismo generador
//! `mulberry32(seed)` que usa el corpus TS
//! (src/geo/__fuzz__/degenerateGeometry.fuzz.test.ts), los dos tipos de
//! caso degenerado que confirmaron cuelgues/no-finitos en el motor JS:
//! polígonos con coordenadas escaladas ×1e5–1e8 ("huge") y polígonos
//! con un vértice NaN/Infinity ("nonfinite").
//!
//! Objetivo de este test — deliberadamente más modesto que paridad
//! numérica exacta: para geometría verdaderamente patológica (fuera de
//! cualquier rango de uso real), ambos motores aplican sus propias
//! guardas de seguridad best-effort (presupuesto de operaciones, ver
//! subdivision_cabecera_cuerpo.rs — el mismo mecanismo del lado TS),
//! que pueden truncar el resultado en puntos ligeramente distintos sin
//! que eso sea un bug: exigir coincidencia numérica exacta ahí sería
//! una promesa falsa. Lo que SÍ es una garantía real y se verifica acá:
//!   1. Nunca cuelga (cada caso corre en un thread con timeout duro,
//!      igual que workerTimeoutHarness.ts del lado TS).
//!   2. Nunca produce puntos ni áreas/medidas no-finitas.
//!   3. subdivide_manzano() rechaza (Vec vacío) cualquier anillo con
//!      vértices no-finitos, en los 3 métodos — misma política que
//!      subdivisionAlgorithms.ts::subdivideManzano.
//! La paridad numérica exacta contra el motor TS sigue garantizada (y
//! testeada) para el corpus SANO en parity_cabecera_cuerpo.rs /
//! parity_exact_modo2.rs, que este cambio no toca.
//!
//! Nota de fidelidad: el generador de acá usa el mismo mulberry32(seed)
//! y las mismas familias de formas/degradaciones que el corpus TS, pero
//! no replica el orden exacto de cada llamada a next_f64() — no hay
//! garantía de que, para el mismo seed, genere el MISMO polígono
//! byte-a-byte que el lado TS. Lo que sí comparte con el corpus TS es
//! el rango de escalas y tipos de degeneración que confirmaron los
//! problemas originales, que es lo que este test necesita cubrir.

use geourban_geo::mulberry32::Mulberry32;
use geourban_geo::subdivision::subdivide_manzano;
use geourban_geo::subdivision_cabecera_cuerpo::subdivide_manzano_cabecera_cuerpo;
use geourban_geo::types::ManzanoLoteMethod;
use std::sync::mpsc;
use std::time::Duration;

type Pt = (f64, f64);

const FUZZ_SEED: u32 = 0xc0ffee;
const HANG_TIMEOUT: Duration = Duration::from_secs(5);

struct Rng(Mulberry32);

impl Rng {
    fn new(seed: u32) -> Self {
        Self(Mulberry32::new(seed))
    }
    fn frand(&mut self, min: f64, max: f64) -> f64 {
        min + self.0.next_f64() * (max - min)
    }
    fn irand(&mut self, min: i64, max: i64) -> i64 {
        self.frand(min as f64, (max + 1) as f64).floor() as i64
    }
}

fn base_convex_polygon(rng: &mut Rng, n: usize, cx: f64, cy: f64, r: f64) -> Vec<Pt> {
    let mut angles: Vec<f64> = (0..n)
        .map(|_| rng.frand(0.0, std::f64::consts::PI * 2.0))
        .collect();
    angles.sort_by(|a, b| a.partial_cmp(b).unwrap());
    angles
        .into_iter()
        .map(|a| {
            let rr = r * rng.frand(0.6, 1.0);
            (cx + a.cos() * rr, cy + a.sin() * rr)
        })
        .collect()
}

fn star_polygon(cx: f64, cy: f64, n: usize, r_outer: f64, r_inner: f64) -> Vec<Pt> {
    (0..n * 2)
        .map(|i| {
            let a = (i as f64) * std::f64::consts::PI / n as f64;
            let r = if i % 2 == 0 { r_outer } else { r_inner };
            (cx + a.cos() * r, cy + a.sin() * r)
        })
        .collect()
}

fn sliver_polygon(rng: &mut Rng, cx: f64, cy: f64, length: f64) -> Vec<Pt> {
    let eps = rng.frand(1e-4, 1e-2);
    vec![
        (cx, cy),
        (cx + length, cy),
        (cx + length, cy + eps),
        (cx, cy + eps),
    ]
}

fn bowtie_polygon(cx: f64, cy: f64, r: f64) -> Vec<Pt> {
    vec![
        (cx - r, cy - r),
        (cx + r, cy + r),
        (cx + r, cy - r),
        (cx - r, cy + r),
    ]
}

fn random_base_shape(rng: &mut Rng) -> (i64, Vec<Pt>) {
    let cx = rng.frand(-500.0, 500.0);
    let cy = rng.frand(-500.0, 500.0);
    let shape_kind = rng.irand(0, 3);
    let base = match shape_kind {
        0 => {
            let n = rng.irand(3, 9) as usize;
            let r = rng.frand(5.0, 200.0);
            base_convex_polygon(rng, n, cx, cy, r)
        }
        1 => {
            let n = rng.irand(3, 7) as usize;
            let r_out = rng.frand(20.0, 200.0);
            let r_in = rng.frand(2.0, 15.0);
            star_polygon(cx, cy, n, r_out, r_in)
        }
        2 => {
            let len = rng.frand(5.0, 300.0);
            sliver_polygon(rng, cx, cy, len)
        }
        _ => {
            let r = rng.frand(10.0, 100.0);
            bowtie_polygon(cx, cy, r)
        }
    };
    (shape_kind, base)
}

fn with_huge_coordinates(rng: &mut Rng, ring: &[Pt]) -> Vec<Pt> {
    let scale = rng.frand(1e5, 1e8);
    ring.iter().map(|&(x, y)| (x * scale, y * scale)).collect()
}

fn with_non_finite_vertex(rng: &mut Rng, ring: &[Pt]) -> Vec<Pt> {
    let mut out = ring.to_vec();
    if out.is_empty() {
        return out;
    }
    let idx = rng.irand(0, out.len() as i64 - 1) as usize;
    let bad_choices = [f64::NAN, f64::INFINITY, f64::NEG_INFINITY];
    let bad = bad_choices[rng.irand(0, 2) as usize];
    if rng.0.next_f64() < 0.5 {
        out[idx].0 = bad;
    } else {
        out[idx].1 = bad;
    }
    out
}

fn has_non_finite(pts: &[Pt]) -> bool {
    pts.iter().any(|p| !p.0.is_finite() || !p.1.is_finite())
}

/// Corre `f` en un thread aparte con timeout duro — mismo criterio que
/// workerTimeoutHarness.ts del lado TS: un hilo colgado se detecta
/// desde afuera (el test falla con diagnóstico) en vez de bloquear la
/// suite entera. Rust no tiene una API segura para abortar un thread
/// desde afuera (igual que Node no puede cancelar código síncrono
/// colgado desde el mismo hilo); el proceso de test queda con un hilo
/// huérfano si esto dispara — aceptable para un test que está probando
/// justamente que eso no pase.
fn run_with_timeout<T: Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
    timeout: Duration,
) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx.recv_timeout(timeout).ok()
}

#[test]
fn huge_scale_never_hangs_and_never_produces_non_finite() {
    let mut rng = Rng::new(FUZZ_SEED);

    for i in 0..40 {
        let (shape_kind, base) = random_base_shape(&mut rng);
        let ring = with_huge_coordinates(&mut rng, &base);
        let name = format!("case#{i}_shape{shape_kind}_huge");

        let target_area_m2 = 200.0;
        let front_min_m = 10.0;

        let ring_for_thread = ring.clone();
        let result = run_with_timeout(
            move || subdivide_manzano_cabecera_cuerpo(&ring_for_thread, target_area_m2, front_min_m, None),
            HANG_TIMEOUT,
        );
        let lots = match result {
            Some(l) => l,
            None => panic!(
                "{name}: subdivide_manzano_cabecera_cuerpo colgó (>{HANG_TIMEOUT:?}). ring={ring:?}"
            ),
        };

        assert!(
            lots.len() < 2000,
            "{name}: cantidad de lotes sospechosamente alta: {}",
            lots.len()
        );
        for lot in &lots {
            assert!(!has_non_finite(&lot.pts), "{name}: lote con punto no-finito");
            assert!(
                lot.area_m2.is_finite() && lot.area_m2 > 0.0,
                "{name}: areaM2 no-finita o <=0 ({})",
                lot.area_m2
            );
            assert!(
                lot.front_m.is_finite() && lot.front_m >= 0.0,
                "{name}: frontM no-finito o <0"
            );
            assert!(
                lot.depth_m.is_finite() && lot.depth_m >= 0.0,
                "{name}: depthM no-finito o <0"
            );
        }

        // También vía el dispatcher subdivide_manzano('auto') — el
        // camino real que usa producción.
        let ring_for_thread2 = ring.clone();
        let result2 = run_with_timeout(
            move || {
                subdivide_manzano(
                    &ring_for_thread2,
                    ManzanoLoteMethod::Auto,
                    target_area_m2,
                    front_min_m,
                    None,
                )
            },
            HANG_TIMEOUT,
        );
        let lots2 = match result2 {
            Some(l) => l,
            None => panic!("{name}: subdivide_manzano('auto') colgó (>{HANG_TIMEOUT:?})"),
        };
        for lot in &lots2 {
            assert!(!has_non_finite(&lot.pts), "{name} (dispatcher): punto no-finito");
            assert!(
                lot.area_m2.is_finite() && lot.area_m2 > 0.0,
                "{name} (dispatcher): areaM2 no-finita o <=0"
            );
        }
    }
}

#[test]
fn non_finite_input_is_rejected_for_every_method() {
    let mut rng = Rng::new(FUZZ_SEED.wrapping_add(1));
    let methods = [
        ManzanoLoteMethod::Auto,
        ManzanoLoteMethod::Exact,
        ManzanoLoteMethod::Modo2,
    ];

    for i in 0..30 {
        let (_shape_kind, base) = random_base_shape(&mut rng);
        let ring = with_non_finite_vertex(&mut rng, &base);
        assert!(
            has_non_finite(&ring),
            "case#{i}: la fixture debería tener al menos un vértice no-finito"
        );

        for &method in &methods {
            let lots = subdivide_manzano(&ring, method, 200.0, 10.0, None);
            assert!(
                lots.is_empty(),
                "case#{i} método {method:?}: se esperaba rechazo (Vec vacío) ante entrada no-finita, se obtuvieron {} lotes",
                lots.len(),
            );
        }
    }
}