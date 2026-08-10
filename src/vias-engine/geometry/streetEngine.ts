// ─────────────────────────────────────────────────────────────────────────
// NOTA ARQUITECTÓNICA — PARIDAD TS↔RUST (Fase 6.2 del plan)
//
// Esta función TypeScript del radio de ochave según ángulo coexiste
// con la implementación autoritativa en Rust:
//
//   src-tauri/crates/geourban-geo/src/domains/roads/roads.rs::get_fillet_radius_for_angle
//
// NO es código duplicado por descuido — es la versión preview
// (síncrona) usada para render en tiempo real. La versión Rust es la
// autoritativa y se usa en el cómputo final.
//
// La constante `FILLET_MAX_RADIUS_M = 8` **debe coincidir** con
// `kernel::constants::FILLET_MAX_RADIUS_M` en Rust (8.0). El plan
// original advertía que no hay forma automática de sincronizar
// constantes entre Cargo y npm sin codegen — este archivo es la
// contrapartida TS de esa constante Rust, y debe actualizarse a mano
// si el valor cambia.
//
// Si cambia la tabla de radios (umbrales 35/45/95/120/150 o los
// valores 2.5/3/4/4.5/5), hay que actualizar **AMBOS** lados.
// ─────────────────────────────────────────────────────────────────────────

const FILLET_MAX_RADIUS_M = 8;

export function getFilletRadiusForAngle(angleDeg: number): number {
  if (angleDeg <= 35) return 2.5;
  if (angleDeg <= 45) return 3;
  if (angleDeg <= 95) return 4;
  if (angleDeg <= 120) return 4.5;
  if (angleDeg <= 150) return 5;
  return FILLET_MAX_RADIUS_M;
}
