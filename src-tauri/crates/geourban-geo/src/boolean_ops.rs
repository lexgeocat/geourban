//! Fase 2.3/2.4 — capa de booleanas sobre GEOS.
//!
//! Va a reemplazar, en el worker JS, a:
//!   - `polygonClipping.union`        (src/geo/roads/roadNetworkNet.ts::unionRings)
//!   - JSTS `OverlayOp.difference`    (src/workers/geoOperations.ts::robustUnionRoadNetwork
//!                                      / computeManzanos)
//!   - `polygonClipping.intersection` (src/geo/roads/fragmentReconciliation.ts)
//!
//! Fase 2.0 solo deja la prueba de humo de que `geos` linkea y produce un
//! resultado geometricamente correcto en esta maquina/target. La
//! implementacion real (union/difference/intersection con la logica de
//! reintento y auto-limpieza que hoy tiene `roadNetworkNet.ts` cuando la
//! union directa falla) es responsabilidad de la Fase 2.3.
//!
//! Pendiente en 2.3/2.4:
//!   - union(rings: &[Vec<Pt>]) -> GeoResult<Vec<Vec<Vec<Pt>>>>        <- unionRings
//!   - difference(subject, clip) -> GeoResult<...>                     <- OverlayOp.difference
//!   - intersection_area(a: &[Pt], b: &[Pt]) -> GeoResult<f64>         <- ringIntersectionAreaRaw
//!   - Limites de seguridad equivalentes a MAX_UNION_POINTS / MAX_UNION_SHAPES /
//!     UNION_TIME_WARNING_MS (roadNetworkNet.ts) — no descartarlos: van a
//!     seguir haciendo falta como guardrail, solo que con umbrales mas altos.

#[cfg(feature = "geos-backend")]
mod geos_smoke {
    use geos::{Geom, Geometry};

    /// Verifica que el binding a GEOS compila, linkea, y devuelve un
    /// resultado geometricamente correcto para el caso mas simple posible:
    /// union de dos cuadrados de 10x10 que se solapan a la mitad.
    ///
    /// Area esperada: 10*10 + 10*10 - 5*10 = 150.
    ///
    /// Nota: la superficie de la API de `geos` viene cambiando entre
    /// versiones mayores (8.x / 9.x) — si esto no compila tal cual con la
    /// version que resolvio tu `cargo add`, revisa la documentacion del
    /// crate para los nombres actuales de `new_from_wkt`/`union`/`area`
    /// (la logica del test no deberia cambiar, si los nombres de metodo).
    #[cfg(test)]
    #[test]
    fn geos_union_basico() {
        let a = Geometry::new_from_wkt("POLYGON((0 0, 10 0, 10 10, 0 10, 0 0))")
            .expect("wkt valido");
        let b = Geometry::new_from_wkt("POLYGON((5 0, 15 0, 15 10, 5 10, 5 0))")
            .expect("wkt valido");

        let union = a.union(&b).expect("la union deberia resolver sin error");
        let area = union.area().expect("area deberia ser calculable");

        assert!(
            (area - 150.0).abs() < 1e-6,
            "area de union esperada 150.0, obtenida {area}"
        );
    }
}
