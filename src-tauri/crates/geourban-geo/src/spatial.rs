//! Índice espacial nativo (rstar) — Fase 4.1 (auditoria-para-mejora.md §6, Fase 4).
//!
//! Consulta de viewport del lado Rust, espejo del `SpatialIndex` JS
//! (`src/map/spatialIndex.ts`). Criterio §7.4: las cargas masivas usan
//! `RTree::bulk_load` (bulk STR), **nunca** inserción incremental — mismo
//! criterio que el `RBush.load()` del lado JS.
//!
//! El índice guarda solo `id + bbox` por feature; no guarda geometrías
//! completas: para una consulta de viewport los ids alcanzan y el caller
//! resuelve la geometría en su propia capa (evita duplicar el payload).
//!
//! `id` es `serde_json::Value` a propósito — en GeoUrban un id de feature
//! puede ser `string | number` y acá no se interpreta, solo hace ida y
//! vuelta (mismo criterio que `SubdivideManzanoBatchItem` en geo_bridge).

use rstar::{RTree, RTreeObject, AABB};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq)]
pub struct IndexedEnvelope {
    pub id: Value,
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

/// Normaliza ids numéricos: `1` (PosInt) y `1.0` (Float) son el mismo id
/// lógico pero hashean distinto en `serde_json::Value` (que distingue
/// PosInt/NegInt/Float internamente) — sin esto un id numérico podría
/// existir dos veces en el índice y quedar entradas fantasma.
fn canonicalize_id(id: Value) -> Value {
    if let Value::Number(n) = &id {
        if let Some(i) = n.as_i64() {
            return Value::from(i);
        }
        if let Some(u) = n.as_u64() {
            return Value::from(u);
        }
        // `Number::as_i64()` no cubre floats; un float entero (1.0, típico
        // si el id pasó por aritmética JS) se canónica a entero.
        if let Some(f) = n.as_f64() {
            if f.is_finite() && f.fract() == 0.0 && f >= i64::MIN as f64 && f <= i64::MAX as f64 {
                return Value::from(f as i64);
            }
        }
    }
    id
}

impl IndexedEnvelope {
    /// Ordena min/max defensivamente (idempotente, no rompe casos válidos)
    /// para que un bbox mal ordenado nunca corrompa las invariantes del R-tree.
    pub fn new(id: Value, min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Self {
        Self {
            id: canonicalize_id(id),
            min_x: min_x.min(max_x),
            min_y: min_y.min(max_y),
            max_x: min_x.max(max_x),
            max_y: min_y.max(max_y),
        }
    }
}

impl RTreeObject for IndexedEnvelope {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners([self.min_x, self.min_y], [self.max_x, self.max_y])
    }
}

pub struct SpatialIndex {
    tree: RTree<IndexedEnvelope>,
    /// id -> item, para remover/actualizar en O(1) y mantener unicidad de id.
    by_id: HashMap<Value, IndexedEnvelope>,
}

impl Default for SpatialIndex {
    fn default() -> Self {
        Self {
            tree: RTree::new(),
            by_id: HashMap::new(),
        }
    }
}

impl SpatialIndex {
    /// Carga masiva (reemplaza el índice entero). Bulk STR — nunca
    /// inserción incremental para volúmenes grandes (criterio §7.4).
    ///
    /// Dedupea por id ANTES de construir el árbol (criterio last-wins,
    /// igual que `insert`): si el caller trae un id repetido (geometría
    /// corrupta, doble carga, batch mal armado), `tree` y `by_id` quedan
    /// garantizados 1:1 — si no, el árbol podría guardar dos nodos con el
    /// mismo id: `remove` deja uno huérfano para siempre y `search` puede
    /// devolver ids duplicados.
    pub fn bulk_load(items: Vec<IndexedEnvelope>) -> Self {
        let mut by_id = HashMap::with_capacity(items.len());
        for item in items {
            by_id.insert(item.id.clone(), item);
        }
        let deduped: Vec<IndexedEnvelope> = by_id.values().cloned().collect();
        Self {
            tree: RTree::bulk_load(deduped),
            by_id,
        }
    }

    /// Inserción/actualización incremental — para ediciones en runtime,
    /// no para cargas masivas. Id duplicado reemplaza la entrada previa.
    pub fn insert(&mut self, item: IndexedEnvelope) {
        if let Some(old) = self.by_id.insert(item.id.clone(), item.clone()) {
            self.tree.remove(&old);
        }
        self.tree.insert(item);
    }

    /// Remueve por id. Devuelve `true` si existía.
    ///
    /// Canonicaliza `id` antes de buscar: sin esto, remover con un id
    /// numérico no-canónico (p.ej. `1.0` cuando se insertó como `1`)
    /// fallaba en silencio (`by_id.remove` no encontraba la clave) y
    /// dejaba una entrada fantasma en el árbol — inalcanzable por
    /// `remove`, pero que `search()` seguía devolviendo.
    pub fn remove(&mut self, id: &Value) -> bool {
        let canonical = canonicalize_id(id.clone());
        match self.by_id.remove(&canonical) {
            Some(old) => {
                self.tree.remove(&old);
                true
            }
            None => false,
        }
    }

