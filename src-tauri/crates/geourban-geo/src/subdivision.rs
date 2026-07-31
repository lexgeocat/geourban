//! Fase 2.2 — puerto de `src/geo/subdivision/subdivisionAlgorithms.ts` y
//! `src/geo/subdivision/subdivisionCabeceraCuerpo.ts`.
//!
//! No depende de `crate::boolean_ops` — todos los clips los resuelve por
//! semiplano (igual que `crate::math`), por eso es candidato a portarse
//! antes que la capa booleana (ver orden de sub-fases en
//! auditoria-para-mejora.md, §Fase 2).
//!
//! Pendiente:
//!   - subdivide_manzano_auto              <- subdivideManzanoAuto (PCA / modo2)
//!   - subdivide_manzano_exact             <- subdivideManzanoExact
//!   - slice_bisect_manzano                <- sliceBisectManzano (manual-slice)
//!   - subdivide_manzano_cabecera_cuerpo   <- subdivideManzanoCabeceraCuerpo (metodo `auto`,
//!     el que usa el default de la app)
//!   - subdivide_manzano                   <- subdivideManzano (dispatcher por ManzanoLoteMethod)
//!   - subdivide                           <- subdivide (dispatcher por SubdivisionMethod,
//!     incluye manual-slice con cutLine/frenteSeg+auxSeg)
//!
//! Depende de `crate::math` y de `crate::sanitize` (los resultados pasan
//! por saneo antes de devolverse, igual que `sanitizeLotResults` en TS).
