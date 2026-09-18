use std::collections::{HashMap, HashSet};

use glam::{Mat4, Quat, Vec3};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::Entity;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    pub position: Vec3,
    pub rotation: Quat,
    pub scale: Vec3,
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            position: Vec3::ZERO,
            rotation: Quat::IDENTITY,
            scale: Vec3::ONE,
        }
    }
}

impl Transform {
    #[must_use]
    pub fn matrix(self) -> Mat4 {
        Mat4::from_scale_rotation_translation(self.scale, self.rotation, self.position)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GlobalTransform(pub Mat4);

impl Default for GlobalTransform {
    fn default() -> Self {
        Self(Mat4::IDENTITY)
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum HierarchyError {
    #[error("entity cannot be its own parent")]
    SelfParent,
    #[error("parenting would create a cycle")]
    Cycle,
    #[error("transform hierarchy refers to a missing entity")]
    MissingEntity,
}

/// Owns the hot transform tree separately from editor UUID metadata. Dirty
/// descendants are recomputed only when an ancestor or local value changes.
#[derive(Debug, Default)]
pub struct TransformHierarchy {
    local: HashMap<Entity, Transform>,
    global: HashMap<Entity, GlobalTransform>,
    parent: HashMap<Entity, Entity>,
    children: HashMap<Entity, Vec<Entity>>,
    dirty: HashSet<Entity>,
}

impl TransformHierarchy {
    pub fn insert(&mut self, entity: Entity, transform: Transform) {
        self.local.insert(entity, transform);
        self.mark_dirty(entity);
    }

    pub fn remove(&mut self, entity: Entity) {
        if let Some(parent) = self.parent.remove(&entity)
            && let Some(children) = self.children.get_mut(&parent)
        {
            children.retain(|child| *child != entity);
        }
        if let Some(children) = self.children.remove(&entity) {
            for child in children {
                self.parent.remove(&child);
                self.mark_dirty(child);
            }
        }
        self.local.remove(&entity);
        self.global.remove(&entity);
        self.dirty.remove(&entity);
    }

    pub fn set_local(
        &mut self,
        entity: Entity,
        transform: Transform,
    ) -> Result<(), HierarchyError> {
        let local = self
            .local
            .get_mut(&entity)
            .ok_or(HierarchyError::MissingEntity)?;
        *local = transform;
        self.mark_dirty(entity);
        Ok(())
    }

    pub fn set_parent(
        &mut self,
        child: Entity,
        parent: Option<Entity>,
    ) -> Result<(), HierarchyError> {
        if !self.local.contains_key(&child)
            || parent.is_some_and(|value| !self.local.contains_key(&value))
        {
            return Err(HierarchyError::MissingEntity);
        }
        if parent == Some(child) {
            return Err(HierarchyError::SelfParent);
        }
        let mut cursor = parent;
        while let Some(entity) = cursor {
            if entity == child {
                return Err(HierarchyError::Cycle);
            }
            cursor = self.parent.get(&entity).copied();
        }

        if let Some(old_parent) = self.parent.remove(&child)
            && let Some(children) = self.children.get_mut(&old_parent)
        {
            children.retain(|value| *value != child);
        }
        if let Some(parent) = parent {
            self.parent.insert(child, parent);
            self.children.entry(parent).or_default().push(child);
        }
        self.mark_dirty(child);
        Ok(())
    }

    pub fn update(&mut self) {
        let roots: Vec<_> = self
            .dirty
            .iter()
            .copied()
            .filter(|entity| {
                self.parent
                    .get(entity)
                    .is_none_or(|parent| !self.dirty.contains(parent))
            })
            .collect();
        for root in roots {
            let parent_matrix = self
                .parent
                .get(&root)
                .and_then(|parent| self.global.get(parent))
                .map_or(Mat4::IDENTITY, |transform| transform.0);
            self.update_branch(root, parent_matrix);
        }
    }

    #[must_use]
    pub fn local(&self, entity: Entity) -> Option<&Transform> {
        self.local.get(&entity)
    }

    #[must_use]
    pub fn global(&self, entity: Entity) -> Option<&GlobalTransform> {
        self.global.get(&entity)
    }

    #[must_use]
    pub fn parent(&self, entity: Entity) -> Option<Entity> {
        self.parent.get(&entity).copied()
    }

    fn mark_dirty(&mut self, entity: Entity) {
        let mut stack = vec![entity];
        while let Some(current) = stack.pop() {
            if self.dirty.insert(current)
                && let Some(children) = self.children.get(&current)
            {
                stack.extend(children.iter().copied());
            }
        }
    }

    fn update_branch(&mut self, entity: Entity, parent_matrix: Mat4) {
        let Some(local) = self.local.get(&entity).copied() else {
            return;
        };
        let matrix = parent_matrix * local.matrix();
        self.global.insert(entity, GlobalTransform(matrix));
        self.dirty.remove(&entity);
        let children = self.children.get(&entity).cloned().unwrap_or_default();
        for child in children {
            self.update_branch(child, matrix);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn propagates_parent_transforms_and_rejects_cycles() {
        let root = Entity::new(0, 0);
        let child = Entity::new(1, 0);
        let mut graph = TransformHierarchy::default();
        graph.insert(
            root,
            Transform {
                position: Vec3::X,
                ..Transform::default()
            },
        );
        graph.insert(
            child,
            Transform {
                position: Vec3::Y,
                ..Transform::default()
            },
        );
        graph.set_parent(child, Some(root)).unwrap();
        assert_eq!(
            graph.set_parent(root, Some(child)),
            Err(HierarchyError::Cycle)
        );
        graph.update();
        let translation = graph.global(child).unwrap().0.transform_point3(Vec3::ZERO);
        assert_eq!(translation, Vec3::new(1.0, 1.0, 0.0));
    }
}
