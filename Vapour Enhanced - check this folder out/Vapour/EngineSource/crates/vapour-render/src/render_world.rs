use serde::{Deserialize, Serialize};

use thiserror::Error;

pub const RENDER_WORLD_VERSION: u32 = 1;
pub const MAX_RENDER_INSTANCES: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderWorld {
    pub version: u32,
    pub camera: Option<RenderCamera>,
    pub directional_light: Option<RenderDirectionalLight>,
    pub instances: Vec<RenderInstance>,
}

impl Default for RenderWorld {
    fn default() -> Self {
        Self {
            version: RENDER_WORLD_VERSION,
            camera: None,
            directional_light: None,
            instances: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderCamera {
    pub entity_id: String,
    pub world_matrix: [f32; 16],
    pub field_of_view: f32,
    #[serde(default)]
    pub projection: CameraProjection,
    #[serde(default = "default_orthographic_size")]
    pub orthographic_size: f32,
    pub near: f32,
    pub far: f32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CameraProjection {
    #[default]
    Perspective,
    Orthographic,
}

const fn default_orthographic_size() -> f32 {
    10.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderDirectionalLight {
    pub entity_id: String,
    pub world_matrix: [f32; 16],
    pub color: [f32; 3],
    pub intensity: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderInstance {
    pub entity_id: String,
    /// Identifier of an uploaded mesh: a `builtin:` primitive, or any mesh the
    /// game supplied at runtime.
    pub mesh: String,
    #[serde(default = "default_material")]
    pub material: String,
    pub model_matrix: [f32; 16],
    #[serde(default = "default_base_color")]
    pub base_color: [f32; 4],
    /// `[metallic, roughness, emissive strength, alpha cutoff]`.
    ///
    /// Packed into one vector because it travels as a single vertex attribute.
    /// These are per-instance so a scene can vary surface response without a
    /// material asset system, which does not exist yet.
    #[serde(default = "default_material_params")]
    pub material_params: [f32; 4],
}

#[derive(Debug, Error, PartialEq)]
pub enum RenderWorldError {
    #[error("unsupported render-world version {actual}; expected {expected}")]
    UnsupportedVersion { actual: u32, expected: u32 },
    #[error("render world contains {actual} instances; the current limit is {maximum}")]
    TooManyInstances { actual: usize, maximum: usize },
    #[error("{field} contains a non-finite number")]
    NonFinite { field: String },
    #[error("camera near plane must be positive and far plane must be greater than near")]
    InvalidCameraPlanes,
    #[error("camera field of view must be between 1 and 179 degrees")]
    InvalidFieldOfView,
    #[error("camera orthographic size must be finite and positive")]
    InvalidOrthographicSize,
    #[error("directional light intensity must be non-negative")]
    InvalidLightIntensity,
    #[error("instance '{entity}' has an empty mesh identifier")]
    EmptyMeshId { entity: String },
    #[error("instance '{entity}' has an empty material identifier")]
    EmptyMaterialId { entity: String },
}

impl RenderWorld {
    pub fn validate(&self) -> Result<(), RenderWorldError> {
        if self.version != RENDER_WORLD_VERSION {
            return Err(RenderWorldError::UnsupportedVersion {
                actual: self.version,
                expected: RENDER_WORLD_VERSION,
            });
        }
        if self.instances.len() > MAX_RENDER_INSTANCES {
            return Err(RenderWorldError::TooManyInstances {
                actual: self.instances.len(),
                maximum: MAX_RENDER_INSTANCES,
            });
        }
        if let Some(camera) = &self.camera {
            finite(&camera.world_matrix, "camera.worldMatrix")?;
            if camera.projection == CameraProjection::Perspective
                && (!camera.field_of_view.is_finite()
                    || !(1.0..179.0).contains(&camera.field_of_view))
            {
                return Err(RenderWorldError::InvalidFieldOfView);
            }
            if camera.projection == CameraProjection::Orthographic
                && (!camera.orthographic_size.is_finite() || camera.orthographic_size <= 0.0)
            {
                return Err(RenderWorldError::InvalidOrthographicSize);
            }
            if !camera.near.is_finite()
                || !camera.far.is_finite()
                || camera.near <= 0.0
                || camera.far <= camera.near
            {
                return Err(RenderWorldError::InvalidCameraPlanes);
            }
        }
        if let Some(light) = &self.directional_light {
            finite(&light.world_matrix, "directionalLight.worldMatrix")?;
            finite(&light.color, "directionalLight.color")?;
            if !light.intensity.is_finite() || light.intensity < 0.0 {
                return Err(RenderWorldError::InvalidLightIntensity);
            }
        }
        for instance in &self.instances {
            if instance.mesh.trim().is_empty() {
                return Err(RenderWorldError::EmptyMeshId {
                    entity: instance.entity_id.clone(),
                });
            }
            if instance.material.trim().is_empty() {
                return Err(RenderWorldError::EmptyMaterialId {
                    entity: instance.entity_id.clone(),
                });
            }
            finite(
                &instance.model_matrix,
                &format!("instances[{}].modelMatrix", instance.entity_id),
            )?;
            finite(
                &instance.base_color,
                &format!("instances[{}].baseColor", instance.entity_id),
            )?;
            finite(
                &instance.material_params,
                &format!("instances[{}].materialParams", instance.entity_id),
            )?;
        }
        Ok(())
    }
}

fn finite(values: &[f32], field: &str) -> Result<(), RenderWorldError> {
    if values.iter().all(|value| value.is_finite()) {
        Ok(())
    } else {
        Err(RenderWorldError::NonFinite {
            field: field.into(),
        })
    }
}

const fn default_base_color() -> [f32; 4] {
    [0.24, 0.48, 1.0, 1.0]
}

fn default_material() -> String {
    "builtin:default".to_owned()
}

/// A dielectric with a moderately rough surface, no emission, and a cutoff low
/// enough that fully opaque materials are never clipped.
const fn default_material_params() -> [f32; 4] {
    [0.0, 0.6, 0.0, 0.01]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> [f32; 16] {
        [
            1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ]
    }

    #[test]
    fn validates_a_scene_snapshot() {
        let world = RenderWorld {
            version: RENDER_WORLD_VERSION,
            camera: Some(RenderCamera {
                entity_id: "camera".into(),
                world_matrix: identity(),
                field_of_view: 60.0,
                projection: CameraProjection::Perspective,
                orthographic_size: 10.0,
                near: 0.1,
                far: 1_000.0,
            }),
            directional_light: None,
            instances: vec![RenderInstance {
                entity_id: "cube".into(),
                mesh: "builtin:cube".into(),
                material: default_material(),
                model_matrix: identity(),
                base_color: [1.0, 0.5, 0.25, 1.0],
                material_params: default_material_params(),
            }],
        };
        assert_eq!(world.validate(), Ok(()));
    }

    #[test]
    fn rejects_invalid_versions_and_numbers() {
        let mut world = RenderWorld {
            version: 2,
            ..RenderWorld::default()
        };
        assert!(matches!(
            world.validate(),
            Err(RenderWorldError::UnsupportedVersion { .. })
        ));
        world.version = RENDER_WORLD_VERSION;
        world.instances.push(RenderInstance {
            entity_id: "bad".into(),
            mesh: "builtin:cube".into(),
            material: default_material(),
            model_matrix: [f32::NAN; 16],
            base_color: [1.0; 4],
            material_params: default_material_params(),
        });
        assert!(matches!(
            world.validate(),
            Err(RenderWorldError::NonFinite { .. })
        ));
    }

    #[test]
    fn old_scene_instances_default_to_the_builtin_material() {
        let json = r#"{
          "version": 1,
          "instances": [{
            "entityId": "legacy",
            "mesh": "builtin:cube",
            "modelMatrix": [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
          }]
        }"#;
        let world: RenderWorld = serde_json::from_str(json).unwrap();
        assert_eq!(world.instances[0].material, "builtin:default");
        assert_eq!(world.validate(), Ok(()));
    }
}
