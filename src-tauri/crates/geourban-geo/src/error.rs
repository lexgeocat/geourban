use thiserror::Error;

#[derive(Debug, Error)]
pub enum GeoError {
    #[error("anillo invalido: se requieren al menos 3 vertices, se recibieron {0}")]
    InvalidRing(usize),

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
