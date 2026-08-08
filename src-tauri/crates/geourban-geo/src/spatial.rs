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

fn canonicalize_id(id: Value) -> Value {
    if let Value::Number(n) = &id {
        if let Some(i) = n.as_i64() {
            return Value::from(i);
        }
        if let Some(u) = n.as_u64() {
            return Value::from(u);
        }
        if let Some(f) = n.as_f64() {
            if f.is_finite() && f.fract() == 0.0 && f >= i64::MIN as f64 && f <= i64::MAX as f64 {
                return Value::from(f as i64);
            }
        }
    }
    id
}

impl IndexedEnvelope {
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

    pub fn insert(&mut self, item: IndexedEnvelope) {
        if let Some(old) = self.by_id.insert(item.id.clone(), item.clone()) {
            self.tree.remove(&old);
        }
        self.tree.insert(item);
    }

    pub fn insert_many(&mut self, items: Vec<IndexedEnvelope>) {
        for item in items {
            self.insert(item);
        }
    }

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

    pub fn remove_many(&mut self, ids: &[Value]) -> usize {
        ids.iter().filter(|id| self.remove(id)).count()
    }

    pub fn search(&self, min_x: f64, min_y: f64, max_x: f64, max_y: f64, out: &mut Vec<Value>) {
        let query = AABB::from_corners([min_x, min_y], [max_x, max_y]);
        for item in self.tree.locate_in_envelope_intersecting(&query) {
            out.push(item.id.clone());
        }
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }
}
