//! geourban-geo — motor de geometria nativo para GeoUrban.
//!
//! Este crate es el destino de la migracion descripta en la Fase 2 de
//! `auditoria-para-mejora.md`. Esta version (2.0) solo aporta:
//!
//!   - Los tipos compartidos que van a viajar por el limite Tauri<->React
//!     (mismo "shape" que `src/geo/math/polygonEngine.ts` y afines —
//!     decision de Fase 2.0: serializar via serde + JSON, ver `types.rs`).
//!   - El esqueleto de modulos que las Fases 2.1-2.4 van a ir llenando,
//!     cada uno con la lista exacta de funciones .ts a portar en su doc
//!     comment.
//!   - La decision de libreria booleana (GEOS via el crate `geos`, detras
//!     de la feature `geos-backend`) y una prueba de humo de que el link
//!     funciona (ver `boolean_ops.rs`).
//!
//! Ningun modulo de aca abajo esta conectado todavia a comandos de Tauri
//! con logica real — eso es Fase 2.5. Nada de esto reemplaza al worker JS
//! (`src/workers/geoOperations.ts`) hasta que cada fase correspondiente
//! este validada contra su criterio de exito (ver el .md).

pub mod error;
pub mod types;

pub mod math; // Fase 2.1 — src/geo/math/polygonEngine.ts
pub mod sanitize; // Fase 2.1 — src/geo/sanitizeRing.ts / sanitizeGeoJson.ts
pub mod roundabout; // Fase 2.1 — src/geo/roundabout/roundaboutEngine.ts
pub mod roads; // Fase 2.1 (offset/fillet) + 2.3 (union) + 2.4 (reconciliacion)
pub mod subdivision; // Fase 2.2 — src/geo/subdivision/*.ts
pub mod boolean_ops; // Fase 2.3/2.4 — capa sobre GEOS (union/difference/intersection)

pub use error::{GeoError, GeoResult};
pub use types::*;

/// Prueba de vida minima del crate. La usa el harness de `cargo test` y,
/// del lado Tauri, el comando de diagnostico `geo_engine_version`
/// (ver `src-tauri/src/geo_bridge.rs`) para verificar en runtime, desde la
/// UI, que el binario nativo tiene el motor de geometria linkeado.
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