    /// Busca los ids cuyo bbox intersecta el rectángulo de consulta.
    /// Los resultados se apilan en `out` (que se preserva, no se limpia).
    pub fn search(&self, min_x: f64, min_y: f64, max_x: f64, max_y: f64, out: &mut Vec<Value>) {
        let query = AABB::from_corners([min_x, min_y], [max_x, max_y]);
        for item in self.tree.locate_in_envelope_intersecting(&query) {
            out.push(item.id.clone());
        }
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }

    pub fn clear(&mut self) {
        self.tree = RTree::new();
        self.by_id.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Grilla de celdas de 10x10 m desde el origen, ids `f-{row}-{col}`.
    fn grid_items(rows: usize, cols: usize) -> Vec<IndexedEnvelope> {
        let mut items = Vec::with_capacity(rows * cols);
        for r in 0..rows {
            for c in 0..cols {
                let x0 = c as f64 * 10.0;
                let y0 = r as f64 * 10.0;
                items.push(IndexedEnvelope::new(
                    Value::String(format!("f-{r}-{c}")),
                    x0,
                    y0,
                    x0 + 10.0,
                    y0 + 10.0,
                ));
            }
        }
        items
    }

    fn sorted_ids(mut ids: Vec<Value>) -> Vec<String> {
        let mut s: Vec<String> = ids.drain(..).map(|v| v.to_string()).collect();
        s.sort();
        s
    }

    fn brute_force(queries: &[(f64, f64, f64, f64)], items: &[IndexedEnvelope]) -> Vec<Vec<Value>> {
        queries
            .iter()
            .map(|(min_x, min_y, max_x, max_y)| {
                items
                    .iter()
                    .filter(|it| {
                        it.min_x <= *max_x
                            && it.max_x >= *min_x
                            && it.min_y <= *max_y
                            && it.max_y >= *min_y
                    })
                    .map(|it| it.id.clone())
                    .collect()
            })
            .collect()
    }

    #[test]
    fn bulk_load_search_bbox_intersecting() {
        let index = SpatialIndex::bulk_load(grid_items(10, 10));
        assert_eq!(index.len(), 100);

        // Rectángulo que cubre las celdas f-3..f-6 en x y f-2..f-4 en y,
        // con bordes desplazados para forzar intersección parcial:
        // x ∈ {2..6} (5 celdas), y ∈ {1..4} (4 celdas) → 20.
        let mut out = Vec::new();
        index.search(25.0, 15.0, 66.0, 46.0, &mut out);
        assert_eq!(out.len(), 20, "celdas 5x4 intersectando");
        let ids = sorted_ids(out);
        assert!(ids.contains(&"\"f-2-2\"".to_string()));
        assert!(ids.contains(&"\"f-4-6\"".to_string()));
        assert!(!ids.contains(&"\"f-1-1\"".to_string()));
    }

    #[test]
    fn search_matches_brute_force() {
        let items = grid_items(25, 25);
        let index = SpatialIndex::bulk_load(items.clone());
        let queries = [
            (5.0, 5.0, 95.0, 95.0),       // casi toda la grilla
            (30.0, 30.0, 49.9, 49.9),     // interior chico (bordes excluidos)
            (0.0, 0.0, 249.0, 249.0),     // todo
            (100.0, 100.0, 101.0, 101.0), // entre celdas — sin hits
            (0.0, 0.0, 0.5, 0.5),         // esquina mínima
            (99.0, 99.0, 200.0, 120.0),   // banda vertical
        ];
        let expected = brute_force(&queries, &items);
        for (i, (q, exp)) in queries.iter().zip(expected.iter()).enumerate() {
            let mut out = Vec::new();
            index.search(q.0, q.1, q.2, q.3, &mut out);
            assert_eq!(
                sorted_ids(out),
                sorted_ids(exp.clone()),
                "paridad con fuerza bruta en query #{i}"
            );
        }
    }

    #[test]
    fn insert_remove_roundtrip() {
        let mut index = SpatialIndex::default();
        assert!(index.is_empty());

        index.insert(IndexedEnvelope::new(Value::from("a"), 0.0, 0.0, 10.0, 10.0));
        index.insert(IndexedEnvelope::new(
            Value::from("b"),
            20.0,
            20.0,
            30.0,
            30.0,
        ));
        assert_eq!(index.len(), 2);

        let mut out = Vec::new();
        index.search(0.0, 0.0, 100.0, 100.0, &mut out);
        assert_eq!(out.len(), 2);

        assert!(index.remove(&Value::from("a")));
        assert!(
            !index.remove(&Value::from("a")),
            "segunda remoción no existe"
        );
        assert_eq!(index.len(), 1);

        let mut out = Vec::new();
        index.search(0.0, 0.0, 100.0, 100.0, &mut out);
        assert_eq!(out, vec![Value::from("b")]);
    }

    #[test]
    fn insert_replaces_same_id() {
        let mut index = SpatialIndex::default();
        index.insert(IndexedEnvelope::new(Value::from("a"), 0.0, 0.0, 10.0, 10.0));
        index.insert(IndexedEnvelope::new(
            Value::from("a"),
            100.0,
            100.0,
            110.0,
            110.0,
        ));
        assert_eq!(index.len(), 1, "id duplicado reemplaza, no suma");

        // El bbox viejo no debe responder más.
        let mut out = Vec::new();
        index.search(0.0, 0.0, 10.0, 10.0, &mut out);
        assert!(out.is_empty());
        index.search(100.0, 100.0, 110.0, 110.0, &mut out);
        assert_eq!(out, vec![Value::from("a")]);
    }

    #[test]
    fn search_empty_index_no_panic() {
        let index = SpatialIndex::default();
        let mut out = Vec::new();
        index.search(-1000.0, -1000.0, 1000.0, 1000.0, &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn clear_empties_index() {
        let mut index = SpatialIndex::bulk_load(grid_items(4, 4));
        assert_eq!(index.len(), 16);
        index.clear();
        assert!(index.is_empty());
        assert_eq!(index.len(), 0);
    }
    #[test]
    fn remove_with_non_canonical_numeric_id_still_finds_entry() {
        let mut index = SpatialIndex::default();
        index.insert(IndexedEnvelope::new(Value::from(1), 0.0, 0.0, 10.0, 10.0));
        assert_eq!(index.len(), 1);

        // Antes del fix: remove(&Value::from(1.0)) devolvía false y
        // dejaba una entrada fantasma en el árbol.
        assert!(index.remove(&Value::from(1.0)));
        assert!(index.is_empty());
    }

    #[test]
    fn bulk_load_dedupes_duplicate_ids_last_wins() {
        let items = vec![
            IndexedEnvelope::new(Value::from("a"), 0.0, 0.0, 10.0, 10.0),
            IndexedEnvelope::new(Value::from("b"), 50.0, 50.0, 60.0, 60.0),
            // Duplicado de "a" con bbox desplazado: last-wins.
            IndexedEnvelope::new(Value::from("a"), 100.0, 100.0, 110.0, 110.0),
        ];
        let index = SpatialIndex::bulk_load(items);
        assert_eq!(index.len(), 2, "el árbol y by_id quedan 1:1 por id");

        // El bbox viejo no responde; el nuevo sí, sin duplicados.
        let mut out = Vec::new();
        index.search(0.0, 0.0, 20.0, 20.0, &mut out);
        assert!(out.is_empty());
        index.search(95.0, 95.0, 115.0, 115.0, &mut out);
        assert_eq!(
            out,
            vec![Value::from("a")],
            "un solo hit para el id dedupeado"
        );

        // remove() elimina sin dejar nodos fantasma (sin panics ni hits extra).
        let mut index = index;
        assert!(index.remove(&Value::from("a")));
        assert_eq!(index.len(), 1);
    }

    #[test]
    fn new_normalizes_min_max_and_numeric_ids() {
        // Bbox con min>max se ordena solo.
        let env = IndexedEnvelope::new(Value::from(1), 30.0, 20.0, 10.0, 40.0);
        assert_eq!(env.min_x, 10.0);
        assert_eq!(env.max_x, 30.0);
        assert_eq!(env.min_y, 20.0);
        assert_eq!(env.max_y, 40.0);

        // 1 (PosInt) y 1.0 (Float) se canonican al mismo id.
        let a = IndexedEnvelope::new(Value::from(1), 0.0, 0.0, 1.0, 1.0).id;
        let b = IndexedEnvelope::new(Value::from(1.0), 0.0, 0.0, 1.0, 1.0).id;
        assert_eq!(a, b, "id numérico canónico: 1 == 1.0");

        // Strings no se tocan.
        let s = IndexedEnvelope::new(Value::from("x"), 0.0, 0.0, 1.0, 1.0).id;
        assert_eq!(s, Value::from("x"));
    }

    #[test]
    fn bulk_load_100k_grid_query_cheap() {
        // Sanity de escala: 100k envelopes, load bulk y una query acotada.
        // Los tiempos se imprimen (build de debug infla el bulk-load STR);
        // la medición real de referencia corre en el benchmark de la app
        // (build release, DebugPanel → Fase 4.1/4.2).
        let items = grid_items(320, 320);
        let t0 = std::time::Instant::now();
        let index = SpatialIndex::bulk_load(items);
        assert_eq!(index.len(), 102_400);
        let load_ms = t0.elapsed().as_secs_f64() * 1000.0;

        let t0 = std::time::Instant::now();
        let mut out = Vec::new();
        index.search(1000.0, 1000.0, 1100.0, 1100.0, &mut out);
        let query_ms = t0.elapsed().as_secs_f64() * 1000.0;
        assert!(!out.is_empty());

        println!("bulk_load 100k (debug): {load_ms:.1} ms — query: {query_ms:.3} ms");
    }
}
