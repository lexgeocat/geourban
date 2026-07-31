//! Fase 2.1 (offset/fillet, aritmetica pura) + Fase 2.3 (union, via GEOS)
//! + Fase 2.4 (reconciliacion de fragmentos, via GEOS).
//!
//! Puerto de:
//!   - src/geo/roads/roadNetworkEngine.ts       (offsetPolylineMiter, buildRing —
//!     Fase 2.1, no depende de GEOS)
//!   - src/geo/roads/ringFillet.ts               (roundRingReflex, fillet/chamfer —
//!     Fase 2.1, no depende de GEOS)
//!   - src/geo/roads/roadNetworkNet.ts           (unionRings — Fase 2.3,
//!     depende de `crate::boolean_ops`; portar tambien la logica de
//!     reintento/auto-limpieza que hoy tiene la version JS, no es cosmetica)
//!   - src/geo/roads/fragmentReconciliation.ts   (matchFragmentsToMembers —
//!     Fase 2.4, depende de `crate::boolean_ops::intersection`)
//!
//! Los dos primeros archivos pueden portarse en 2.1 junto con `math.rs`;
//! los dos ultimos quedan bloqueados hasta que `crate::boolean_ops` este
//! resuelto en 2.3.
