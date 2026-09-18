use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

pub const SCENE_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneAsset {
    pub format_version: u32,
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub entities: Vec<SceneEntity>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneEntity {
    pub id: Uuid,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<Uuid>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub components: Vec<ComponentRecord>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentRecord {
    pub type_name: String,
    pub version: u32,
    pub data: Value,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SceneError {
    #[error("unsupported scene format {found}; runtime supports {supported}")]
    UnsupportedVersion { found: u32, supported: u32 },
    #[error("duplicate entity id {0}")]
    DuplicateEntity(Uuid),
    #[error("entity {entity} references missing parent {parent}")]
    MissingParent { entity: Uuid, parent: Uuid },
    #[error("scene hierarchy contains a cycle at entity {0}")]
    HierarchyCycle(Uuid),
    #[error("entity {entity} has duplicate component type {type_name}")]
    DuplicateComponent { entity: Uuid, type_name: String },
}

impl SceneAsset {
    #[must_use]
    pub fn empty(name: impl Into<String>) -> Self {
        Self {
            format_version: SCENE_FORMAT_VERSION,
            id: Uuid::new_v4(),
            name: name.into(),
            entities: Vec::new(),
        }
    }

    pub fn validate(&self) -> Result<(), SceneError> {
        if self.format_version != SCENE_FORMAT_VERSION {
            return Err(SceneError::UnsupportedVersion {
                found: self.format_version,
                supported: SCENE_FORMAT_VERSION,
            });
        }
        let mut ids = HashSet::with_capacity(self.entities.len());
        for entity in &self.entities {
            if !ids.insert(entity.id) {
                return Err(SceneError::DuplicateEntity(entity.id));
            }
            let mut component_types = HashSet::with_capacity(entity.components.len());
            for component in &entity.components {
                if !component_types.insert(component.type_name.as_str()) {
                    return Err(SceneError::DuplicateComponent {
                        entity: entity.id,
                        type_name: component.type_name.clone(),
                    });
                }
            }
        }
        let parents: HashMap<_, _> = self.entities.iter().map(|e| (e.id, e.parent)).collect();
        for entity in &self.entities {
            if let Some(parent) = entity.parent
                && !ids.contains(&parent)
            {
                return Err(SceneError::MissingParent {
                    entity: entity.id,
                    parent,
                });
            }
            let mut visited = HashSet::new();
            let mut cursor = Some(entity.id);
            while let Some(id) = cursor {
                if !visited.insert(id) {
                    return Err(SceneError::HierarchyCycle(id));
                }
                cursor = parents.get(&id).copied().flatten();
            }
        }
        Ok(())
    }

    /// Produces stable output for review and merge-friendly source control.
    #[must_use]
    pub fn canonicalized(mut self) -> Self {
        for entity in &mut self.entities {
            entity
                .components
                .sort_by(|a, b| a.type_name.cmp(&b.type_name));
        }
        self.entities.sort_by_key(|entity| entity.id);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entity(id: Uuid, parent: Option<Uuid>) -> SceneEntity {
        SceneEntity {
            id,
            name: "Entity".into(),
            parent,
            enabled: true,
            components: Vec::new(),
        }
    }

    #[test]
    fn rejects_cycles() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let scene = SceneAsset {
            format_version: SCENE_FORMAT_VERSION,
            id: Uuid::new_v4(),
            name: "Cycle".into(),
            entities: vec![entity(a, Some(b)), entity(b, Some(a))],
        };
        assert!(matches!(
            scene.validate(),
            Err(SceneError::HierarchyCycle(_))
        ));
    }

    #[test]
    fn round_trip_preserves_scene() {
        let scene = SceneAsset::empty("Main");
        let json = serde_json::to_string_pretty(&scene).unwrap();
        let decoded: SceneAsset = serde_json::from_str(&json).unwrap();
        assert_eq!(scene, decoded);
        decoded.validate().unwrap();
    }
}
