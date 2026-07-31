pub mod error;
pub mod types;

pub mod geojson;
pub mod math;
pub mod sanitize;
pub mod roundabout;
pub mod roads;
pub mod subdivision;
pub mod subdivision_cabecera_cuerpo;
pub mod boolean_ops;

pub use error::{GeoError, GeoResult};
pub use types::*;

pub fn crate_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod scaffolding_tests {
    use super::*;

    #[test]
    fn crate_compila_y_expone_version() {
        assert!(!crate_version().is_empty());
    }
}