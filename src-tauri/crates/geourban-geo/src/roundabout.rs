//! Fase 2.1 — puerto de `src/geo/roundabout/roundaboutEngine.ts`.
//!
//! Pendiente:
//!   - ngon_ring                 <- ngonRing
//!   - circle_ring               <- circleRing
//!   - roundabout_geometry       <- roundaboutGeometry
//!   - roundabout_road_area_m2   <- roundaboutRoadAreaM2
//!   - validate_roundabout_params <- validateRoundaboutParams
//!
//! Depende de `crate::math` (aritmetica de anillos) y de
//! `resolutionAwareSegments`, que hoy vive en `src/geo/math/lod.ts` — traer
//! esa funcion tambien al alcance de esta fase (podria vivir en
//! `crate::math` junto al resto, ya que tampoco toca GEOS).
