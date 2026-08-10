//! Constantes numéricas compartidas por todo el crate `geourban-geo`.
//!
//! Antes había epsilons (`1e-9`, `1e-12`, `1e-6`) repetidos como literales
//! en varios archivos sin nombre. Esto los centraliza con un nombre
//! auto-documentado para que el call-site indique **explícitamente** qué
//! tolerancia está usando.
//!
//! Cuando el equipo necesite un nuevo epsilon (por ejemplo, en un nuevo
//! módulo), debe **agregarlo acá** con un nombre que exprese su propósito
//! de dominio, en vez de crear un literal mágico nuevo.

// --- Tolerancias geométricas ----------------------------------------------

/// Epsilon "normal" para operaciones booleanas de OpenLayers/GEOS sobre
/// geometría ya saneada. Equivale a ~0.000000001 m en coords proyectadas
/// (UTM). Usado por `boolean_ops` y `roads` para cerrar anillos.
pub const EPSILON_NORMAL: f64 = 1e-9;

/// Epsilon estricto para sanitización de geometría de entrada (antes de
/// pasar a GEOS). Tres órdenes de magnitud más estricto que
/// `EPSILON_NORMAL` porque sanitizar geometría corrupta requiere tolerar
/// drift acumulado de imports/exportes sucesivos.
pub const EPSILON_SANITIZE: f64 = 1e-12;

// --- Reglas de dominio -----------------------------------------------------

/// Radio máximo permitido para un ochave/chaflán en una esquina de manzano
/// o vial, en metros. Regla de negocio: por encima de este valor, el
/// suavizado deja de ser "esquina suavizada" y pasa a ser "callejón
/// semicircular", que conceptualmente ya no es lo mismo. Ver
/// `vias-engine/geometry/streetEngine.ts` (TS) para el lado espejo en el
/// frontend.
pub const FILLET_MAX_RADIUS_M: f64 = 8.0;
