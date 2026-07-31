//! Fase 2.1 — puerto de `src/geo/math/polygonEngine.ts`.
//!
//! Pendiente (mismo orden que el archivo TS original), todo aritmetica
//! pura, sin GEOS ni ninguna otra dependencia externa:
//!
//!   - poly_area               <- polyArea               (formula de Shoelace)
//!   - centroid                <- centroid
//!   - convex_hull             <- convexHull
//!   - ring_perimeter          <- ringPerimeter
//!   - path_length             <- pathLength
//!   - clip_half_plane         <- clipHalfPlane
//!   - clip_to_strip           <- clipToStrip
//!   - principal_axis          <- principalAxis           (PCA)
//!   - project_extents         <- projectExtents
//!   - point_in_poly           <- pointInPoly              (ray casting)
//!   - segment_intersects_poly <- segmentIntersectsPoly
//!   - build_cut_polys         <- buildCutPolys
//!
//! Todas reciben/devuelven `crate::types::Pt` para que el resto del crate
//! (subdivision, roads, roundabout) las consuma sin conversiones. Ninguna
//! de estas funciones necesita `crate::boolean_ops` — por eso este modulo
//! va primero en la Fase 2.1, antes de tocar GEOS.
