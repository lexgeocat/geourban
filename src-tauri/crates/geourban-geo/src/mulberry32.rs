//! Puerto exacto de `mulberry32` (usado en
//! src/geo/__fuzz__/degenerateGeometry.fuzz.test.ts y en
//! src/geo/subdivision/__parity__/fuzzGuardFixtures.ts), para generar de
//! forma determinista corpus de fuzz replicables en ambos lados (Fase
//! 2.6, auditoria-para-mejora.md).
//!
//! La aritmética replica bit a bit el original en JS: `Math.imul` es una
//! multiplicación de 32 bits con overflow — equivalente a
//! `u32::wrapping_mul` — y `>>>` es un shift lógico (sin signo), igual
//! que `>>` sobre `u32` en Rust.
pub struct Mulberry32 {
    a: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { a: seed }
    }

    pub fn next_f64(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6d2b79f5);
        let mut t = (self.a ^ (self.a >> 15)).wrapping_mul(1 | self.a);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_values_in_unit_range() {
        let mut rng = Mulberry32::new(0xc0ffee);
        for _ in 0..1000 {
            let v = rng.next_f64();
            assert!(v >= 0.0 && v < 1.0, "value out of range: {v}");
        }
    }

    #[test]
    fn is_deterministic_for_same_seed() {
        let mut a = Mulberry32::new(42);
        let mut b = Mulberry32::new(42);
        for _ in 0..50 {
            assert_eq!(a.next_f64(), b.next_f64());
        }
    }
}
