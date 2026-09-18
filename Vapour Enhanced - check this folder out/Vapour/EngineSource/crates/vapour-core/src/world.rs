use std::{
    any::{Any, TypeId},
    collections::HashMap,
};

use thiserror::Error;

use crate::{Entity, EntityAllocator, SparseSet};

pub trait Component: Send + Sync + 'static {}
impl<T: Send + Sync + 'static> Component for T {}

trait ErasedStore: Send + Sync {
    fn remove(&mut self, entity: Entity);
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

impl<T: Component> ErasedStore for SparseSet<T> {
    fn remove(&mut self, entity: Entity) {
        self.remove(entity);
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn Any {
        self
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum WorldError {
    #[error("entity {0:?} is not alive")]
    DeadEntity(Entity),
}

#[derive(Default)]
pub struct World {
    entities: EntityAllocator,
    stores: HashMap<TypeId, Box<dyn ErasedStore>>,
}

impl World {
    #[must_use]
    pub fn spawn(&mut self) -> Entity {
        self.entities.spawn()
    }

    pub fn despawn(&mut self, entity: Entity) -> Result<(), WorldError> {
        if !self.entities.despawn(entity) {
            return Err(WorldError::DeadEntity(entity));
        }
        for store in self.stores.values_mut() {
            store.remove(entity);
        }
        Ok(())
    }

    pub fn insert<T: Component>(
        &mut self,
        entity: Entity,
        value: T,
    ) -> Result<Option<T>, WorldError> {
        if !self.entities.is_alive(entity) {
            return Err(WorldError::DeadEntity(entity));
        }
        Ok(self.store_mut_or_default::<T>().insert(entity, value))
    }

    #[must_use]
    pub fn get<T: Component>(&self, entity: Entity) -> Option<&T> {
        self.store::<T>()?.get(entity)
    }

    pub fn get_mut<T: Component>(&mut self, entity: Entity) -> Option<&mut T> {
        self.store_mut::<T>()?.get_mut(entity)
    }

    #[must_use]
    pub fn components<T: Component>(&self) -> Option<&SparseSet<T>> {
        self.store::<T>()
    }

    pub fn components_mut<T: Component>(&mut self) -> &mut SparseSet<T> {
        self.store_mut_or_default::<T>()
    }

    #[must_use]
    pub fn is_alive(&self, entity: Entity) -> bool {
        self.entities.is_alive(entity)
    }

    #[must_use]
    pub const fn entity_count(&self) -> usize {
        self.entities.len()
    }

    fn store<T: Component>(&self) -> Option<&SparseSet<T>> {
        self.stores.get(&TypeId::of::<T>())?.as_any().downcast_ref()
    }

    fn store_mut<T: Component>(&mut self) -> Option<&mut SparseSet<T>> {
        self.stores
            .get_mut(&TypeId::of::<T>())?
            .as_any_mut()
            .downcast_mut()
    }

    fn store_mut_or_default<T: Component>(&mut self) -> &mut SparseSet<T> {
        self.stores
            .entry(TypeId::of::<T>())
            .or_insert_with(|| Box::<SparseSet<T>>::default())
            .as_any_mut()
            .downcast_mut()
            .expect("component store type is keyed by TypeId")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn despawn_removes_every_component() {
        let mut world = World::default();
        let entity = world.spawn();
        world.insert(entity, 42_u32).unwrap();
        world.insert(entity, String::from("name")).unwrap();
        world.despawn(entity).unwrap();
        assert!(world.get::<u32>(entity).is_none());
        assert!(world.get::<String>(entity).is_none());
    }
}
