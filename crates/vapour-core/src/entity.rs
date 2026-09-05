use serde::{Deserialize, Serialize};

/// A compact runtime-only entity handle. Recycled indices get a new generation,
/// so stale handles cannot mutate a replacement entity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Entity {
    index: u32,
    generation: u32,
}

impl Entity {
    #[must_use]
    pub const fn new(index: u32, generation: u32) -> Self {
        Self { index, generation }
    }

    #[must_use]
    pub const fn index(self) -> u32 {
        self.index
    }

    #[must_use]
    pub const fn generation(self) -> u32 {
        self.generation
    }
}

#[derive(Debug, Default)]
pub struct EntityAllocator {
    generations: Vec<u32>,
    alive: Vec<bool>,
    free: Vec<u32>,
    len: usize,
}

impl EntityAllocator {
    #[must_use]
    pub fn spawn(&mut self) -> Entity {
        self.len += 1;
        if let Some(index) = self.free.pop() {
            self.alive[index as usize] = true;
            Entity::new(index, self.generations[index as usize])
        } else {
            let index = u32::try_from(self.generations.len())
                .expect("entity index capacity exceeds u32::MAX");
            self.generations.push(0);
            self.alive.push(true);
            Entity::new(index, 0)
        }
    }

    pub fn despawn(&mut self, entity: Entity) -> bool {
        if !self.is_alive(entity) {
            return false;
        }
        let index = entity.index as usize;
        self.alive[index] = false;
        self.generations[index] = self.generations[index].wrapping_add(1);
        self.free.push(entity.index);
        self.len -= 1;
        true
    }

    #[must_use]
    pub fn is_alive(&self, entity: Entity) -> bool {
        let index = entity.index as usize;
        self.alive.get(index).copied().unwrap_or(false)
            && self.generations[index] == entity.generation
    }

    #[must_use]
    pub const fn len(&self) -> usize {
        self.len
    }

    #[must_use]
    pub const fn is_empty(&self) -> bool {
        self.len == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_handle_does_not_address_recycled_entity() {
        let mut allocator = EntityAllocator::default();
        let first = allocator.spawn();
        assert!(allocator.despawn(first));
        let replacement = allocator.spawn();
        assert_eq!(first.index(), replacement.index());
        assert_ne!(first.generation(), replacement.generation());
        assert!(!allocator.is_alive(first));
        assert!(allocator.is_alive(replacement));
    }
}
