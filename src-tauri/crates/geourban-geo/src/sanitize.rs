//! Fase 2.1 — puerto de `src/geo/sanitizeRing.ts` y `src/geo/sanitizeGeoJson.ts`.
//!
//! Pendiente:
//!   - sanitize_ring   <- sanitizeRing   (dedupe de vertices + colinealidad + area minima)
//!   - sanitize_rings  <- sanitizeRings  (batch — descarta invalidos en silencio, con telemetria)
//!
//! Importante portar esto ANTES que `subdivision`/`roads`: ambos dependen
//! hoy de recibir anillos ya saneados (mismo orden de dependencias que en
//! JS). La telemetria que hoy emite `recordGeometrySanitizeEvent` en
//! `src/store/debug/geometryTelemetry.ts` mapea 1:1 a
//! `crate::error::GeoError::Degenerate { context, reason }` — decidir en
//! esta fase si se loguea localmente (`log::warn!`) o se reenvia al
//! frontend via evento Tauri para alimentar el mismo `DebugPanel.tsx` que
//! ya existe.
