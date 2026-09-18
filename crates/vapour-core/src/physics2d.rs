use std::{
    collections::HashMap,
    sync::mpsc::{Receiver, Sender, channel},
};

use rapier2d::prelude::*;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{CombineRule, PhysicsEventKind, PhysicsMaterial};

impl From<CombineRule> for CoefficientCombineRule {
    fn from(value: CombineRule) -> Self {
        match value {
            CombineRule::Average => Self::Average,
            CombineRule::Min => Self::Min,
            CombineRule::Max => Self::Max,
            CombineRule::Multiply => Self::Multiply,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BodyType2d {
    Static,
    Dynamic,
    KinematicPosition,
    KinematicVelocity,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ColliderShape2d {
    Rectangle { half_extents: [f32; 2] },
    Circle { radius: f32 },
    Capsule { half_height: f32, radius: f32 },
    ConvexPolygon { points: Vec<[f32; 2]> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicsBodyDescriptor2d {
    pub id: u64,
    pub body_type: BodyType2d,
    pub position: [f32; 2],
    pub rotation: f32,
    pub linear_velocity: [f32; 2],
    pub angular_velocity: f32,
    pub gravity_scale: f32,
    pub linear_damping: f32,
    pub angular_damping: f32,
    pub continuous_collision_detection: bool,
    pub shape: ColliderShape2d,
    pub density: f32,
    pub friction: f32,
    pub restitution: f32,
    pub sensor: bool,
    pub layer: u32,
    pub mask: u32,
    /// A material registered with [`PhysicsWorld2d::define_material`]. It
    /// replaces `friction` and `restitution` and supplies the combine rules.
    #[serde(default)]
    pub material: Option<String>,
    #[serde(default)]
    pub friction_combine: CombineRule,
    #[serde(default)]
    pub restitution_combine: CombineRule,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicsBodySnapshot2d {
    pub id: u64,
    pub position: [f32; 2],
    pub rotation: f32,
    pub linear_velocity: [f32; 2],
    pub angular_velocity: f32,
    pub sleeping: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicsEvent2d {
    pub kind: PhysicsEventKind,
    pub body_a: u64,
    pub body_b: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaycastHit2d {
    pub body_id: u64,
    pub distance: f32,
    pub point: [f32; 2],
    pub normal: [f32; 2],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeCastHit2d {
    pub body_id: u64,
    pub distance: f32,
    pub position: [f32; 2],
    pub normal: [f32; 2],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterControllerDescriptor2d {
    pub shape: ColliderShape2d,
    pub offset: f32,
    pub slide: bool,
    pub autostep_max_height: Option<f32>,
    pub autostep_min_width: f32,
    pub autostep_dynamic_bodies: bool,
    pub max_slope_climb_degrees: f32,
    pub min_slope_slide_degrees: f32,
    pub snap_to_ground: Option<f32>,
    pub layer: u32,
    pub mask: u32,
    pub include_sensors: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterMovement2d {
    pub translation: [f32; 2],
    pub grounded: bool,
    pub sliding_down_slope: bool,
    pub collisions: Vec<u64>,
}

#[derive(Debug, Error, PartialEq)]
pub enum PhysicsError2d {
    #[error("physics body ID must be non-zero")]
    ZeroId,
    #[error("physics body '{0}' already exists")]
    DuplicateBody(u64),
    #[error("unknown physics body '{0}'")]
    UnknownBody(u64),
    #[error("{0} must contain only finite values")]
    NonFinite(&'static str),
    #[error("{0} must be finite and non-negative")]
    NonNegative(&'static str),
    #[error("{0} must be finite and positive")]
    Positive(&'static str),
    #[error("physics collision layer must contain at least one bit")]
    EmptyLayer,
    #[error("physics timestep must be finite and positive")]
    InvalidTimestep,
    #[error("ray direction cannot have zero length")]
    ZeroRayDirection,
    #[error("convex polygon needs at least three finite, non-collinear points")]
    InvalidPolygon,
    #[error("physics material name cannot be empty")]
    EmptyMaterialName,
    #[error("unknown physics material '{0}'")]
    UnknownMaterial(String),
}

/// Rust-owned 2D rigid-body world. Stable IDs, rather than Rapier arena
/// handles, form the serialized and scripting-facing API.
pub struct PhysicsWorld2d {
    inner: PhysicsWorld,
    bodies: HashMap<u64, (RigidBodyHandle, ColliderHandle)>,
    collider_ids: HashMap<ColliderHandle, u64>,
    materials: HashMap<String, PhysicsMaterial>,
    collision_send: Sender<CollisionEvent>,
    collision_recv: Receiver<CollisionEvent>,
    force_send: Sender<ContactForceEvent>,
    force_recv: Receiver<ContactForceEvent>,
}

impl Default for PhysicsWorld2d {
    fn default() -> Self {
        Self::new([0.0, -9.81])
    }
}

impl PhysicsWorld2d {
    #[must_use]
    pub fn new(gravity: [f32; 2]) -> Self {
        let (collision_send, collision_recv) = channel();
        let (force_send, force_recv) = channel();
        let mut inner = PhysicsWorld::new();
        inner.gravity = Vector::from(gravity);
        Self {
            inner,
            bodies: HashMap::new(),
            collider_ids: HashMap::new(),
            materials: HashMap::new(),
            collision_send,
            collision_recv,
            force_send,
            force_recv,
        }
    }

    pub fn set_gravity(&mut self, gravity: [f32; 2]) -> Result<(), PhysicsError2d> {
        finite2(gravity, "physics gravity")?;
        self.inner.gravity = Vector::from(gravity);
        Ok(())
    }

    #[must_use]
    pub fn body_count(&self) -> usize {
        self.bodies.len()
    }

    /// Registers a named surface, replacing any material of the same name.
    /// See [`crate::PhysicsWorld3d::define_material`] for the semantics.
    pub fn define_material(&mut self, material: PhysicsMaterial) -> Result<(), PhysicsError2d> {
        if material.name.trim().is_empty() {
            return Err(PhysicsError2d::EmptyMaterialName);
        }
        non_negative(material.friction, "material friction")?;
        non_negative(material.restitution, "material restitution")?;
        self.materials.insert(material.name.clone(), material);
        Ok(())
    }

    #[must_use]
    pub fn material(&self, name: &str) -> Option<&PhysicsMaterial> {
        self.materials.get(name)
    }

    #[must_use]
    pub fn material_count(&self) -> usize {
        self.materials.len()
    }

    /// Re-surfaces an existing collider and wakes its body.
    pub fn set_material(&mut self, id: u64, name: &str) -> Result<(), PhysicsError2d> {
        let material = self
            .materials
            .get(name)
            .ok_or_else(|| PhysicsError2d::UnknownMaterial(name.to_owned()))?
            .clone();
        let (body, handle) = *self
            .bodies
            .get(&id)
            .ok_or(PhysicsError2d::UnknownBody(id))?;
        let collider = self
            .inner
            .colliders
            .get_mut(handle)
            .ok_or(PhysicsError2d::UnknownBody(id))?;
        collider.set_friction(material.friction);
        collider.set_restitution(material.restitution);
        collider.set_friction_combine_rule(material.friction_combine.into());
        collider.set_restitution_combine_rule(material.restitution_combine.into());
        if let Some(body) = self.inner.bodies.get_mut(body) {
            body.wake_up(true);
        }
        Ok(())
    }

    pub fn insert(&mut self, descriptor: PhysicsBodyDescriptor2d) -> Result<(), PhysicsError2d> {
        validate_descriptor(&descriptor)?;
        if self.bodies.contains_key(&descriptor.id) {
            return Err(PhysicsError2d::DuplicateBody(descriptor.id));
        }
        let surface = match &descriptor.material {
            Some(name) => self
                .materials
                .get(name)
                .ok_or_else(|| PhysicsError2d::UnknownMaterial(name.clone()))?
                .clone(),
            None => PhysicsMaterial {
                name: String::new(),
                friction: descriptor.friction,
                restitution: descriptor.restitution,
                friction_combine: descriptor.friction_combine,
                restitution_combine: descriptor.restitution_combine,
            },
        };
        let mut body = match descriptor.body_type {
            BodyType2d::Static => RigidBodyBuilder::fixed(),
            BodyType2d::Dynamic => RigidBodyBuilder::dynamic(),
            BodyType2d::KinematicPosition => RigidBodyBuilder::kinematic_position_based(),
            BodyType2d::KinematicVelocity => RigidBodyBuilder::kinematic_velocity_based(),
        };
        body = body
            .translation(descriptor.position.into())
            .rotation(descriptor.rotation)
            .linvel(descriptor.linear_velocity.into())
            .angvel(descriptor.angular_velocity)
            .gravity_scale(descriptor.gravity_scale)
            .linear_damping(descriptor.linear_damping)
            .angular_damping(descriptor.angular_damping)
            .ccd_enabled(descriptor.continuous_collision_detection)
            .user_data(u128::from(descriptor.id));
        let groups = InteractionGroups::new(
            Group::from_bits_truncate(descriptor.layer),
            Group::from_bits_truncate(descriptor.mask),
            InteractionTestMode::And,
        );
        let collider = collider_builder(&descriptor.shape)?
            .density(descriptor.density)
            .friction(surface.friction)
            .restitution(surface.restitution)
            .friction_combine_rule(surface.friction_combine.into())
            .restitution_combine_rule(surface.restitution_combine.into())
            .sensor(descriptor.sensor)
            .collision_groups(groups)
            .active_events(ActiveEvents::COLLISION_EVENTS)
            .user_data(u128::from(descriptor.id));
        let (body_handle, collider_handle) = self.inner.insert(body, collider);
        self.bodies
            .insert(descriptor.id, (body_handle, collider_handle));
        self.collider_ids.insert(collider_handle, descriptor.id);
        Ok(())
    }

    pub fn remove(&mut self, id: u64) -> Result<(), PhysicsError2d> {
        let (body, collider) = self
            .bodies
            .remove(&id)
            .ok_or(PhysicsError2d::UnknownBody(id))?;
        self.collider_ids.remove(&collider);
        self.inner.remove_body(body);
        Ok(())
    }

    pub fn add_force(&mut self, id: u64, force: [f32; 2]) -> Result<(), PhysicsError2d> {
        finite2(force, "physics force")?;
        self.body_mut(id)?.add_force(force.into(), true);
        Ok(())
    }
    pub fn add_force_at_point(
        &mut self,
        id: u64,
        force: [f32; 2],
        point: [f32; 2],
    ) -> Result<(), PhysicsError2d> {
        finite2(force, "physics force")?;
        finite2(point, "physics force point")?;
        self.body_mut(id)?
            .add_force_at_point(force.into(), point.into(), true);
        Ok(())
    }
    pub fn add_torque(&mut self, id: u64, torque: f32) -> Result<(), PhysicsError2d> {
        finite(torque, "physics torque")?;
        self.body_mut(id)?.add_torque(torque, true);
        Ok(())
    }

    pub fn apply_impulse(&mut self, id: u64, impulse: [f32; 2]) -> Result<(), PhysicsError2d> {
        finite2(impulse, "physics impulse")?;
        self.body_mut(id)?.apply_impulse(impulse.into(), true);
        Ok(())
    }
    pub fn apply_torque_impulse(&mut self, id: u64, torque: f32) -> Result<(), PhysicsError2d> {
        finite(torque, "physics torque impulse")?;
        self.body_mut(id)?.apply_torque_impulse(torque, true);
        Ok(())
    }

    pub fn set_linear_velocity(
        &mut self,
        id: u64,
        velocity: [f32; 2],
    ) -> Result<(), PhysicsError2d> {
        finite2(velocity, "physics linear velocity")?;
        self.body_mut(id)?.set_linvel(velocity.into(), true);
        Ok(())
    }
    pub fn set_angular_velocity(&mut self, id: u64, velocity: f32) -> Result<(), PhysicsError2d> {
        finite(velocity, "physics angular velocity")?;
        self.body_mut(id)?.set_angvel(velocity, true);
        Ok(())
    }

    pub fn set_kinematic_target(
        &mut self,
        id: u64,
        position: [f32; 2],
        rotation: f32,
    ) -> Result<(), PhysicsError2d> {
        finite2(position, "kinematic target position")?;
        finite(rotation, "kinematic target rotation")?;
        self.body_mut(id)?.set_next_kinematic_position(
            rapier2d::na::Isometry2::new(position.into(), rotation).into(),
        );
        Ok(())
    }

    pub fn step(&mut self, timestep: f32) -> Result<Vec<PhysicsEvent2d>, PhysicsError2d> {
        if !timestep.is_finite() || timestep <= 0.0 {
            return Err(PhysicsError2d::InvalidTimestep);
        }
        self.inner.integration_parameters.dt = timestep;
        let collector =
            ChannelEventCollector::new(self.collision_send.clone(), self.force_send.clone());
        self.inner.step_with_events(&(), &collector);
        while self.force_recv.try_recv().is_ok() {}
        let mut events = Vec::new();
        while let Ok(event) = self.collision_recv.try_recv() {
            let Some(&a) = self.collider_ids.get(&event.collider1()) else {
                continue;
            };
            let Some(&b) = self.collider_ids.get(&event.collider2()) else {
                continue;
            };
            let (body_a, body_b) = if a <= b { (a, b) } else { (b, a) };
            let kind = match (event.started(), event.sensor()) {
                (true, true) => PhysicsEventKind::TriggerEnter,
                (false, true) => PhysicsEventKind::TriggerExit,
                (true, false) => PhysicsEventKind::CollisionEnter,
                (false, false) => PhysicsEventKind::CollisionExit,
            };
            events.push(PhysicsEvent2d {
                kind,
                body_a,
                body_b,
            });
        }
        events.sort_by_key(|event| (event.body_a, event.body_b, event_order(event.kind)));
        Ok(events)
    }

    #[must_use]
    pub fn snapshots(&self) -> Vec<PhysicsBodySnapshot2d> {
        let mut values: Vec<_> = self
            .bodies
            .iter()
            .filter_map(|(&id, &(handle, _))| {
                self.inner
                    .bodies
                    .get(handle)
                    .map(|body| PhysicsBodySnapshot2d {
                        id,
                        position: body.translation().into(),
                        rotation: body.rotation().angle(),
                        linear_velocity: body.linvel().into(),
                        angular_velocity: body.angvel(),
                        sleeping: body.is_sleeping(),
                    })
            })
            .collect();
        values.sort_by_key(|body| body.id);
        values
    }

    pub fn raycast(
        &self,
        origin: [f32; 2],
        direction: [f32; 2],
        max_distance: f32,
        layer: u32,
        mask: u32,
        include_sensors: bool,
    ) -> Result<Option<RaycastHit2d>, PhysicsError2d> {
        finite2(origin, "ray origin")?;
        finite2(direction, "ray direction")?;
        positive(max_distance, "ray maximum distance")?;
        let mut direction = Vector::from(direction);
        let length = direction.length();
        if length <= f32::EPSILON {
            return Err(PhysicsError2d::ZeroRayDirection);
        }
        direction /= length;
        let groups = InteractionGroups::new(
            Group::from_bits_truncate(layer),
            Group::from_bits_truncate(mask),
            InteractionTestMode::And,
        );
        let mut filter = QueryFilter::default().groups(groups);
        if !include_sensors {
            filter = filter.exclude_sensors();
        }
        let ray = Ray::new(origin.into(), direction);
        Ok(self
            .inner
            .cast_ray_and_get_normal(&ray, max_distance, true, filter)
            .and_then(|(handle, hit)| {
                self.collider_ids.get(&handle).map(|&body_id| RaycastHit2d {
                    body_id,
                    distance: hit.time_of_impact,
                    point: ray.point_at(hit.time_of_impact).into(),
                    normal: hit.normal.into(),
                })
            }))
    }

    pub fn overlap_shape(
        &self,
        position: [f32; 2],
        rotation: f32,
        shape: &ColliderShape2d,
        layer: u32,
        mask: u32,
        include_sensors: bool,
    ) -> Result<Vec<u64>, PhysicsError2d> {
        finite2(position, "overlap position")?;
        finite(rotation, "overlap rotation")?;
        let pose: Pose = rapier2d::na::Isometry2::new(position.into(), rotation).into();
        let collider = collider_builder(shape)?.build();
        let mut filter = query_filter(layer, mask);
        if !include_sensors {
            filter = filter.exclude_sensors();
        }
        let mut ids: Vec<_> = self
            .inner
            .intersect_shape(pose, collider.shape(), filter)
            .filter_map(|(handle, _)| self.collider_ids.get(&handle).copied())
            .collect();
        ids.sort_unstable();
        ids.dedup();
        Ok(ids)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn cast_shape(
        &self,
        position: [f32; 2],
        rotation: f32,
        direction: [f32; 2],
        max_distance: f32,
        shape: &ColliderShape2d,
        layer: u32,
        mask: u32,
        include_sensors: bool,
    ) -> Result<Option<ShapeCastHit2d>, PhysicsError2d> {
        finite2(position, "shape-cast position")?;
        finite(rotation, "shape-cast rotation")?;
        finite2(direction, "shape-cast direction")?;
        positive(max_distance, "shape-cast maximum distance")?;
        let mut direction = Vector::from(direction);
        let length = direction.length();
        if length <= f32::EPSILON {
            return Err(PhysicsError2d::ZeroRayDirection);
        }
        direction /= length;
        let pose: Pose = rapier2d::na::Isometry2::new(position.into(), rotation).into();
        let collider = collider_builder(shape)?.build();
        let mut filter = query_filter(layer, mask);
        if !include_sensors {
            filter = filter.exclude_sensors();
        }
        let options = rapier2d::parry::query::ShapeCastOptions::with_max_time_of_impact(1.0);
        Ok(self
            .inner
            .cast_shape(
                &pose,
                direction * max_distance,
                collider.shape(),
                options,
                filter,
            )
            .and_then(|(handle, hit)| {
                self.collider_ids.get(&handle).map(|&body_id| {
                    let distance = hit.time_of_impact * max_distance;
                    let normal = self
                        .inner
                        .colliders
                        .get(handle)
                        .map_or(-hit.normal2, |collider| collider.rotation() * -hit.normal2);
                    ShapeCastHit2d {
                        body_id,
                        distance,
                        position: (Vector::from(position) + direction * distance).into(),
                        normal: normal.into(),
                    }
                })
            }))
    }

    pub fn move_character(
        &self,
        timestep: f32,
        position: [f32; 2],
        rotation: f32,
        desired_translation: [f32; 2],
        descriptor: &CharacterControllerDescriptor2d,
    ) -> Result<CharacterMovement2d, PhysicsError2d> {
        if !timestep.is_finite() || timestep <= 0.0 {
            return Err(PhysicsError2d::InvalidTimestep);
        }
        finite2(position, "character position")?;
        finite(rotation, "character rotation")?;
        finite2(desired_translation, "character desired translation")?;
        positive(descriptor.offset, "character offset")?;
        positive(
            descriptor.autostep_min_width,
            "character autostep minimum width",
        )?;
        if let Some(value) = descriptor.autostep_max_height {
            positive(value, "character autostep maximum height")?;
        }
        if let Some(value) = descriptor.snap_to_ground {
            non_negative(value, "character ground snap distance")?;
        }
        slope(
            descriptor.max_slope_climb_degrees,
            "character maximum slope climb",
        )?;
        slope(
            descriptor.min_slope_slide_degrees,
            "character minimum slope slide",
        )?;
        let collider = collider_builder(&descriptor.shape)?.build();
        let pose: Pose = rapier2d::na::Isometry2::new(position.into(), rotation).into();
        let mut filter = query_filter(descriptor.layer, descriptor.mask);
        if !descriptor.include_sensors {
            filter = filter.exclude_sensors();
        }
        let pipeline = self.inner.query_pipeline_with_filter(filter);
        let controller = rapier2d::control::KinematicCharacterController {
            offset: rapier2d::control::CharacterLength::Absolute(descriptor.offset),
            slide: descriptor.slide,
            autostep: descriptor.autostep_max_height.map(|height| {
                rapier2d::control::CharacterAutostep {
                    max_height: rapier2d::control::CharacterLength::Absolute(height),
                    min_width: rapier2d::control::CharacterLength::Absolute(
                        descriptor.autostep_min_width,
                    ),
                    include_dynamic_bodies: descriptor.autostep_dynamic_bodies,
                }
            }),
            max_slope_climb_angle: descriptor.max_slope_climb_degrees.to_radians(),
            min_slope_slide_angle: descriptor.min_slope_slide_degrees.to_radians(),
            snap_to_ground: descriptor
                .snap_to_ground
                .map(rapier2d::control::CharacterLength::Absolute),
            ..Default::default()
        };
        let mut collisions = Vec::new();
        let movement = controller.move_shape(
            timestep,
            &pipeline,
            collider.shape(),
            &pose,
            desired_translation.into(),
            |collision| {
                if let Some(id) = self.collider_ids.get(&collision.handle) {
                    collisions.push(*id);
                }
            },
        );
        collisions.sort_unstable();
        collisions.dedup();
        Ok(CharacterMovement2d {
            translation: movement.translation.into(),
            grounded: movement.grounded,
            sliding_down_slope: movement.is_sliding_down_slope,
            collisions,
        })
    }

    fn body_mut(&mut self, id: u64) -> Result<&mut RigidBody, PhysicsError2d> {
        let handle = self
            .bodies
            .get(&id)
            .map(|entry| entry.0)
            .ok_or(PhysicsError2d::UnknownBody(id))?;
        self.inner
            .bodies
            .get_mut(handle)
            .ok_or(PhysicsError2d::UnknownBody(id))
    }
}

fn query_filter(layer: u32, mask: u32) -> QueryFilter<'static> {
    QueryFilter::default().groups(InteractionGroups::new(
        Group::from_bits_truncate(layer),
        Group::from_bits_truncate(mask),
        InteractionTestMode::And,
    ))
}

fn collider_builder(shape: &ColliderShape2d) -> Result<ColliderBuilder, PhysicsError2d> {
    Ok(match shape {
        ColliderShape2d::Rectangle { half_extents } => {
            finite2(*half_extents, "rectangle half extents")?;
            if half_extents.iter().any(|value| *value <= 0.0) {
                return Err(PhysicsError2d::Positive("rectangle half extents"));
            }
            ColliderBuilder::cuboid(half_extents[0], half_extents[1])
        }
        ColliderShape2d::Circle { radius } => {
            positive(*radius, "circle radius")?;
            ColliderBuilder::ball(*radius)
        }
        ColliderShape2d::Capsule {
            half_height,
            radius,
        } => {
            positive(*half_height, "capsule half height")?;
            positive(*radius, "capsule radius")?;
            ColliderBuilder::capsule_y(*half_height, *radius)
        }
        ColliderShape2d::ConvexPolygon { points } => {
            if points.len() < 3
                || points
                    .iter()
                    .any(|point| finite2(*point, "convex polygon point").is_err())
            {
                return Err(PhysicsError2d::InvalidPolygon);
            }
            ColliderBuilder::convex_hull(
                &points.iter().copied().map(Vector::from).collect::<Vec<_>>(),
            )
            .ok_or(PhysicsError2d::InvalidPolygon)?
        }
    })
}

fn validate_descriptor(value: &PhysicsBodyDescriptor2d) -> Result<(), PhysicsError2d> {
    if value.id == 0 {
        return Err(PhysicsError2d::ZeroId);
    }
    finite2(value.position, "physics body position")?;
    finite(value.rotation, "physics body rotation")?;
    finite2(value.linear_velocity, "physics linear velocity")?;
    finite(value.angular_velocity, "physics angular velocity")?;
    non_negative(value.gravity_scale, "gravity scale")?;
    non_negative(value.linear_damping, "linear damping")?;
    non_negative(value.angular_damping, "angular damping")?;
    positive(value.density, "collider density")?;
    non_negative(value.friction, "collider friction")?;
    non_negative(value.restitution, "collider restitution")?;
    if value.layer == 0 {
        return Err(PhysicsError2d::EmptyLayer);
    }
    let _ = collider_builder(&value.shape)?;
    Ok(())
}

fn finite2(value: [f32; 2], label: &'static str) -> Result<(), PhysicsError2d> {
    if value.iter().all(|value| value.is_finite()) {
        Ok(())
    } else {
        Err(PhysicsError2d::NonFinite(label))
    }
}
fn finite(value: f32, label: &'static str) -> Result<(), PhysicsError2d> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(PhysicsError2d::NonFinite(label))
    }
}
fn positive(value: f32, label: &'static str) -> Result<(), PhysicsError2d> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(PhysicsError2d::Positive(label))
    }
}
fn non_negative(value: f32, label: &'static str) -> Result<(), PhysicsError2d> {
    if value.is_finite() && value >= 0.0 {
        Ok(())
    } else {
        Err(PhysicsError2d::NonNegative(label))
    }
}
fn slope(value: f32, label: &'static str) -> Result<(), PhysicsError2d> {
    if value.is_finite() && (0.0..=90.0).contains(&value) {
        Ok(())
    } else {
        Err(PhysicsError2d::NonNegative(label))
    }
}
const fn event_order(kind: PhysicsEventKind) -> u8 {
    match kind {
        PhysicsEventKind::CollisionEnter => 0,
        PhysicsEventKind::CollisionExit => 1,
        PhysicsEventKind::TriggerEnter => 2,
        PhysicsEventKind::TriggerExit => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(
        id: u64,
        body_type: BodyType2d,
        y: f32,
        shape: ColliderShape2d,
    ) -> PhysicsBodyDescriptor2d {
        PhysicsBodyDescriptor2d {
            id,
            body_type,
            position: [0.0, y],
            rotation: 0.0,
            linear_velocity: [0.0; 2],
            angular_velocity: 0.0,
            gravity_scale: 1.0,
            linear_damping: 0.0,
            angular_damping: 0.0,
            continuous_collision_detection: true,
            shape,
            density: 1.0,
            friction: 0.7,
            restitution: 0.0,
            sensor: false,
            layer: 1,
            mask: u32::MAX,
            material: None,
            friction_combine: CombineRule::Average,
            restitution_combine: CombineRule::Average,
        }
    }

    #[test]
    fn material_resurfaces_a_collider() {
        let mut world = PhysicsWorld2d::default();
        world
            .define_material(PhysicsMaterial {
                name: "ice".into(),
                friction: 0.02,
                restitution: 0.1,
                friction_combine: CombineRule::Min,
                restitution_combine: CombineRule::Max,
            })
            .unwrap();
        assert_eq!(
            world.define_material(PhysicsMaterial {
                name: "  ".into(),
                friction: 0.0,
                restitution: 0.0,
                friction_combine: CombineRule::Average,
                restitution_combine: CombineRule::Average,
            }),
            Err(PhysicsError2d::EmptyMaterialName)
        );
        let mut descriptor = body(
            1,
            BodyType2d::Dynamic,
            1.0,
            ColliderShape2d::Circle { radius: 0.5 },
        );
        descriptor.material = Some("ice".into());
        world.insert(descriptor).unwrap();
        assert_eq!(world.material_count(), 1);
        assert_eq!(
            world.set_material(1, "mud"),
            Err(PhysicsError2d::UnknownMaterial("mud".into()))
        );
        let mut unknown = body(
            2,
            BodyType2d::Dynamic,
            1.0,
            ColliderShape2d::Circle { radius: 0.5 },
        );
        unknown.material = Some("mud".into());
        assert_eq!(
            world.insert(unknown),
            Err(PhysicsError2d::UnknownMaterial("mud".into()))
        );
        let (_, collider) = world.bodies[&1];
        let collider = world.inner.colliders.get(collider).unwrap();
        assert!((collider.friction() - 0.02).abs() < 1e-6);
        assert_eq!(
            collider.friction_combine_rule(),
            CoefficientCombineRule::Min
        );
        assert_eq!(
            collider.restitution_combine_rule(),
            CoefficientCombineRule::Max
        );
    }

    #[test]
    fn dynamic_circle_falls_and_collides() {
        let mut world = PhysicsWorld2d::default();
        world
            .insert(body(
                1,
                BodyType2d::Static,
                -0.5,
                ColliderShape2d::Rectangle {
                    half_extents: [5.0, 0.5],
                },
            ))
            .unwrap();
        world
            .insert(body(
                2,
                BodyType2d::Dynamic,
                2.0,
                ColliderShape2d::Circle { radius: 0.5 },
            ))
            .unwrap();
        let entered = (0..180).any(|_| {
            world
                .step(1.0 / 60.0)
                .unwrap()
                .iter()
                .any(|event| event.kind == PhysicsEventKind::CollisionEnter)
        });
        let circle = world
            .snapshots()
            .into_iter()
            .find(|body| body.id == 2)
            .unwrap();
        assert!(entered);
        assert!(
            (circle.position[1] - 0.5).abs() < 0.1,
            "circle at {}",
            circle.position[1]
        );
    }

    #[test]
    fn convex_polygon_raycast_uses_stable_id() {
        let mut world = PhysicsWorld2d::new([0.0, 0.0]);
        world
            .insert(body(
                17,
                BodyType2d::Static,
                0.0,
                ColliderShape2d::ConvexPolygon {
                    points: vec![[-1.0, -1.0], [1.0, -1.0], [0.0, 1.0]],
                },
            ))
            .unwrap();
        world.step(1.0 / 60.0).unwrap();
        let hit = world
            .raycast([0.0, 3.0], [0.0, -1.0], 10.0, 1, u32::MAX, false)
            .unwrap()
            .unwrap();
        assert_eq!(hit.body_id, 17);
        assert!((hit.distance - 2.0).abs() < 0.001);
    }

    #[test]
    fn overlap_and_shape_cast_return_stable_ids() {
        let mut world = PhysicsWorld2d::new([0.0, 0.0]);
        world
            .insert(body(
                8,
                BodyType2d::Static,
                0.0,
                ColliderShape2d::Circle { radius: 1.0 },
            ))
            .unwrap();
        world.step(1.0 / 60.0).unwrap();
        assert_eq!(
            world
                .overlap_shape(
                    [0.75, 0.0],
                    0.0,
                    &ColliderShape2d::Circle { radius: 0.5 },
                    1,
                    u32::MAX,
                    false
                )
                .unwrap(),
            vec![8]
        );
        let hit = world
            .cast_shape(
                [0.0, 4.0],
                0.0,
                [0.0, -1.0],
                10.0,
                &ColliderShape2d::Circle { radius: 0.5 },
                1,
                u32::MAX,
                false,
            )
            .unwrap()
            .unwrap();
        assert_eq!(hit.body_id, 8);
        assert!(
            (hit.distance - 2.5).abs() < 0.01,
            "distance {}",
            hit.distance
        );
        assert!(hit.normal[1] > 0.99, "normal {:?}", hit.normal);
    }

    #[test]
    fn character_controller_stops_on_ground_and_reports_collision() {
        let mut world = PhysicsWorld2d::new([0.0, 0.0]);
        world
            .insert(body(
                1,
                BodyType2d::Static,
                -0.5,
                ColliderShape2d::Rectangle {
                    half_extents: [5.0, 0.5],
                },
            ))
            .unwrap();
        world.step(1.0 / 60.0).unwrap();
        let movement = world
            .move_character(
                1.0 / 60.0,
                [0.0, 2.0],
                0.0,
                [0.0, -3.0],
                &CharacterControllerDescriptor2d {
                    shape: ColliderShape2d::Capsule {
                        half_height: 0.5,
                        radius: 0.5,
                    },
                    offset: 0.01,
                    slide: true,
                    autostep_max_height: Some(0.3),
                    autostep_min_width: 0.2,
                    autostep_dynamic_bodies: false,
                    max_slope_climb_degrees: 45.0,
                    min_slope_slide_degrees: 50.0,
                    snap_to_ground: Some(0.2),
                    layer: 1,
                    mask: u32::MAX,
                    include_sensors: false,
                },
            )
            .unwrap();
        assert!(
            movement.translation[1] > -1.1 && movement.translation[1] < -0.9,
            "translation {:?}",
            movement.translation
        );
        assert!(movement.grounded);
        assert_eq!(movement.collisions, vec![1]);
    }

    #[test]
    fn validates_polygon_and_stale_id() {
        let mut world = PhysicsWorld2d::default();
        let invalid = body(
            1,
            BodyType2d::Dynamic,
            0.0,
            ColliderShape2d::ConvexPolygon {
                points: vec![[0.0, 0.0], [1.0, 0.0]],
            },
        );
        assert_eq!(world.insert(invalid), Err(PhysicsError2d::InvalidPolygon));
        assert_eq!(
            world.apply_impulse(99, [1.0, 0.0]),
            Err(PhysicsError2d::UnknownBody(99))
        );
    }
    #[test]
    fn force_at_point_and_torque_drive_angular_velocity() {
        let mut world = PhysicsWorld2d::new([0.0, 0.0]);
        world
            .insert(body(
                4,
                BodyType2d::Dynamic,
                0.0,
                ColliderShape2d::Rectangle {
                    half_extents: [0.5; 2],
                },
            ))
            .unwrap();
        world
            .add_force_at_point(4, [10.0, 0.0], [0.0, 1.0])
            .unwrap();
        world.add_torque(4, 2.0).unwrap();
        world.apply_torque_impulse(4, 1.0).unwrap();
        world.step(1.0 / 60.0).unwrap();
        assert!(world.snapshots()[0].angular_velocity.abs() > 0.01);
        world.set_angular_velocity(4, 3.0).unwrap();
        assert_eq!(world.snapshots()[0].angular_velocity, 3.0);
    }
}
