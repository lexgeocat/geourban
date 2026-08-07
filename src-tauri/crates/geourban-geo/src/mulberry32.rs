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
