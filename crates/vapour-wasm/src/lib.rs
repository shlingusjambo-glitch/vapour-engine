use std::{collections::HashMap, time::Duration};

use glam::{Quat, Vec3};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use vapour_core::{
    CharacterControllerDescriptor2d, CharacterControllerDescriptor3d, ColliderShape2d,
    ColliderShape3d, Entity, JointSpec3d, PhysicsBodyDescriptor2d, PhysicsBodyDescriptor3d,
    PhysicsEvent2d, PhysicsEvent3d, PhysicsMaterial, PhysicsStats3d, PhysicsWorld2d,
    PhysicsWorld3d, RaycastHit2d, RaycastHit3d, ShapeCastHit2d, ShapeCastHit3d, Time, Transform,
    TransformHierarchy, World,
};
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
use vapour_render::{
    AntiAliasing, DebugView, GpuContext, GpuRequest, PostProcessSettings, RenderFrame,
    RenderLayers, RenderWorld, StandardMaterialDescriptor, SurfaceRenderer, ToneMapping,
    build_mesh_with_attributes,
};
#[cfg(target_arch = "wasm32")]
use web_sys::HtmlCanvasElement;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum RuntimeCommand {
    Spawn { id: Uuid, transform: TransformData },
    Despawn { id: Uuid },
    SetTransform { id: Uuid, transform: TransformData },
    SetParent { id: Uuid, parent: Option<Uuid> },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransformData {
    position: [f32; 3],
    rotation: [f32; 4],
    scale: [f32; 3],
}

impl From<TransformData> for Transform {
    fn from(value: TransformData) -> Self {
        Self {
            position: Vec3::from_array(value.position),
            rotation: Quat::from_array(value.rotation).normalize(),
            scale: Vec3::from_array(value.scale),
        }
    }
}

impl From<Transform> for TransformData {
    fn from(value: Transform) -> Self {
        Self {
            position: value.position.to_array(),
            rotation: value.rotation.to_array(),
            scale: value.scale.to_array(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EntitySnapshot {
    id: Uuid,
    transform: TransformData,
    world_matrix: [f32; 16],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeSnapshot {
    entity_count: usize,
    entities: Vec<EntitySnapshot>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum PhysicsCommand2d {
    Insert {
        descriptor: PhysicsBodyDescriptor2d,
    },
    Remove {
        id: u64,
    },
    AddForce {
        id: u64,
        force: [f32; 2],
    },
    AddForceAtPoint {
        id: u64,
        force: [f32; 2],
        point: [f32; 2],
    },
    AddTorque {
        id: u64,
        torque: f32,
    },
    ApplyImpulse {
        id: u64,
        impulse: [f32; 2],
    },
    ApplyTorqueImpulse {
        id: u64,
        torque: f32,
    },
    SetLinearVelocity {
        id: u64,
        velocity: [f32; 2],
    },
    SetAngularVelocity {
        id: u64,
        velocity: f32,
    },
    SetKinematicTarget {
        id: u64,
        position: [f32; 2],
        rotation: f32,
    },
    SetGravity {
        gravity: [f32; 2],
    },
    DefineMaterial {
        material: PhysicsMaterial,
    },
    SetMaterial {
        id: u64,
        name: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhysicsStep2d {
    bodies: Vec<vapour_core::PhysicsBodySnapshot2d>,
    events: Vec<PhysicsEvent2d>,
}

/// Coarse-grained browser boundary for Vapour's native 2D physics world.
#[wasm_bindgen]
pub struct PhysicsEngine2d {
    world: PhysicsWorld2d,
}

#[wasm_bindgen]
impl PhysicsEngine2d {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(gravity_x: f32, gravity_y: f32) -> Self {
        console_error_panic_hook::set_once();
        Self {
            world: PhysicsWorld2d::new([gravity_x, gravity_y]),
        }
    }

    pub fn apply_commands(&mut self, json: &str) -> Result<u32, JsError> {
        let commands: Vec<PhysicsCommand2d> = serde_json::from_str(json)
            .map_err(|error| JsError::new(&format!("invalid 2D physics command batch: {error}")))?;
        let count = u32::try_from(commands.len())
            .map_err(|_| JsError::new("2D physics command batch exceeds u32::MAX commands"))?;
        for command in commands {
            let result = match command {
                PhysicsCommand2d::Insert { descriptor } => self.world.insert(descriptor),
                PhysicsCommand2d::Remove { id } => self.world.remove(id),
                PhysicsCommand2d::AddForce { id, force } => self.world.add_force(id, force),
                PhysicsCommand2d::AddForceAtPoint { id, force, point } => {
                    self.world.add_force_at_point(id, force, point)
                }
                PhysicsCommand2d::AddTorque { id, torque } => self.world.add_torque(id, torque),
                PhysicsCommand2d::ApplyImpulse { id, impulse } => {
                    self.world.apply_impulse(id, impulse)
                }
                PhysicsCommand2d::ApplyTorqueImpulse { id, torque } => {
                    self.world.apply_torque_impulse(id, torque)
                }
                PhysicsCommand2d::SetLinearVelocity { id, velocity } => {
                    self.world.set_linear_velocity(id, velocity)
                }
                PhysicsCommand2d::SetAngularVelocity { id, velocity } => {
                    self.world.set_angular_velocity(id, velocity)
                }
                PhysicsCommand2d::SetKinematicTarget {
                    id,
                    position,
                    rotation,
                } => self.world.set_kinematic_target(id, position, rotation),
                PhysicsCommand2d::SetGravity { gravity } => self.world.set_gravity(gravity),
                PhysicsCommand2d::DefineMaterial { material } => {
                    self.world.define_material(material)
                }
                PhysicsCommand2d::SetMaterial { id, name } => self.world.set_material(id, &name),
            };
            result.map_err(|error| {
                JsError::new(&format!("2D physics command was rejected: {error}"))
            })?;
        }
        Ok(count)
    }

    pub fn step_json(&mut self, timestep: f32) -> Result<String, JsError> {
        let events = self
            .world
            .step(timestep)
            .map_err(|error| JsError::new(&error.to_string()))?;
        serde_json::to_string(&PhysicsStep2d {
            bodies: self.world.snapshots(),
            events,
        })
        .map_err(|error| JsError::new(&format!("failed to serialize 2D physics step: {error}")))
    }

    pub fn raycast_json(
        &self,
        origin: &[f32],
        direction: &[f32],
        max_distance: f32,
        layer: u32,
        mask: u32,
        include_sensors: bool,
    ) -> Result<String, JsError> {
        let origin: [f32; 2] = origin
            .try_into()
            .map_err(|_| JsError::new("2D physics ray origin requires exactly 2 floats"))?;
        let direction: [f32; 2] = direction
            .try_into()
            .map_err(|_| JsError::new("2D physics ray direction requires exactly 2 floats"))?;
        let hit: Option<RaycastHit2d> = self
            .world
            .raycast(
                origin,
                direction,
                max_distance,
                layer,
                mask,
                include_sensors,
            )
            .map_err(|error| JsError::new(&error.to_string()))?;
        serde_json::to_string(&hit).map_err(|error| {
            JsError::new(&format!("failed to serialize 2D physics raycast: {error}"))
        })
    }

    pub fn overlap_shape_json(
        &self,
        position: &[f32],
        rotation: f32,
        shape_json: &str,
        layer: u32,
        mask: u32,
        include_sensors: bool,
    ) -> Result<String, JsError> {
        let position: [f32; 2] = position
            .try_into()
            .map_err(|_| JsError::new("2D overlap position requires exactly 2 floats"))?;
        let shape: ColliderShape2d = serde_json::from_str(shape_json)
            .map_err(|error| JsError::new(&format!("invalid 2D overlap shape: {error}")))?;
        let ids = self
            .world
            .overlap_shape(position, rotation, &shape, layer, mask, include_sensors)
            .map_err(|error| JsError::new(&error.to_string()))?;
        serde_json::to_string(&ids).map_err(|error| {
            JsError::new(&format!("failed to serialize 2D overlap result: {error}"))
        })
    }

    // Flat scalars/typed arrays avoid a second JSON parse for hot query inputs.
    #[allow(clippy::too_many_arguments)]
    pub fn cast_shape_json(
        &self,
        position: &[f32],
        rotation: f32,
        direction: &[f32],
        max_distance: f32,
        shape_json: &str,
        layer: u32,
        mask: u32,
        include_sensors: bool,
    ) -> Result<String, JsError> {
        let position: [f32; 2] = position
            .try_into()
            .map_err(|_| JsError::new("2D shape-cast position requires exactly 2 floats"))?;
        let direction: [f32; 2] = direction
            .try_into()
            .map_err(|_| JsError::new("2D shape-cast direction requires exactly 2 floats"))?;
        let shape: ColliderShape2d = serde_json::from_str(shape_json)
            .map_err(|error| JsError::new(&format!("invalid 2D cast shape: {error}")))?;
        let hit: Option<ShapeCastHit2d> = self
            .world
            .cast_shape(
                position,
                rotation,
                direction,
                max_distance,
                &shape,
                layer,
                mask,
                include_sensors,
            )
            .map_err(|error| JsError::new(&error.to_string()))?;
        serde_json::to_string(&hit).map_err(|error| {
            JsError::new(&format!(
                "failed to serialize 2D shape-cast result: {error}"
            ))
        })
    }

    pub fn move_character_json(
        &self,
        timestep: f32,
        position: &[f32],
        rotation: f32,
        desired_translation: &[f32],
        descriptor_json: &str,
    ) -> Result<String, JsError> {
        let position: [f32; 2] = position
            .try_into()
            .map_err(|_| JsError::new("2D character position requires exactly 2 floats"))?;
        let desired_translation: [f32; 2] = desired_translation
            .try_into()
            .map_err(|_| JsError::new("2D character translation requires exactly 2 floats"))?;
        let descriptor: CharacterControllerDescriptor2d = serde_json::from_str(descriptor_json)
            .map_err(|error| JsError::new(&format!("invalid 2D character controller: {error}")))?;
        let movement = self
            .world
            .move_character(
                timestep,
                position,
                rotation,
                desired_translation,
                &descriptor,
            )
            .map_err(|error| JsError::new(&error.to_string()))?;
        serde_json::to_string(&movement).map_err(|error| {
            JsError::new(&format!(
                "failed to serialize 2D character movement: {error}"
            ))
        })
    }

    #[must_use]
    pub fn body_count(&self) -> usize {
        self.world.body_count()
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum PhysicsCommand3d {
    Insert {
        descriptor: PhysicsBodyDescriptor3d,
    },
    Remove {
        id: u64,
    },
    AddForce {
        id: u64,
        force: [f32; 3],
    },
    AddForceAtPoint {
        id: u64,
        force: [f32; 3],
        point: [f32; 3],
    },
    AddTorque {
        id: u64,
        torque: [f32; 3],
    },
    ApplyImpulse {
        id: u64,
        impulse: [f32; 3],
    },
    ApplyTorqueImpulse {
        id: u64,
        torque: [f32; 3],
    },
    SetLinearVelocity {
        id: u64,
        velocity: [f32; 3],
    },
    SetAngularVelocity {
        id: u64,
        velocity: [f32; 3],
    },
    SetKinematicTarget {
        id: u64,
        position: [f32; 3],
        rotation: [f32; 4],
    },
    AddJoint {
        spec: JointSpec3d,
    },
    RemoveJoint {
        id: u64,
    },
    SetJointMotor {
        id: u64,
        target_velocity: f32,
        max_force: f32,
    },
    SetGravity {
        gravity: [f32; 3],
    },
    DefineMaterial {
        material: PhysicsMaterial,
    },
    SetMaterial {
        id: u64,
        name: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhysicsStep3d {
    bodies: Vec<vapour_core::PhysicsBodySnapshot3d>,
    events: Vec<PhysicsEvent3d>,
    stats: PhysicsStats3d,
}

/// Browser-facing Rust physics world. Commands and results cross once per
/// simulation step; Rapier handles and fine-grained solver calls stay in WASM.
#[wasm_bindgen]
pub struct PhysicsEngine3d {
    world: PhysicsWorld3d,
}

#[wasm_bindgen]
impl PhysicsEngine3d {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new(gravity_x: f32, gravity_y: f32, gravity_z: f32) -> Self {
        console_error_panic_hook::set_once();
        Self {
            world: PhysicsWorld3d::new([gravity_x, gravity_y, gravity_z]),
        }
    }

    pub fn apply_commands(&mut self, json: &str) -> Result<u32, JsError> {
        let commands: Vec<PhysicsCommand3d> = serde_json::from_str(json)
            .map_err(|error| JsError::new(&format!("invalid 3D physics command batch: {error}")))?;
        let count = u32::try_from(commands.len())
            .map_err(|_| JsError::new("3D physics command batch exceeds u32::MAX commands"))?;
        for command in commands {
            let result = match command {
                PhysicsCommand3d::Insert { descriptor } => self.world.insert(descriptor),
                PhysicsCommand3d::Remove { id } => self.world.remove(id),
                PhysicsCommand3d::AddForce { id, force } => self.world.add_force(id, force),
                PhysicsCommand3d::AddForceAtPoint { id, force, point } => {
                    self.world.add_force_at_point(id, force, point)
                }
                PhysicsCommand3d::AddTorque { id, torque } => self.world.add_torque(id, torque),
                PhysicsCommand3d::ApplyImpulse { id, impulse } => {
                    self.world.apply_impulse(id, impulse)
                }
                PhysicsCommand3d::ApplyTorqueImpulse { id, torque } => {
                    self.world.apply_torque_impulse(id, torque)
                }
                PhysicsCommand3d::SetLinearVelocity { id, velocity } => {
                    self.world.set_linear_velocity(id, velocity)
                }
                PhysicsCommand3d::SetAngularVelocity { id, velocity } => {
                    self.world.set_angular_velocity(id, velocity)
                }
                PhysicsCommand3d::SetKinematicTarget {
                    id,
                    position,
                    rotation,
                } => self.world.set_kinematic_target(id, position, rotation),
                PhysicsCommand3d::AddJoint { spec } => self.world.add_joint(spec),
                PhysicsCommand3d::RemoveJoint { id } => self.world.remove_joint(id),
                PhysicsCommand3d::SetJointMotor {
                    id,
                    target_velocity,
                    max_force,
                } => self.world.set_joint_motor(id, target_velocity, max_force),
                PhysicsCommand3d::SetGravity { gravity } => self.world.set_gravity(gravity),
                PhysicsCommand3d::DefineMaterial { material } => {
                    self.world.define_material(material)
                }
                PhysicsCommand3d::SetMaterial { id, name } => self.world.set_material(id, &name),
            };
            result.map_err(|error| {
                JsError::new(&format!("3D physics command was rejected: {error}"))
            })?;
        }
        Ok(count)
    }

    pub fn step_json(&mut self, timestep: f32) -> Result<String, JsError> {
        let events = self
            .world
            .step(timestep)
            .map_err(|error| JsError::new(&error.to_string()))?;
        serde_json::to_string(&PhysicsStep3d {
            bodies: self.world.snapshots(),
            events,
            stats: self.world.stats(),
        })
        .map_err(|error| JsError::new(&format!("failed to serialize 3D physics step: {error}")))
    }

    /// Solver contacts from the last step, for debug rendering. Kept out of
    /// `step_json` because a settled pile of crates has thousands of them.
    pub fn contacts_json(&self) -> Result<String, JsError> {
        serde_json::to_string(&self.world.contacts()).map_err(|error| {
            JsError::new(&format!("failed to serialize 3D physics contacts: {error}"))
        })
    }

    /// `exclude_body` is a body id or `0` for none; passed as a float because
    /// wasm-bindgen would otherwise force `BigInt` on every caller.
    #[allow(clippy::too_many_arguments)]
    pub fn raycast_json(
        &self,
        origin: &[f32],
        direction: &[f32],
        max_distance: f32,
        layer: u32,
        mask: u32,
        include_sensors: bool,
        exclude_body: f64,
    ) -> Result<String, JsError> {
        let exclude = if exclude_body > 0.0 && exclude_body.fract() == 0.0 {
            Some(exclude_body as u64)
        } else {
            None
        };
        let origin: [f32; 3] = origin
            .try_into()
            .map_err(|_| JsError::new("3D physics ray origin requires exactly 3 floats"))?;
        let direction: [f32; 3] = direction
            .try_into()
            .map_err(|_| JsError::new("3D physics ray direction requires exactly 3 floats"))?;
        let hit: Option<RaycastHit3d> = self
            .world
            .raycast(
                origin,
                direction,
                max_distance,
                layer,
                mask,
                include_sensors,
                exclude,
            )
            .map_err(|error| JsError::new(&error.to_string()))?;
        serde_json::to_string(&hit).map_err(|error| {
            JsError::new(&format!("failed to serialize 3D physics raycast: {error}"))
        })
    }

    pub fn overlap_shape_json(
        &self,
        position: &[f32],
        rotation: &[f32],
        shape_json: &str,
        layer: u32,
        mask: u32,
        include_sensors: bool,
    ) -> Result<String, JsError> {
        let position: [f32; 3] = position
            .try_into()
            .map_err(|_| JsError::new("3D overlap position requires exactly 3 floats"))?;
        let rotation: [f32; 4] = rotation
            .try_into()
            .map_err(|_| JsError::new("3D overlap rotation requires exactly 4 floats"))?;
        let shape: ColliderShape3d = serde_json::from_str(shape_json)
            .map_err(|error| JsError::new(&format!("invalid 3D overlap shape: {error}")))?;
        let ids = self
            .world
            .overlap_shape(position, rotation, &shape, layer, mask, include_sensors)
            .map_err(|error| JsError::new(&error.to_string()))?;
        serde_json::to_string(&ids).map_err(|error| {
            JsError::new(&format!("failed to serialize 3D overlap result: {error}"))
        })
    }

    // Flat scalars/typed arrays avoid a second JSON parse for hot query inputs.
    #[allow(clippy::too_many_arguments)]
    pub fn cast_shape_json(
        &self,
        position: &[f32],
        rotation: &[f32],
        direction: &[f32],
        max_distance: f32,
        shape_json: &str,
        layer: u32,
        mask: u32,
        include_sensors: bool,
    ) -> Result<String, JsError> {
        let position: [f32; 3] = position
            .try_into()
            .map_err(|_| JsError::new("3D shape-cast position requires exactly 3 floats"))?;
        let rotation: [f32; 4] = rotation
            .try_into()
            .map_err(|_| JsError::new("3D shape-cast rotation requires exactly 4 floats"))?;
        let direction: [f32; 3] = direction
            .try_into()
            .map_err(|_| JsError::new("3D shape-cast direction requires exactly 3 floats"))?;
        let shape: ColliderShape3d = serde_json::from_str(shape_json)
            .map_err(|error| JsError::new(&format!("invalid 3D cast shape: {error}")))?;
        let hit: Option<ShapeCastHit3d> = self
            .world
            .cast_shape(
                position,
                rotation,
                direction,
                max_distance,
                &shape,
                layer,
                mask,
                include_sensors,
            )
            .map_err(|error| JsError::new(&error.to_string()))?;
        serde_json::to_string(&hit).map_err(|error| {
            JsError::new(&format!(
                "failed to serialize 3D shape-cast result: {error}"
            ))
        })
    }

    pub fn move_character_json(
        &self,
        timestep: f32,
        position: &[f32],
        rotation: &[f32],
        desired_translation: &[f32],
        descriptor_json: &str,
    ) -> Result<String, JsError> {
        let position: [f32; 3] = position
            .try_into()
            .map_err(|_| JsError::new("3D character position requires exactly 3 floats"))?;
        let rotation: [f32; 4] = rotation
            .try_into()
            .map_err(|_| JsError::new("3D character rotation requires exactly 4 floats"))?;
        let desired_translation: [f32; 3] = desired_translation
            .try_into()
            .map_err(|_| JsError::new("3D character translation requires exactly 3 floats"))?;
        let descriptor: CharacterControllerDescriptor3d = serde_json::from_str(descriptor_json)
            .map_err(|error| JsError::new(&format!("invalid 3D character controller: {error}")))?;
        let movement = self
            .world
            .move_character(
                timestep,
                position,
                rotation,
                desired_translation,
                &descriptor,
            )
            .map_err(|error| JsError::new(&error.to_string()))?;
        serde_json::to_string(&movement).map_err(|error| {
            JsError::new(&format!(
                "failed to serialize 3D character movement: {error}"
            ))
        })
    }

    #[must_use]
    pub fn body_count(&self) -> usize {
        self.world.body_count()
    }

    #[must_use]
    pub fn joint_count(&self) -> usize {
        self.world.joint_count()
    }
}

/// Browser-facing runtime. Commands are intentionally passed in batches to
/// keep gameplay loops from making fine-grained JS/WASM calls.
#[wasm_bindgen]
#[derive(Default)]
pub struct Engine {
    world: World,
    transforms: TransformHierarchy,
    stable_to_runtime: HashMap<Uuid, Entity>,
    runtime_to_stable: HashMap<Entity, Uuid>,
    time: Time,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    #[must_use]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        Self::default()
    }

    pub fn apply_commands(&mut self, json: &str) -> Result<(), JsError> {
        let commands: Vec<RuntimeCommand> = serde_json::from_str(json)
            .map_err(|error| JsError::new(&format!("invalid runtime command batch: {error}")))?;
        for command in commands {
            self.apply(command)?;
        }
        self.transforms.update();
        Ok(())
    }

    pub fn tick(&mut self, delta_seconds: f64) -> Result<u32, JsError> {
        if !delta_seconds.is_finite() || delta_seconds < 0.0 {
            return Err(JsError::new(
                "delta_seconds must be finite and non-negative",
            ));
        }
        let step = self.time.advance(Duration::from_secs_f64(delta_seconds));
        self.transforms.update();
        Ok(step.fixed_steps)
    }

    pub fn snapshot_json(&self) -> Result<String, JsError> {
        let mut entities: Vec<_> = self
            .stable_to_runtime
            .iter()
            .filter_map(|(id, entity)| {
                Some(EntitySnapshot {
                    id: *id,
                    transform: (*self.transforms.local(*entity)?).into(),
                    world_matrix: self.transforms.global(*entity)?.0.to_cols_array(),
                })
            })
            .collect();
        entities.sort_by_key(|snapshot| snapshot.id);
        serde_json::to_string(&RuntimeSnapshot {
            entity_count: self.world.entity_count(),
            entities,
        })
        .map_err(|error| JsError::new(&format!("failed to serialize runtime snapshot: {error}")))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(target_arch = "wasm32")]
struct BrowserFrameStats {
    draw_calls: u32,
    triangles: u32,
    cpu_encode_ms: f32,
}

/// Rust-owned WebGPU renderer exported to the browser. TypeScript supplies the
/// canvas and animation clock, while all GPU resources and commands stay in
/// Rust/WASM.
#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
pub struct WebGpuRenderer {
    inner: SurfaceRenderer<'static>,
}

#[wasm_bindgen]
#[cfg(target_arch = "wasm32")]
impl WebGpuRenderer {
    pub async fn create(
        canvas: HtmlCanvasElement,
        width: u32,
        height: u32,
    ) -> Result<WebGpuRenderer, JsError> {
        console_error_panic_hook::set_once();
        let instance = wgpu::Instance::default();
        let target: wgpu::SurfaceTarget<'static> = wgpu::SurfaceTarget::Canvas(canvas);
        let surface: wgpu::Surface<'static> = instance.create_surface(target).map_err(|error| {
            JsError::new(&format!("WebGPU canvas surface creation failed: {error}"))
        })?;
        let context =
            GpuContext::request_from_instance(instance, Some(&surface), GpuRequest::default())
                .await
                .map_err(|error| JsError::new(&error.to_string()))?;
        let inner = SurfaceRenderer::new(context, surface, width, height)
            .map_err(|error| JsError::new(&error.to_string()))?;
        Ok(Self { inner })
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        self.inner.resize(width, height);
    }

    /// Configures the scene-referred HDR presentation pass. Tone mapping is
    /// 0 none, 1 Reinhard, or 2 ACES.
    #[allow(clippy::too_many_arguments)]
    pub fn set_post_process(
        &mut self,
        exposure: f32,
        tone_mapping: u32,
        bloom_intensity: f32,
        bloom_threshold: f32,
        bloom_scatter: f32,
        saturation: f32,
        contrast: f32,
        vignette: f32,
        chromatic_aberration: f32,
        anti_aliasing: u32,
        debug_view: u32,
    ) -> Result<(), JsError> {
        let tone_mapping = match tone_mapping {
            0 => ToneMapping::None,
            1 => ToneMapping::Reinhard,
            2 => ToneMapping::Aces,
            value => {
                return Err(JsError::new(&format!(
                    "tone mapping mode must be 0 (none), 1 (Reinhard), or 2 (ACES), received {value}"
                )));
            }
        };
        let anti_aliasing = match anti_aliasing {
            0 => AntiAliasing::None,
            1 => AntiAliasing::Fxaa,
            value => {
                return Err(JsError::new(&format!(
                    "anti-aliasing mode must be 0 (none) or 1 (FXAA), received {value}"
                )));
            }
        };
        let debug_view = match debug_view {
            0 => DebugView::Final,
            1 => DebugView::Luminance,
            2 => DebugView::FalseColor,
            value => {
                return Err(JsError::new(&format!(
                    "debug view must be 0 (final), 1 (luminance), or 2 (false color), received {value}"
                )));
            }
        };
        self.inner
            .set_post_process(PostProcessSettings {
                exposure,
                tone_mapping,
                bloom_intensity,
                bloom_threshold,
                bloom_scatter,
                saturation,
                contrast,
                vignette,
                chromatic_aberration,
                anti_aliasing,
                debug_view,
            })
            .map_err(|error| JsError::new(&error.to_string()))
    }

    pub fn set_render_world_json(&mut self, json: &str) -> Result<(), JsError> {
        let render_world: RenderWorld = serde_json::from_str(json)
            .map_err(|error| JsError::new(&format!("invalid render-world snapshot: {error}")))?;
        self.inner
            .set_render_world(render_world)
            .map_err(|error| JsError::new(&error.to_string()))
    }

    pub fn render(&mut self, time_seconds: f32) -> Result<String, JsError> {
        if !time_seconds.is_finite() || time_seconds < 0.0 {
            return Err(JsError::new(
                "renderer time must be finite and non-negative",
            ));
        }
        let stats = self
            .inner
            .render(time_seconds)
            .map_err(|error| JsError::new(&error.to_string()))?;
        serde_json::to_string(&BrowserFrameStats {
            draw_calls: stats.draw_calls,
            triangles: stats.triangles,
            cpu_encode_ms: stats.cpu_encode_ms,
        })
        .map_err(|error| JsError::new(&format!("failed to serialize render statistics: {error}")))
    }

    /// Submits one frame as packed arrays: the path a running game uses.
    ///
    /// Everything except the small mesh table crosses as typed arrays, so a
    /// scene of a thousand instances costs a handful of buffer copies rather
    /// than hundreds of kilobytes of JSON per frame.
    #[allow(clippy::too_many_arguments)]
    pub fn set_render_frame(
        &mut self,
        mesh_table_json: &str,
        mesh_indices: &[u32],
        material_table_json: &str,
        material_indices: &[u32],
        matrices: &[f32],
        base_colors: &[f32],
        material_params: &[f32],
        camera: &[f32],
        light: &[f32],
        environment: &[f32],
    ) -> Result<(), JsError> {
        let mesh_table: Vec<String> = serde_json::from_str(mesh_table_json)
            .map_err(|error| JsError::new(&format!("invalid mesh table: {error}")))?;
        let material_table: Vec<String> = serde_json::from_str(material_table_json)
            .map_err(|error| JsError::new(&format!("invalid material table: {error}")))?;
        self.inner
            .set_render_frame(RenderFrame {
                mesh_table: &mesh_table,
                mesh_indices,
                material_table: &material_table,
                material_indices,
                matrices,
                base_colors,
                material_params,
                camera,
                light,
                environment,
            })
            .map_err(|error| JsError::new(&error.to_string()))
    }

    /// Submits several camera layers in one surface acquire/present cycle.
    /// Instance arrays are concatenated in layer order and remain typed arrays
    /// across the JS/WASM boundary; only the two small identifier tables use
    /// JSON. This supports view models, editor overlays, minimaps, and portals
    /// without forcing games to own renderer internals.
    #[allow(clippy::too_many_arguments)]
    pub fn set_render_layers(
        &mut self,
        mesh_table_json: &str,
        mesh_indices: &[u32],
        material_table_json: &str,
        material_indices: &[u32],
        matrices: &[f32],
        base_colors: &[f32],
        material_params: &[f32],
        layer_instance_counts: &[u32],
        layer_flags: &[u32],
        cameras: &[f32],
        lights: &[f32],
        layer_light_counts: &[u32],
        environments: &[f32],
    ) -> Result<(), JsError> {
        let mesh_table: Vec<String> = serde_json::from_str(mesh_table_json)
            .map_err(|error| JsError::new(&format!("invalid mesh table: {error}")))?;
        let material_table: Vec<String> = serde_json::from_str(material_table_json)
            .map_err(|error| JsError::new(&format!("invalid material table: {error}")))?;
        self.inner
            .set_render_layers(RenderLayers {
                mesh_table: &mesh_table,
                mesh_indices,
                material_table: &material_table,
                material_indices,
                matrices,
                base_colors,
                material_params,
                layer_instance_counts,
                layer_flags,
                cameras,
                lights,
                layer_light_counts,
                environments,
            })
            .map_err(|error| JsError::new(&error.to_string()))
    }

    /// Uploads or replaces a runtime mesh.
    ///
    /// Geometry crosses as typed arrays rather than JSON: a meshed voxel chunk
    /// is hundreds of kilobytes of floats, and serializing that per edit would
    /// dominate the frame. `normals`, `uvs`, and `colors` may be empty, in
    /// which case defaults are generated.
    ///
    /// Replacing an existing identifier keeps its slot, so instances already
    /// referencing the mesh show the new geometry on the next frame.
    pub fn upload_mesh(
        &mut self,
        id: &str,
        positions: &[f32],
        normals: &[f32],
        uvs: &[f32],
        colors: &[f32],
        tangents: &[f32],
        texture_layers: &[f32],
        indices: &[u32],
    ) -> Result<(), JsError> {
        let data = build_mesh_with_attributes(
            positions,
            normals,
            uvs,
            colors,
            tangents,
            texture_layers,
            indices,
        )
        .map_err(|error| JsError::new(&format!("mesh '{id}' was rejected: {error}")))?;
        self.inner
            .upload_mesh(id, &data)
            .map_err(|error| JsError::new(&error.to_string()))
    }

    /// Frees a runtime mesh. Returns whether it existed.
    pub fn release_mesh(&mut self, id: &str) -> Result<bool, JsError> {
        self.inner
            .release_mesh(id)
            .map_err(|error| JsError::new(&error.to_string()))
    }

    /// Identifiers currently uploaded, for diagnostics and tests.
    pub fn mesh_ids_json(&self) -> Result<String, JsError> {
        serde_json::to_string(&self.inner.mesh_ids())
            .map_err(|error| JsError::new(&format!("failed to serialize mesh ids: {error}")))
    }

    /// Uploads or replaces an uncompressed RGBA8 texture. Import processing
    /// happens outside the frame loop; this typed-array baseline also serves
    /// procedural atlases and migration adapters without base64 or JSON.
    pub fn upload_texture_rgba8(
        &mut self,
        id: &str,
        width: u32,
        height: u32,
        pixels: &[u8],
        srgb: bool,
        mipmaps: bool,
    ) -> Result<(), JsError> {
        self.inner
            .upload_texture_rgba8_with_mipmaps(id, width, height, pixels, srgb, mipmaps)
            .map_err(|error| JsError::new(&error.to_string()))
    }

    pub fn release_texture(&mut self, id: &str) -> Result<bool, JsError> {
        self.inner
            .release_texture(id)
            .map_err(|error| JsError::new(&error.to_string()))
    }

    pub fn define_material_json(&mut self, id: &str, json: &str) -> Result<(), JsError> {
        let descriptor: StandardMaterialDescriptor = serde_json::from_str(json)
            .map_err(|error| JsError::new(&format!("invalid material '{id}': {error}")))?;
        self.inner
            .define_material(id, &descriptor)
            .map_err(|error| JsError::new(&error.to_string()))
    }

    pub fn release_material(&mut self, id: &str) -> Result<bool, JsError> {
        self.inner
            .release_material(id)
            .map_err(|error| JsError::new(&error.to_string()))
    }

    pub fn capabilities_json(&self) -> Result<String, JsError> {
        serde_json::to_string(&self.inner.context.capabilities).map_err(|error| {
            JsError::new(&format!("failed to serialize GPU capabilities: {error}"))
        })
    }
}

impl Engine {
    fn apply(&mut self, command: RuntimeCommand) -> Result<(), JsError> {
        match command {
            RuntimeCommand::Spawn { id, transform } => {
                if self.stable_to_runtime.contains_key(&id) {
                    return Err(JsError::new(&format!("entity {id} already exists")));
                }
                let entity = self.world.spawn();
                self.transforms.insert(entity, transform.into());
                self.stable_to_runtime.insert(id, entity);
                self.runtime_to_stable.insert(entity, id);
            }
            RuntimeCommand::Despawn { id } => {
                let entity = self.entity(id)?;
                self.detach_children(entity)?;
                self.transforms.remove(entity);
                self.world
                    .despawn(entity)
                    .map_err(|error| JsError::new(&error.to_string()))?;
                self.stable_to_runtime.remove(&id);
                self.runtime_to_stable.remove(&entity);
            }
            RuntimeCommand::SetTransform { id, transform } => {
                let entity = self.entity(id)?;
                self.transforms
                    .set_local(entity, transform.into())
                    .map_err(|error| JsError::new(&error.to_string()))?;
            }
            RuntimeCommand::SetParent { id, parent } => {
                let child = self.entity(id)?;
                let parent = parent.map(|id| self.entity(id)).transpose()?;
                self.transforms
                    .set_parent(child, parent)
                    .map_err(|error| JsError::new(&error.to_string()))?;
            }
        }
        Ok(())
    }

    fn entity(&self, id: Uuid) -> Result<Entity, JsError> {
        self.stable_to_runtime
            .get(&id)
            .copied()
            .ok_or_else(|| JsError::new(&format!("entity {id} does not exist")))
    }

    fn detach_children(&mut self, parent: Entity) -> Result<(), JsError> {
        let children: Vec<_> = self
            .runtime_to_stable
            .keys()
            .copied()
            .filter(|entity| self.transforms.parent(*entity) == Some(parent))
            .collect();
        for child in children {
            self.transforms
                .set_parent(child, None)
                .map_err(|error| JsError::new(&error.to_string()))?;
        }
        Ok(())
    }
}
