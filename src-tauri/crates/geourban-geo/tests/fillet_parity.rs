//! Test de paridad: la tabla `get_fillet_radius_for_angle` debe devolver el
//! mismo valor que la contraparte TypeScript en `streetEngine.ts` (el frontend
//! solo llama con `road_half_width_m = None`, que es el caso que pariteamos).
//!
//! Si alguien modifica la tabla en uno de los dos lados y se olvida del otro,
//! este test falla con un mensaje explícito.

use geourban_geo::roads::get_fillet_radius_for_angle;

const FILLET_MAX_RADIUS_M: f64 = 8.0;

/// Tabla espejo de `getFilletRadiusForAngle` en
/// `src/vias-engine/geometry/streetEngine.ts`.
fn ts_expected(angle_deg: f64) -> f64 {
    let v = if angle_deg <= 35.0 {
        2.5
    } else if angle_deg <= 45.0 {
        3.0
    } else if angle_deg <= 95.0 {
        4.0
    } else if angle_deg <= 120.0 {
        4.5
    } else if angle_deg <= 150.0 {
        5.0
    } else {
        FILLET_MAX_RADIUS_M
    };
    v.min(FILLET_MAX_RADIUS_M)
}

#[test]
fn fillet_radius_table_matches_ts_for_none_half_width() {
    let cases = [
        0.0, 10.0, 35.0, 35.0001, 36.0, 44.0, 45.0, 45.0001, 46.0, 90.0, 95.0, 95.0001,
        96.0, 119.0, 120.0, 120.0001, 121.0, 149.0, 150.0, 150.0001, 151.0, 180.0, 270.0,
        359.999,
    ];
    for &angle in &cases {
        let rust_value = get_fillet_radius_for_angle(angle, None);
        let ts_value = ts_expected(angle);
        assert!(
            (rust_value - ts_value).abs() < 1e-9,
            "Parity break at angle={angle}: rust={rust_value}, ts={ts_value}",
        );
    }
}
