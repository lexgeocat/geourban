pub mod error;
pub mod types;

pub mod boolean_ops;
pub mod fragment_reconciliation;
pub mod geojson;
pub mod math;
pub mod mulberry32;
pub mod roads;
pub mod roundabout;
pub mod sanitize;
pub mod spatial;
pub mod subdivision;
pub mod subdivision_cabecera_cuerpo;

pub use error::{GeoError, GeoResult};
pub use types::*;

pub fn crate_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
