//! Tipo de error compartido por todos los modulos del crate.
//!
//! Fase 2.0 solo define la forma — las variantes reales se van a ir
//! ampliando a medida que cada fase porta su modulo. `Degenerate` ya esta
//! pensada para calzar 1:1 con lo que hoy reporta `recordGeometrySanitizeEvent`
//! en `src/store/debug/geometryTelemetry.ts` (mismo par contexto/razon),
//! asi la Fase 2.1 puede portar `sanitizeRing.ts` sin tener que inventar un
//! esquema de error nuevo.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum GeoError {
    #[error("anillo invalido: se requieren al menos 3 vertices, se recibieron {0}")]
    InvalidRing(usize),

    /// Espeja el par (context, reason) que hoy viaja en
    /// `recordGeometrySanitizeEvent(context, detail)`.
    #[error("geometria degenerada tras el saneo ({context}): {reason}")]
    Degenerate { context: String, reason: String },

    #[error("operacion booleana fallo: {0}")]
    BooleanOpFailed(String),

    #[error("metodo de subdivision desconocido: {0}")]
    UnknownMethod(String),

    #[error("parametros invalidos: {0}")]
    InvalidParams(String),
}

pub type GeoResult<T> = Result<T, GeoError>;
