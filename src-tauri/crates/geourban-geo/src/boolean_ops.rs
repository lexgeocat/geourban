#[cfg(feature = "geos-backend")]
mod geos_smoke {
    use geos::{Geom, Geometry};

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
