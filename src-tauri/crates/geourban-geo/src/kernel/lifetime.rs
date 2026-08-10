//! Helpers de extensión de lifetime para tipos GEOS.
//!
//! El binding `geos` para Rust anota cada `Geometry` y `ContextHandle` con un
//! parámetro de lifetime ligado al `ContextHandle` del que se originaron. En la
//! práctica ese contexto se mantiene vivo de forma global (vía
//! [`crate::kernel::boolean_ops::ensure_geos_ctx`]) y nunca se destruye durante
//! la vida del proceso, por lo que podemos extender el lifetime a `'static`
//! sin riesgo.
//!
//! SAFETY: el invocador debe garantizar que el `ContextHandle` original sigue
//! vivo. En GeoUrban eso se cumple siempre: `ensure_geos_ctx` lo inicializa
//! en un `thread_local` y nunca lo libera.

use geos::{ContextHandle, Geometry};

/// Extiende el lifetime de un `Geometry` de GEOS a `'static`.
///
/// Internamente es un `std::mem::transmute` con la misma invariante: el
/// `ContextHandle` subyacente debe seguir vivo. En GeoUrban esto se cumple
/// porque el contexto se inicializa una vez por thread y nunca se libera.
#[inline]
pub fn extend_geometry_lifetime(g: Geometry<'_>) -> Geometry<'static> {
    unsafe { std::mem::transmute::<Geometry<'_>, Geometry<'static>>(g) }
}

/// Variante específica para `ContextHandle` (misma semántica, otro tipo).
#[inline]
pub fn extend_context_lifetime(c: ContextHandle<'_>) -> ContextHandle<'static> {
    unsafe { std::mem::transmute::<ContextHandle<'_>, ContextHandle<'static>>(c) }
}
