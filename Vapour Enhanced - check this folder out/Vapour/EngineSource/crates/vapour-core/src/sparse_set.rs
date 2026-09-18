use crate::Entity;

/// Dense component storage with O(1) insertion, lookup, and removal.
#[derive(Debug)]
pub struct SparseSet<T> {
    sparse: Vec<Option<usize>>,
    entities: Vec<Entity>,
    values: Vec<T>,
}

impl<T> Default for SparseSet<T> {
    fn default() -> Self {
        Self {
            sparse: Vec::new(),
            entities: Vec::new(),
            values: Vec::new(),
        }
    }
}

impl<T> SparseSet<T> {
    pub fn insert(&mut self, entity: Entity, value: T) -> Option<T> {
        let sparse_index = entity.index() as usize;
        if sparse_index >= self.sparse.len() {
            self.sparse.resize(sparse_index + 1, None);
        }

        if let Some(dense_index) = self.valid_dense_index(entity) {
            return Some(std::mem::replace(&mut self.values[dense_index], value));
        }

        // A recycled entity index may still point at an old generation if its
        // owner forgot to remove it. Repair that state before insertion.
        if self.sparse[sparse_index].is_some() {
            self.remove_index(sparse_index);
        }

        let dense_index = self.values.len();
        self.entities.push(entity);
        self.values.push(value);
        self.sparse[sparse_index] = Some(dense_index);
        None
    }

    #[must_use]
    pub fn get(&self, entity: Entity) -> Option<&T> {
        self.valid_dense_index(entity)
            .and_then(|index| self.values.get(index))
    }

    pub fn get_mut(&mut self, entity: Entity) -> Option<&mut T> {
        self.valid_dense_index(entity)
            .and_then(|index| self.values.get_mut(index))
    }

    pub fn remove(&mut self, entity: Entity) -> Option<T> {
        self.valid_dense_index(entity)?;
        self.remove_index(entity.index() as usize)
    }

    pub fn iter(&self) -> impl ExactSizeIterator<Item = (Entity, &T)> {
        self.entities.iter().copied().zip(self.values.iter())
    }

    pub fn iter_mut(&mut self) -> impl ExactSizeIterator<Item = (Entity, &mut T)> {
        self.entities.iter().copied().zip(self.values.iter_mut())
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.values.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    fn valid_dense_index(&self, entity: Entity) -> Option<usize> {
        let dense_index = *self.sparse.get(entity.index() as usize)?.as_ref()?;
        (self.entities.get(dense_index).copied() == Some(entity)).then_some(dense_index)
    }

    fn remove_index(&mut self, sparse_index: usize) -> Option<T> {
        let dense_index = self.sparse.get_mut(sparse_index)?.take()?;
        self.entities.swap_remove(dense_index);
        let removed = self.values.swap_remove(dense_index);
        if dense_index < self.entities.len() {
            let moved = self.entities[dense_index];
            self.sparse[moved.index() as usize] = Some(dense_index);
        }
        Some(removed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swap_removal_updates_sparse_index() {
        let mut set = SparseSet::default();
        let a = Entity::new(2, 0);
        let b = Entity::new(9, 0);
        set.insert(a, "a");
        set.insert(b, "b");
        assert_eq!(set.remove(a), Some("a"));
        assert_eq!(set.get(b), Some(&"b"));
    }
}
