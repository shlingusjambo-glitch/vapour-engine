use std::{
    collections::HashMap,
    sync::mpsc::{Receiver, Sender, channel},
};

use rapier3d::na::Unit;
use rapier3d::prelude::*;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BodyType3d {
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
pub enum ColliderShape3d {
    Box {
        half_extents: [f32; 3],
    },
    Sphere {
        radius: f32,
    },
    Capsule {
        half_height: f32,
        radius: f32,
    },
    Cylinder {
        half_height: f32,
        radius: f32,
    },
    /// Infinite plane through the body's origin, facing `normal`.
    Plane {
        normal: [f32; 3],
    },
    ConvexMesh {
        points: Vec<[f32; 3]>,
    },
    TriangleMesh {
        vertices: Vec<[f32; 3]>,
        indices: Vec<[u32; 3]>,
    },
    /// Regular X/Z grid. `rows * columns` heights are stored row-major.
    Heightfield {
        rows: u32,
        columns: u32,
        heights: Vec<f32>,
        scale: [f32; 3],
    },
    /// Several child shapes attached to one rigid body. Each transform is
    /// local to the body and compound shapes may be nested.
    Compound {
        children: Vec<CompoundColliderChild3d>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompoundColliderChild3d {
    pub position: [f32; 3],
    /// Local quaternion in browser-friendly `[x, y, z, w]` order.
    pub rotation: [f32; 4],
    pub shape: ColliderShape3d,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicsBodyDescriptor3d {
    pub id: u64,
    pub body_type: BodyType3d,
    pub position: [f32; 3],
    /// Quaternion in browser-friendly `[x, y, z, w]` order.
    pub rotation: [f32; 4],
    pub linear_velocity: [f32; 3],
    pub angular_velocity: [f32; 3],
    pub gravity_scale: f32,
    pub linear_damping: f32,
    pub angular_damping: f32,
    pub continuous_collision_detection: bool,
    pub shape: ColliderShape3d,
    pub density: f32,
    pub friction: f32,
    pub restitution: f32,
    pub sensor: bool,
    /// One or more of 32 collision-layer bits.
    pub layer: u32,
    /// Layers this collider accepts.
    pub mask: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicsBodySnapshot3d {
    pub id: u64,
    pub position: [f32; 3],
    pub rotation: [f32; 4],
    pub linear_velocity: [f32; 3],
    pub angular_velocity: [f32; 3],
    pub sleeping: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PhysicsEventKind {
    CollisionEnter,
    CollisionExit,
    TriggerEnter,
    TriggerExit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicsEvent3d {
    pub kind: PhysicsEventKind,
    pub body_a: u64,
    pub body_b: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaycastHit3d {
    pub body_id: u64,
    pub distance: f32,
    pub point: [f32; 3],
    pub normal: [f32; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeCastHit3d {
    pub body_id: u64,
    pub distance: f32,
    /// World-space position of the swept shape when impact occurs.
    pub position: [f32; 3],
    /// World-space normal pointing out of the hit collider.
    pub normal: [f32; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterControllerDescriptor3d {
    pub shape: ColliderShape3d,
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
pub struct CharacterMovement3d {
    pub translation: [f32; 3],
    pub grounded: bool,
    pub sliding_down_slope: bool,
    pub collisions: Vec<u64>,
}

/// A constraint between two bodies.
///
/// The set is deliberately small and named for what games build with them: a
/// hinge is a door and an elbow, a slider is a piston and a drawer, a ball is a
/// shoulder and a tow hitch, a spring is suspension and a rope bridge. Exposing
/// Rapier's full generic joint would be more expressive and much harder to use
/// correctly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum JointDescriptor3d {
    /// Welds two bodies rigidly. Used for breakable joins and compound props.
    Fixed {
        anchor_a: [f32; 3],
        anchor_b: [f32; 3],
    },
    /// One rotational degree of freedom about `axis`.
    Hinge {
        anchor_a: [f32; 3],
        anchor_b: [f32; 3],
        axis: [f32; 3],
        /// Angular limits in radians, as `[min, max]`.
        limits: Option<[f32; 2]>,
        /// Target angular velocity and maximum force, as `[velocity, force]`.
        motor: Option<[f32; 2]>,
    },
    /// One translational degree of freedom along `axis`.
    Slider {
        anchor_a: [f32; 3],
        anchor_b: [f32; 3],
        axis: [f32; 3],
        /// Travel limits along the axis, as `[min, max]`.
        limits: Option<[f32; 2]>,
        motor: Option<[f32; 2]>,
    },
    /// Three rotational degrees of freedom: a shoulder, a hip, a tow hitch.
    Ball {
        anchor_a: [f32; 3],
        anchor_b: [f32; 3],
    },
    /// A damped spring holding the anchors at `rest_length`.
    Spring {
        anchor_a: [f32; 3],
        anchor_b: [f32; 3],
        rest_length: f32,
        stiffness: f32,
        damping: f32,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointSpec3d {
    pub id: u64,
    pub body_a: u64,
    pub body_b: u64,
    pub joint: JointDescriptor3d,
    /// Whether the two connected bodies collide with each other. Off by
    /// default: a hinge whose halves collide jitters at the joint.
    #[serde(default)]
    pub collide_connected: bool,
}

#[derive(Debug, Error, PartialEq)]
pub enum PhysicsError3d {
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
    #[error("physics body rotation quaternion cannot have zero length")]
    ZeroQuaternion,
    #[error("physics collision layer must contain at least one bit")]
    EmptyLayer,
    #[error("physics timestep must be finite and positive")]
    InvalidTimestep,
    #[error("ray direction cannot have zero length")]
    ZeroRayDirection,
    #[error("invalid collider shape: {0}")]
    InvalidShape(String),
    #[error("physics joint '{0}' already exists")]
    DuplicateJoint(u64),
    #[error("unknown physics joint '{0}'")]
    UnknownJoint(u64),
    #[error("a joint cannot connect body '{0}' to itself")]
    SelfJoint(u64),
    #[error("joint axis cannot have zero length")]
    ZeroJointAxis,
    #[error("joint limits must be ordered as [min, max]")]
    InvalidJointLimits,
}

/// Rust-owned general 3D rigid-body world. Rapier handles never cross the
/// public boundary; stable IDs survive arena recycling and serialize cleanly.
pub struct PhysicsWorld3d {
    inner: PhysicsWorld,
    bodies: HashMap<u64, (RigidBodyHandle, ColliderHandle)>,
    collider_ids: HashMap<ColliderHandle, u64>,
    joints: HashMap<u64, ImpulseJointHandle>,
    collision_send: Sender<CollisionEvent>,
    collision_recv: Receiver<CollisionEvent>,
    force_send: Sender<ContactForceEvent>,
    force_recv: Receiver<ContactForceEvent>,
}

impl Default for PhysicsWorld3d {
    fn default() -> Self {
        Self::new([0.0, -9.81, 0.0])
    }
}

impl PhysicsWorld3d {
    #[must_use]
    pub fn new(gravity: [f32; 3]) -> Self {
        let (collision_send, collision_recv) = channel();
        let (force_send, force_recv) = channel();
        let mut inner = PhysicsWorld::new();
        inner.gravity = Vector::new(gravity[0], gravity[1], gravity[2]);
        Self {
            inner,
            bodies: HashMap::new(),
            collider_ids: HashMap::new(),
            joints: HashMap::new(),
            collision_send,
            collision_recv,
            force_send,
            force_recv,
        }
    }

    pub fn set_gravity(&mut self, gravity: [f32; 3]) -> Result<(), PhysicsError3d> {
        finite3(gravity, "physics gravity")?;
        self.inner.gravity = Vector::from(gravity);
        Ok(())
    }
    #[must_use]
    pub fn body_count(&self) -> usize {
        self.bodies.len()
    }

    pub fn insert(&mut self, descriptor: PhysicsBodyDescriptor3d) -> Result<(), PhysicsError3d> {
        validate_descriptor(&descriptor)?;
        if self.bodies.contains_key(&descriptor.id) {
            return Err(PhysicsError3d::DuplicateBody(descriptor.id));
        }
        let rotation = quaternion(descriptor.rotation)?;
        let position = Pose::from_parts(descriptor.position.into(), rotation);
        let mut body = match descriptor.body_type {
            BodyType3d::Static => RigidBodyBuilder::fixed(),
            BodyType3d::Dynamic => RigidBodyBuilder::dynamic(),
            BodyType3d::KinematicPosition => RigidBodyBuilder::kinematic_position_based(),
            BodyType3d::KinematicVelocity => RigidBodyBuilder::kinematic_velocity_based(),
        };
        body = body
            .pose(position)
            .linvel(descriptor.linear_velocity.into())
            .angvel(descriptor.angular_velocity.into())
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
            .friction(descriptor.friction)
            .restitution(descriptor.restitution)
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

    pub fn remove(&mut self, id: u64) -> Result<(), PhysicsError3d> {
        let (body, collider) = self
            .bodies
            .remove(&id)
            .ok_or(PhysicsError3d::UnknownBody(id))?;
        self.collider_ids.remove(&collider);
        // A joint referencing a removed body would dangle; Rapier drops the
        // constraint itself, so the id map is all that needs cleaning up.
        let orphaned: Vec<u64> = self
            .joints
            .iter()
            .filter(|(_, handle)| {
                self.inner
                    .impulse_joints
                    .get(**handle)
                    .is_none_or(|joint| joint.body1() == body || joint.body2() == body)
            })
            .map(|(id, _)| *id)
            .collect();
        for id in orphaned {
            self.joints.remove(&id);
        }
        self.inner.remove_body(body);
        Ok(())
    }

    pub fn add_force(&mut self, id: u64, force: [f32; 3]) -> Result<(), PhysicsError3d> {
        finite3(force, "physics force")?;
        self.body_mut(id)?.add_force(force.into(), true);
        Ok(())
    }
    pub fn add_force_at_point(
        &mut self,
        id: u64,
        force: [f32; 3],
        point: [f32; 3],
    ) -> Result<(), PhysicsError3d> {
        finite3(force, "physics force")?;
        finite3(point, "physics force point")?;
        self.body_mut(id)?
            .add_force_at_point(force.into(), point.into(), true);
        Ok(())
    }
    pub fn add_torque(&mut self, id: u64, torque: [f32; 3]) -> Result<(), PhysicsError3d> {
        finite3(torque, "physics torque")?;
        self.body_mut(id)?.add_torque(torque.into(), true);
        Ok(())
    }
    pub fn apply_impulse(&mut self, id: u64, impulse: [f32; 3]) -> Result<(), PhysicsError3d> {
        finite3(impulse, "physics impulse")?;
        self.body_mut(id)?.apply_impulse(impulse.into(), true);
        Ok(())
    }
    pub fn apply_torque_impulse(
        &mut self,
        id: u64,
        torque: [f32; 3],
    ) -> Result<(), PhysicsError3d> {
        finite3(torque, "physics torque impulse")?;
        self.body_mut(id)?.apply_torque_impulse(torque.into(), true);
        Ok(())
    }
    pub fn set_linear_velocity(
        &mut self,
        id: u64,
        velocity: [f32; 3],
    ) -> Result<(), PhysicsError3d> {
        finite3(velocity, "physics linear velocity")?;
        self.body_mut(id)?.set_linvel(velocity.into(), true);
        Ok(())
    }
    pub fn set_angular_velocity(
        &mut self,
        id: u64,
        velocity: [f32; 3],
    ) -> Result<(), PhysicsError3d> {
        finite3(velocity, "physics angular velocity")?;
        self.body_mut(id)?.set_angvel(velocity.into(), true);
        Ok(())
    }
    pub fn set_kinematic_target(
        &mut self,
        id: u64,
        position: [f32; 3],
        rotation: [f32; 4],
    ) -> Result<(), PhysicsError3d> {
        finite3(position, "kinematic target position")?;
        let pose = Pose::from_parts(position.into(), quaternion(rotation)?);
        self.body_mut(id)?.set_next_kinematic_position(pose);
        Ok(())
    }

    #[must_use]
    pub fn joint_count(&self) -> usize {
        self.joints.len()
    }

    /// Connects two bodies with a constraint.
    ///
    /// Anchors are given in each body's own local space, which is what makes a
    /// joint description independent of where the bodies happen to be when it
    /// is created — a door hinge is "the left edge of the door" regardless of
    /// which way the door is currently swinging.
    pub fn add_joint(&mut self, spec: JointSpec3d) -> Result<(), PhysicsError3d> {
        if spec.id == 0 {
            return Err(PhysicsError3d::ZeroId);
        }
        if self.joints.contains_key(&spec.id) {
            return Err(PhysicsError3d::DuplicateJoint(spec.id));
        }
        if spec.body_a == spec.body_b {
            return Err(PhysicsError3d::SelfJoint(spec.body_a));
        }
        let (handle_a, _) = *self
            .bodies
            .get(&spec.body_a)
            .ok_or(PhysicsError3d::UnknownBody(spec.body_a))?;
        let (handle_b, _) = *self
            .bodies
            .get(&spec.body_b)
            .ok_or(PhysicsError3d::UnknownBody(spec.body_b))?;

        let joint = build_joint(&spec.joint, spec.collide_connected)?;
        let handle = self
            .inner
            .impulse_joints
            .insert(handle_a, handle_b, joint, true);
        self.joints.insert(spec.id, handle);
        Ok(())
    }

    pub fn remove_joint(&mut self, id: u64) -> Result<(), PhysicsError3d> {
        let handle = self
            .joints
            .remove(&id)
            .ok_or(PhysicsError3d::UnknownJoint(id))?;
        // Waking the bodies matters: a sleeping body whose joint was removed
        // would otherwise stay frozen in place until something else disturbs it.
        self.inner.impulse_joints.remove(handle, true);
        Ok(())
    }

    /// Updates a motor's target velocity and maximum force.
    pub fn set_joint_motor(
        &mut self,
        id: u64,
        target_velocity: f32,
        max_force: f32,
    ) -> Result<(), PhysicsError3d> {
        if !target_velocity.is_finite() {
            return Err(PhysicsError3d::NonFinite("joint motor velocity"));
        }
        if !max_force.is_finite() || max_force < 0.0 {
            return Err(PhysicsError3d::NonNegative("joint motor force"));
        }
        let handle = *self
            .joints
            .get(&id)
            .ok_or(PhysicsError3d::UnknownJoint(id))?;
        let joint = self
            .inner
            .impulse_joints
            .get_mut(handle, true)
            .ok_or(PhysicsError3d::UnknownJoint(id))?;
        for axis in [
            JointAxis::AngX,
            JointAxis::AngY,
            JointAxis::AngZ,
            JointAxis::LinX,
            JointAxis::LinY,
            JointAxis::LinZ,
        ] {
            if joint.data.motor_axes.contains(axis.into()) {
                joint
                    .data
                    .set_motor_velocity(axis, target_velocity, max_force);
            }
        }
        Ok(())
    }

    pub fn step(&mut self, timestep: f32) -> Result<Vec<PhysicsEvent3d>, PhysicsError3d> {
        if !timestep.is_finite() || timestep <= 0.0 {
            return Err(PhysicsError3d::InvalidTimestep);
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
            events.push(PhysicsEvent3d {
                kind,
                body_a,
                body_b,
            });
        }
        events.sort_by_key(|event| (event.body_a, event.body_b, event_kind_order(event.kind)));
        Ok(events)
    }

    pub fn snapshots(&self) -> Vec<PhysicsBodySnapshot3d> {
        let mut snapshots: Vec<_> = self
            .bodies
            .iter()
            .filter_map(|(&id, &(handle, _))| {
                self.inner.bodies.get(handle).map(|body| {
                    let rotation = body.rotation().to_array();
                    PhysicsBodySnapshot3d {
                        id,
                        position: body.translation().into(),
                        rotation,
                        linear_velocity: body.linvel().into(),
                        angular_velocity: body.angvel().into(),
                        sleeping: body.is_sleeping(),
                    }
                })
            })
            .collect();
        snapshots.sort_by_key(|snapshot| snapshot.id);
        snapshots
    }

    pub fn raycast(
        &self,
        origin: [f32; 3],
        direction: [f32; 3],
        max_distance: f32,
        layer: u32,
        mask: u32,
        include_sensors: bool,
    ) -> Result<Option<RaycastHit3d>, PhysicsError3d> {
        finite3(origin, "ray origin")?;
        finite3(direction, "ray direction")?;
        positive(max_distance, "ray maximum distance")?;
        let mut direction = Vector::from(direction);
        let length = direction.length();
        if length <= f32::EPSILON {
            return Err(PhysicsError3d::ZeroRayDirection);
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
                self.collider_ids.get(&handle).map(|&body_id| {
                    let point = ray.point_at(hit.time_of_impact);
                    RaycastHit3d {
                        body_id,
                        distance: hit.time_of_impact,
                        point: point.into(),
                        normal: hit.normal.into(),
                    }
                })
            }))
    }

    pub fn overlap_shape(
        &self,
        position: [f32; 3],
        rotation: [f32; 4],
        shape: &ColliderShape3d,
        layer: u32,
        mask: u32,
        include_sensors: bool,
    ) -> Result<Vec<u64>, PhysicsError3d> {
        finite3(position, "overlap position")?;
        let pose = Pose::from_parts(position.into(), quaternion(rotation)?);
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
        position: [f32; 3],
        rotation: [f32; 4],
        direction: [f32; 3],
        max_distance: f32,
        shape: &ColliderShape3d,
        layer: u32,
        mask: u32,
        include_sensors: bool,
    ) -> Result<Option<ShapeCastHit3d>, PhysicsError3d> {
        finite3(position, "shape-cast position")?;
        finite3(direction, "shape-cast direction")?;
        positive(max_distance, "shape-cast maximum distance")?;
        let mut direction = Vector::from(direction);
        let length = direction.length();
        if length <= f32::EPSILON {
            return Err(PhysicsError3d::ZeroRayDirection);
        }
        direction /= length;
        let pose = Pose::from_parts(position.into(), quaternion(rotation)?);
        let collider = collider_builder(shape)?.build();
        let mut filter = query_filter(layer, mask);
        if !include_sensors {
            filter = filter.exclude_sensors();
        }
        let options = rapier3d::parry::query::ShapeCastOptions::with_max_time_of_impact(1.0);
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
                    ShapeCastHit3d {
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
        position: [f32; 3],
        rotation: [f32; 4],
        desired_translation: [f32; 3],
        descriptor: &CharacterControllerDescriptor3d,
    ) -> Result<CharacterMovement3d, PhysicsError3d> {
        if !timestep.is_finite() || timestep <= 0.0 {
            return Err(PhysicsError3d::InvalidTimestep);
        }
        finite3(position, "character position")?;
        finite3(desired_translation, "character desired translation")?;
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
        let pose = Pose::from_parts(position.into(), quaternion(rotation)?);
        let mut filter = query_filter(descriptor.layer, descriptor.mask);
        if !descriptor.include_sensors {
            filter = filter.exclude_sensors();
        }
        let pipeline = self.inner.query_pipeline_with_filter(filter);
        let controller = rapier3d::control::KinematicCharacterController {
            offset: rapier3d::control::CharacterLength::Absolute(descriptor.offset),
            slide: descriptor.slide,
            autostep: descriptor.autostep_max_height.map(|height| {
                rapier3d::control::CharacterAutostep {
                    max_height: rapier3d::control::CharacterLength::Absolute(height),
                    min_width: rapier3d::control::CharacterLength::Absolute(
                        descriptor.autostep_min_width,
                    ),
                    include_dynamic_bodies: descriptor.autostep_dynamic_bodies,
                }
            }),
            max_slope_climb_angle: descriptor.max_slope_climb_degrees.to_radians(),
            min_slope_slide_angle: descriptor.min_slope_slide_degrees.to_radians(),
            snap_to_ground: descriptor
                .snap_to_ground
                .map(rapier3d::control::CharacterLength::Absolute),
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
        Ok(CharacterMovement3d {
            translation: movement.translation.into(),
            grounded: movement.grounded,
            sliding_down_slope: movement.is_sliding_down_slope,
            collisions,
        })
    }

    fn body_mut(&mut self, id: u64) -> Result<&mut RigidBody, PhysicsError3d> {
        let handle = self
            .bodies
            .get(&id)
            .map(|entry| entry.0)
            .ok_or(PhysicsError3d::UnknownBody(id))?;
        self.inner
            .bodies
            .get_mut(handle)
            .ok_or(PhysicsError3d::UnknownBody(id))
    }
}

fn query_filter(layer: u32, mask: u32) -> QueryFilter<'static> {
    QueryFilter::default().groups(InteractionGroups::new(
        Group::from_bits_truncate(layer),
        Group::from_bits_truncate(mask),
        InteractionTestMode::And,
    ))
}

fn collider_builder(shape: &ColliderShape3d) -> Result<ColliderBuilder, PhysicsError3d> {
    Ok(match shape {
        ColliderShape3d::Box { half_extents } => {
            finite3(*half_extents, "box half extents")?;
            if half_extents.iter().any(|value| *value <= 0.0) {
                return Err(PhysicsError3d::Positive("box half extents"));
            }
            ColliderBuilder::cuboid(half_extents[0], half_extents[1], half_extents[2])
        }
        ColliderShape3d::Sphere { radius } => {
            positive(*radius, "sphere radius")?;
            ColliderBuilder::ball(*radius)
        }
        ColliderShape3d::Capsule {
            half_height,
            radius,
        } => {
            positive(*half_height, "capsule half height")?;
            positive(*radius, "capsule radius")?;
            ColliderBuilder::capsule_y(*half_height, *radius)
        }
        ColliderShape3d::Cylinder {
            half_height,
            radius,
        } => {
            positive(*half_height, "cylinder half height")?;
            positive(*radius, "cylinder radius")?;
            ColliderBuilder::cylinder(*half_height, *radius)
        }
        ColliderShape3d::Plane { normal } => {
            finite3(*normal, "plane normal")?;
            let normal = Vector::from(*normal);
            if normal.length_squared() <= f32::EPSILON {
                return Err(PhysicsError3d::InvalidShape(
                    "plane normal cannot be zero".into(),
                ));
            }
            ColliderBuilder::halfspace(Unit::new_unchecked(normal.normalize()))
        }
        ColliderShape3d::ConvexMesh { points } => {
            validate_points(points, "convex mesh vertices", 4)?;
            let points: Vec<Vector> = points.iter().copied().map(Vector::from).collect();
            ColliderBuilder::convex_hull(&points).ok_or_else(|| {
                PhysicsError3d::InvalidShape(
                    "convex mesh points do not form a three-dimensional hull".into(),
                )
            })?
        }
        ColliderShape3d::TriangleMesh { vertices, indices } => {
            validate_points(vertices, "triangle mesh vertices", 3)?;
            if indices.is_empty() {
                return Err(PhysicsError3d::InvalidShape(
                    "triangle mesh needs at least one triangle".into(),
                ));
            }
            if indices
                .iter()
                .flatten()
                .any(|index| *index as usize >= vertices.len())
            {
                return Err(PhysicsError3d::InvalidShape(
                    "triangle mesh index is outside the vertex buffer".into(),
                ));
            }
            let vertices = vertices.iter().copied().map(Vector::from).collect();
            ColliderBuilder::trimesh(vertices, indices.clone()).map_err(|error| {
                PhysicsError3d::InvalidShape(format!("triangle mesh could not be built: {error}"))
            })?
        }
        ColliderShape3d::Heightfield {
            rows,
            columns,
            heights,
            scale,
        } => {
            if *rows < 2 || *columns < 2 {
                return Err(PhysicsError3d::InvalidShape(
                    "heightfield requires at least 2 rows and 2 columns".into(),
                ));
            }
            let expected = (*rows as usize)
                .checked_mul(*columns as usize)
                .ok_or_else(|| {
                    PhysicsError3d::InvalidShape("heightfield dimensions overflow".into())
                })?;
            if heights.len() != expected {
                return Err(PhysicsError3d::InvalidShape(format!(
                    "heightfield expected {expected} heights but received {}",
                    heights.len()
                )));
            }
            if !heights.iter().all(|value| value.is_finite()) {
                return Err(PhysicsError3d::NonFinite("heightfield heights"));
            }
            finite3(*scale, "heightfield scale")?;
            if scale.iter().any(|value| *value <= 0.0) {
                return Err(PhysicsError3d::Positive("heightfield scale"));
            }
            let column_major = (0..*columns as usize)
                .flat_map(|column| {
                    (0..*rows as usize).map(move |row| heights[row * *columns as usize + column])
                })
                .collect();
            let matrix = Array2::new(*rows as usize, *columns as usize, column_major);
            ColliderBuilder::heightfield(matrix, Vector::from(*scale))
        }
        ColliderShape3d::Compound { children } => {
            if children.is_empty() {
                return Err(PhysicsError3d::InvalidShape(
                    "compound collider needs at least one child".into(),
                ));
            }
            let mut shapes = Vec::with_capacity(children.len());
            for child in children {
                finite3(child.position, "compound child position")?;
                let rotation = quaternion(child.rotation)?;
                let pose = Pose::from_parts(Vector::from(child.position), rotation);
                shapes.push((pose, collider_builder(&child.shape)?.shape));
            }
            ColliderBuilder::compound(shapes)
        }
    })
}

fn validate_points(
    points: &[[f32; 3]],
    label: &'static str,
    minimum: usize,
) -> Result<(), PhysicsError3d> {
    if points.len() < minimum {
        return Err(PhysicsError3d::InvalidShape(format!(
            "{label} needs at least {minimum} points"
        )));
    }
    if points
        .iter()
        .all(|point| point.iter().all(|value| value.is_finite()))
    {
        Ok(())
    } else {
        Err(PhysicsError3d::NonFinite(label))
    }
}
fn validate_descriptor(value: &PhysicsBodyDescriptor3d) -> Result<(), PhysicsError3d> {
    if value.id == 0 {
        return Err(PhysicsError3d::ZeroId);
    }
    finite3(value.position, "physics body position")?;
    finite3(value.linear_velocity, "physics linear velocity")?;
    finite3(value.angular_velocity, "physics angular velocity")?;
    quaternion(value.rotation)?;
    non_negative(value.gravity_scale, "gravity scale")?;
    non_negative(value.linear_damping, "linear damping")?;
    non_negative(value.angular_damping, "angular damping")?;
    positive(value.density, "collider density")?;
    non_negative(value.friction, "collider friction")?;
    non_negative(value.restitution, "collider restitution")?;
    if value.layer == 0 {
        return Err(PhysicsError3d::EmptyLayer);
    }
    let _ = collider_builder(&value.shape)?;
    Ok(())
}
fn quaternion(value: [f32; 4]) -> Result<Rotation, PhysicsError3d> {
    if !value.iter().all(|value| value.is_finite()) {
        return Err(PhysicsError3d::NonFinite("physics body rotation"));
    }
    let quaternion = Rotation::from_xyzw(value[0], value[1], value[2], value[3]);
    if quaternion.length_squared() <= f32::EPSILON {
        return Err(PhysicsError3d::ZeroQuaternion);
    }
    Ok(quaternion.normalize())
}
fn finite3(value: [f32; 3], label: &'static str) -> Result<(), PhysicsError3d> {
    if value.iter().all(|value| value.is_finite()) {
        Ok(())
    } else {
        Err(PhysicsError3d::NonFinite(label))
    }
}
fn positive(value: f32, label: &'static str) -> Result<(), PhysicsError3d> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(PhysicsError3d::Positive(label))
    }
}
fn non_negative(value: f32, label: &'static str) -> Result<(), PhysicsError3d> {
    if value.is_finite() && value >= 0.0 {
        Ok(())
    } else {
        Err(PhysicsError3d::NonNegative(label))
    }
}
fn slope(value: f32, label: &'static str) -> Result<(), PhysicsError3d> {
    if value.is_finite() && (0.0..=90.0).contains(&value) {
        Ok(())
    } else {
        Err(PhysicsError3d::NonNegative(label))
    }
}
const fn event_kind_order(kind: PhysicsEventKind) -> u8 {
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
        body_type: BodyType3d,
        y: f32,
        shape: ColliderShape3d,
    ) -> PhysicsBodyDescriptor3d {
        PhysicsBodyDescriptor3d {
            id,
            body_type,
            position: [0.0, y, 0.0],
            rotation: [0.0, 0.0, 0.0, 1.0],
            linear_velocity: [0.0; 3],
            angular_velocity: [0.0; 3],
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
        }
    }

    /// A body at an arbitrary position, for joint tests.
    fn body_at(id: u64, body_type: BodyType3d, position: [f32; 3]) -> PhysicsBodyDescriptor3d {
        let mut descriptor = body(
            id,
            body_type,
            0.0,
            ColliderShape3d::Box {
                half_extents: [0.5; 3],
            },
        );
        descriptor.position = position;
        descriptor
    }

    fn position_of(world: &PhysicsWorld3d, id: u64) -> [f32; 3] {
        world
            .snapshots()
            .into_iter()
            .find(|snapshot| snapshot.id == id)
            .expect("body should exist")
            .position
    }

    #[test]
    fn fixed_joint_carries_a_hanging_body() {
        let mut world = PhysicsWorld3d::default();
        world
            .insert(body_at(1, BodyType3d::Static, [0.0, 5.0, 0.0]))
            .unwrap();
        world
            .insert(body_at(2, BodyType3d::Dynamic, [0.0, 4.0, 0.0]))
            .unwrap();
        world
            .add_joint(JointSpec3d {
                id: 1,
                body_a: 1,
                body_b: 2,
                joint: JointDescriptor3d::Fixed {
                    anchor_a: [0.0, -1.0, 0.0],
                    anchor_b: [0.0, 0.0, 0.0],
                },
                collide_connected: false,
            })
            .unwrap();
        assert_eq!(world.joint_count(), 1);

        for _ in 0..120 {
            world.step(1.0 / 60.0).unwrap();
        }
        // Without the joint the body would have fallen roughly 20 metres.
        let position = position_of(&world, 2);
        assert!(position[1] > 3.0, "welded body fell to {}", position[1]);
    }

    #[test]
    fn hinge_limits_confine_a_swinging_body() {
        let mut world = PhysicsWorld3d::default();
        world
            .insert(body_at(1, BodyType3d::Static, [0.0, 5.0, 0.0]))
            .unwrap();
        world
            .insert(body_at(2, BodyType3d::Dynamic, [1.0, 5.0, 0.0]))
            .unwrap();
        world
            .add_joint(JointSpec3d {
                id: 1,
                body_a: 1,
                body_b: 2,
                joint: JointDescriptor3d::Hinge {
                    anchor_a: [0.0, 0.0, 0.0],
                    anchor_b: [-1.0, 0.0, 0.0],
                    axis: [0.0, 1.0, 0.0],
                    limits: Some([-0.1, 0.1]),
                    motor: None,
                },
                collide_connected: false,
            })
            .unwrap();

        for _ in 0..120 {
            world.step(1.0 / 60.0).unwrap();
        }
        // The hinge axis is vertical, so gravity cannot swing the arm down and
        // the limits keep it from rotating away.
        let position = position_of(&world, 2);
        assert!(position[1] > 4.0, "hinged arm dropped to {}", position[1]);
        assert!(
            position[0] > 0.5,
            "hinged arm collapsed inward to {}",
            position[0]
        );
    }

    #[test]
    fn slider_constrains_motion_to_its_axis() {
        let mut world = PhysicsWorld3d::default();
        world
            .insert(body_at(1, BodyType3d::Static, [0.0, 5.0, 0.0]))
            .unwrap();
        world
            .insert(body_at(2, BodyType3d::Dynamic, [0.0, 5.0, 0.0]))
            .unwrap();
        world
            .add_joint(JointSpec3d {
                id: 1,
                body_a: 1,
                body_b: 2,
                joint: JointDescriptor3d::Slider {
                    anchor_a: [0.0, 0.0, 0.0],
                    anchor_b: [0.0, 0.0, 0.0],
                    axis: [1.0, 0.0, 0.0],
                    limits: Some([-2.0, 2.0]),
                    motor: None,
                },
                collide_connected: false,
            })
            .unwrap();

        world.apply_impulse(2, [50.0, -50.0, 50.0]).unwrap();
        for _ in 0..120 {
            world.step(1.0 / 60.0).unwrap();
        }
        let position = position_of(&world, 2);
        // Free along X within its limits, locked on the other two axes.
        assert!(
            position[0].abs() > 0.1,
            "slider did not move along its axis"
        );
        assert!(
            position[0].abs() <= 2.2,
            "slider escaped its limits at {}",
            position[0]
        );
        assert!(
            (position[1] - 5.0).abs() < 0.2,
            "slider drifted vertically to {}",
            position[1]
        );
        assert!(
            position[2].abs() < 0.2,
            "slider drifted sideways to {}",
            position[2]
        );
    }

    #[test]
    fn motor_drives_a_hinge() {
        let mut world = PhysicsWorld3d::default();
        world
            .insert(body_at(1, BodyType3d::Static, [0.0, 5.0, 0.0]))
            .unwrap();
        world
            .insert(body_at(2, BodyType3d::Dynamic, [1.0, 5.0, 0.0]))
            .unwrap();
        world
            .add_joint(JointSpec3d {
                id: 1,
                body_a: 1,
                body_b: 2,
                joint: JointDescriptor3d::Hinge {
                    anchor_a: [0.0, 0.0, 0.0],
                    anchor_b: [-1.0, 0.0, 0.0],
                    axis: [0.0, 1.0, 0.0],
                    limits: None,
                    motor: Some([4.0, 1000.0]),
                },
                collide_connected: false,
            })
            .unwrap();

        let start = position_of(&world, 2);
        for _ in 0..60 {
            world.step(1.0 / 60.0).unwrap();
        }
        let moved = position_of(&world, 2);
        // A driven hinge swings the arm around its axis.
        let travelled = (moved[0] - start[0]).hypot(moved[2] - start[2]);
        assert!(
            travelled > 0.3,
            "motor did not drive the hinge, travelled {travelled}"
        );

        world.set_joint_motor(1, 0.0, 1000.0).unwrap();
        assert!(world.set_joint_motor(99, 0.0, 1.0).is_err());
    }

    #[test]
    fn joints_are_validated() {
        let mut world = PhysicsWorld3d::default();
        world
            .insert(body_at(1, BodyType3d::Static, [0.0, 5.0, 0.0]))
            .unwrap();
        world
            .insert(body_at(2, BodyType3d::Dynamic, [1.0, 5.0, 0.0]))
            .unwrap();
        let fixed = JointDescriptor3d::Fixed {
            anchor_a: [0.0; 3],
            anchor_b: [0.0; 3],
        };
        let spec = |id: u64, a: u64, b: u64, joint: JointDescriptor3d| JointSpec3d {
            id,
            body_a: a,
            body_b: b,
            joint,
            collide_connected: false,
        };

        assert!(matches!(
            world.add_joint(spec(0, 1, 2, fixed.clone())),
            Err(PhysicsError3d::ZeroId)
        ));
        assert!(matches!(
            world.add_joint(spec(1, 1, 1, fixed.clone())),
            Err(PhysicsError3d::SelfJoint(1))
        ));
        assert!(matches!(
            world.add_joint(spec(1, 1, 9, fixed.clone())),
            Err(PhysicsError3d::UnknownBody(9))
        ));

        world.add_joint(spec(1, 1, 2, fixed.clone())).unwrap();
        assert!(matches!(
            world.add_joint(spec(1, 1, 2, fixed)),
            Err(PhysicsError3d::DuplicateJoint(1))
        ));

        let zero_axis = JointDescriptor3d::Hinge {
            anchor_a: [0.0; 3],
            anchor_b: [0.0; 3],
            axis: [0.0; 3],
            limits: None,
            motor: None,
        };
        assert!(matches!(
            world.add_joint(spec(2, 1, 2, zero_axis)),
            Err(PhysicsError3d::ZeroJointAxis)
        ));

        let bad_limits = JointDescriptor3d::Hinge {
            anchor_a: [0.0; 3],
            anchor_b: [0.0; 3],
            axis: [0.0, 1.0, 0.0],
            limits: Some([1.0, -1.0]),
            motor: None,
        };
        assert!(matches!(
            world.add_joint(spec(3, 1, 2, bad_limits)),
            Err(PhysicsError3d::InvalidJointLimits)
        ));
    }

    #[test]
    fn removing_a_joint_frees_the_body() {
        let mut world = PhysicsWorld3d::default();
        world
            .insert(body_at(1, BodyType3d::Static, [0.0, 5.0, 0.0]))
            .unwrap();
        world
            .insert(body_at(2, BodyType3d::Dynamic, [0.0, 4.0, 0.0]))
            .unwrap();
        world
            .add_joint(JointSpec3d {
                id: 1,
                body_a: 1,
                body_b: 2,
                joint: JointDescriptor3d::Fixed {
                    anchor_a: [0.0, -1.0, 0.0],
                    anchor_b: [0.0; 3],
                },
                collide_connected: false,
            })
            .unwrap();
        for _ in 0..30 {
            world.step(1.0 / 60.0).unwrap();
        }
        let held = position_of(&world, 2);

        world.remove_joint(1).unwrap();
        assert_eq!(world.joint_count(), 0);
        assert!(matches!(
            world.remove_joint(1),
            Err(PhysicsError3d::UnknownJoint(1))
        ));

        for _ in 0..60 {
            world.step(1.0 / 60.0).unwrap();
        }
        // Released, it falls — and it must wake to do so.
        assert!(position_of(&world, 2)[1] < held[1] - 1.0);
    }

    #[test]
    fn removing_a_body_drops_its_joints() {
        let mut world = PhysicsWorld3d::default();
        world
            .insert(body_at(1, BodyType3d::Static, [0.0, 5.0, 0.0]))
            .unwrap();
        world
            .insert(body_at(2, BodyType3d::Dynamic, [0.0, 4.0, 0.0]))
            .unwrap();
        world
            .add_joint(JointSpec3d {
                id: 1,
                body_a: 1,
                body_b: 2,
                joint: JointDescriptor3d::Fixed {
                    anchor_a: [0.0; 3],
                    anchor_b: [0.0; 3],
                },
                collide_connected: false,
            })
            .unwrap();
        world.remove(2).unwrap();
        // A joint referencing a removed body must not survive as a dangling id.
        assert_eq!(world.joint_count(), 0);
        world.step(1.0 / 60.0).unwrap();
    }

    #[test]
    fn ball_joint_swings_but_stays_attached() {
        let mut world = PhysicsWorld3d::default();
        world
            .insert(body_at(1, BodyType3d::Static, [0.0, 5.0, 0.0]))
            .unwrap();
        world
            .insert(body_at(2, BodyType3d::Dynamic, [0.0, 3.0, 0.0]))
            .unwrap();
        world
            .add_joint(JointSpec3d {
                id: 1,
                body_a: 1,
                body_b: 2,
                joint: JointDescriptor3d::Ball {
                    anchor_a: [0.0, 0.0, 0.0],
                    anchor_b: [0.0, 2.0, 0.0],
                },
                collide_connected: false,
            })
            .unwrap();
        world.apply_impulse(2, [30.0, 0.0, 0.0]).unwrap();
        for _ in 0..180 {
            world.step(1.0 / 60.0).unwrap();
        }
        let position = position_of(&world, 2);
        let distance =
            (position[0].powi(2) + (position[1] - 5.0).powi(2) + position[2].powi(2)).sqrt();
        // The anchor separation is held even while the body swings freely.
        assert!(
            (distance - 2.0).abs() < 0.5,
            "ball joint separation drifted to {distance}"
        );
    }

    #[test]
    fn dynamic_body_falls_and_collides_with_ground() {
        let mut world = PhysicsWorld3d::default();
        world
            .insert(body(
                1,
                BodyType3d::Static,
                -0.5,
                ColliderShape3d::Box {
                    half_extents: [5.0, 0.5, 5.0],
                },
            ))
            .unwrap();
        world
            .insert(body(
                2,
                BodyType3d::Dynamic,
                2.0,
                ColliderShape3d::Sphere { radius: 0.5 },
            ))
            .unwrap();
        let mut entered = false;
        for _ in 0..180 {
            entered |= world
                .step(1.0 / 60.0)
                .unwrap()
                .iter()
                .any(|event| event.kind == PhysicsEventKind::CollisionEnter);
        }
        let ball = world
            .snapshots()
            .into_iter()
            .find(|body| body.id == 2)
            .unwrap();
        assert!(entered);
        assert!(
            (ball.position[1] - 0.5).abs() < 0.05,
            "ball at {}",
            ball.position[1]
        );
    }
    #[test]
    fn sensors_emit_trigger_events_without_blocking() {
        let mut world = PhysicsWorld3d::new([0.0, 0.0, 0.0]);
        let mut trigger = body(
            1,
            BodyType3d::Static,
            0.0,
            ColliderShape3d::Sphere { radius: 1.0 },
        );
        trigger.sensor = true;
        world.insert(trigger).unwrap();
        let mut mover = body(
            2,
            BodyType3d::Dynamic,
            0.0,
            ColliderShape3d::Sphere { radius: 0.25 },
        );
        mover.position = [-2.0, 0.0, 0.0];
        mover.linear_velocity = [2.0, 0.0, 0.0];
        world.insert(mover).unwrap();
        let events: Vec<_> = (0..120)
            .flat_map(|_| world.step(1.0 / 60.0).unwrap())
            .collect();
        assert!(
            events
                .iter()
                .any(|event| event.kind == PhysicsEventKind::TriggerEnter)
        );
        assert!(
            events
                .iter()
                .any(|event| event.kind == PhysicsEventKind::TriggerExit)
        );
    }
    #[test]
    fn raycasts_return_stable_ids_points_and_normals() {
        let mut world = PhysicsWorld3d::new([0.0, 0.0, 0.0]);
        world
            .insert(body(
                7,
                BodyType3d::Static,
                0.0,
                ColliderShape3d::Sphere { radius: 1.0 },
            ))
            .unwrap();
        world.step(1.0 / 60.0).unwrap();
        let hit = world
            .raycast([0.0, 0.0, 4.0], [0.0, 0.0, -2.0], 10.0, 1, u32::MAX, false)
            .unwrap()
            .unwrap();
        assert_eq!(hit.body_id, 7);
        assert!((hit.distance - 3.0).abs() < 0.001);
        assert!((hit.normal[2] - 1.0).abs() < 0.001);
    }
    #[test]
    fn compound_children_keep_their_local_transforms() {
        let mut world = PhysicsWorld3d::new([0.0, 0.0, 0.0]);
        world
            .insert(body(
                8,
                BodyType3d::Static,
                0.0,
                ColliderShape3d::Compound {
                    children: vec![
                        CompoundColliderChild3d {
                            position: [-2.0, 0.0, 0.0],
                            rotation: [0.0, 0.0, 0.0, 1.0],
                            shape: ColliderShape3d::Sphere { radius: 0.5 },
                        },
                        CompoundColliderChild3d {
                            position: [2.0, 0.0, 0.0],
                            rotation: [0.0, 0.0, 0.0, 1.0],
                            shape: ColliderShape3d::Box {
                                half_extents: [0.5; 3],
                            },
                        },
                    ],
                },
            ))
            .unwrap();
        world.step(1.0 / 60.0).unwrap();
        for x in [-2.0, 2.0] {
            let hit = world
                .raycast([x, 0.0, 3.0], [0.0, 0.0, -1.0], 10.0, 1, u32::MAX, false)
                .unwrap();
            assert_eq!(hit.map(|value| value.body_id), Some(8));
        }
    }

    #[test]
    fn compound_colliders_reject_empty_and_invalid_children() {
        assert!(collider_builder(&ColliderShape3d::Compound { children: vec![] }).is_err());
        assert!(
            collider_builder(&ColliderShape3d::Compound {
                children: vec![CompoundColliderChild3d {
                    position: [f32::NAN, 0.0, 0.0],
                    rotation: [0.0, 0.0, 0.0, 1.0],
                    shape: ColliderShape3d::Sphere { radius: 1.0 },
                }],
            })
            .is_err()
        );
    }
    #[test]
    fn static_world_shapes_build_and_participate_in_queries() {
        let mut plane_world = PhysicsWorld3d::new([0.0, 0.0, 0.0]);
        plane_world
            .insert(body(
                11,
                BodyType3d::Static,
                0.0,
                ColliderShape3d::Plane {
                    normal: [0.0, 1.0, 0.0],
                },
            ))
            .unwrap();
        plane_world.step(1.0 / 60.0).unwrap();
        assert_eq!(
            plane_world
                .raycast([0.0, 2.0, 0.0], [0.0, -1.0, 0.0], 10.0, 1, u32::MAX, false)
                .unwrap()
                .unwrap()
                .body_id,
            11
        );

        let mut terrain_world = PhysicsWorld3d::new([0.0, 0.0, 0.0]);
        terrain_world
            .insert(body(
                12,
                BodyType3d::Static,
                0.0,
                ColliderShape3d::Heightfield {
                    rows: 2,
                    columns: 2,
                    heights: vec![0.0; 4],
                    scale: [10.0, 1.0, 10.0],
                },
            ))
            .unwrap();
        terrain_world
            .insert(body(
                13,
                BodyType3d::Static,
                5.0,
                ColliderShape3d::TriangleMesh {
                    vertices: vec![[-1.0, 0.0, -1.0], [1.0, 0.0, -1.0], [0.0, 0.0, 1.0]],
                    indices: vec![[0, 1, 2]],
                },
            ))
            .unwrap();
        terrain_world
            .insert(body(
                14,
                BodyType3d::Static,
                10.0,
                ColliderShape3d::ConvexMesh {
                    points: vec![
                        [0.0, 1.0, 0.0],
                        [-1.0, -1.0, -1.0],
                        [1.0, -1.0, -1.0],
                        [0.0, -1.0, 1.0],
                    ],
                },
            ))
            .unwrap();
        assert_eq!(terrain_world.body_count(), 3);
    }
    #[test]
    fn malformed_world_shapes_return_actionable_errors() {
        let mut world = PhysicsWorld3d::default();
        let error = world
            .insert(body(
                1,
                BodyType3d::Static,
                0.0,
                ColliderShape3d::Heightfield {
                    rows: 3,
                    columns: 3,
                    heights: vec![0.0; 4],
                    scale: [1.0; 3],
                },
            ))
            .unwrap_err();
        assert!(error.to_string().contains("expected 9 heights"));
        let error = world
            .insert(body(
                2,
                BodyType3d::Static,
                0.0,
                ColliderShape3d::TriangleMesh {
                    vertices: vec![[0.0; 3]; 3],
                    indices: vec![[0, 1, 9]],
                },
            ))
            .unwrap_err();
        assert!(error.to_string().contains("outside the vertex buffer"));
    }
    #[test]
    fn overlap_and_shape_cast_return_filtered_stable_ids() {
        let mut world = PhysicsWorld3d::new([0.0, 0.0, 0.0]);
        world
            .insert(body(
                7,
                BodyType3d::Static,
                0.0,
                ColliderShape3d::Sphere { radius: 1.0 },
            ))
            .unwrap();
        world.step(1.0 / 60.0).unwrap();
        let overlaps = world
            .overlap_shape(
                [0.75, 0.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
                &ColliderShape3d::Sphere { radius: 0.5 },
                1,
                u32::MAX,
                false,
            )
            .unwrap();
        assert_eq!(overlaps, vec![7]);
        let hit = world
            .cast_shape(
                [0.0, 0.0, 4.0],
                [0.0, 0.0, 0.0, 1.0],
                [0.0, 0.0, -1.0],
                10.0,
                &ColliderShape3d::Sphere { radius: 0.5 },
                1,
                u32::MAX,
                false,
            )
            .unwrap()
            .unwrap();
        assert_eq!(hit.body_id, 7);
        assert!(
            (hit.distance - 2.5).abs() < 0.01,
            "distance {}",
            hit.distance
        );
        assert!(hit.normal[2] > 0.99, "normal {:?}", hit.normal);
    }
    #[test]
    fn character_controller_stops_on_ground_and_reports_collision() {
        let mut world = PhysicsWorld3d::new([0.0, 0.0, 0.0]);
        world
            .insert(body(
                1,
                BodyType3d::Static,
                -0.5,
                ColliderShape3d::Box {
                    half_extents: [5.0, 0.5, 5.0],
                },
            ))
            .unwrap();
        world.step(1.0 / 60.0).unwrap();
        let movement = world
            .move_character(
                1.0 / 60.0,
                [0.0, 2.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
                [0.0, -3.0, 0.0],
                &CharacterControllerDescriptor3d {
                    shape: ColliderShape3d::Capsule {
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
    fn validates_descriptors_and_stale_ids() {
        let mut world = PhysicsWorld3d::default();
        let mut invalid = body(
            0,
            BodyType3d::Dynamic,
            0.0,
            ColliderShape3d::Sphere { radius: 1.0 },
        );
        assert_eq!(world.insert(invalid.clone()), Err(PhysicsError3d::ZeroId));
        invalid.id = 1;
        invalid.layer = 0;
        assert_eq!(world.insert(invalid), Err(PhysicsError3d::EmptyLayer));
        assert_eq!(
            world.apply_impulse(99, [1.0, 0.0, 0.0]),
            Err(PhysicsError3d::UnknownBody(99))
        );
    }
    #[test]
    fn force_at_point_and_torque_drive_angular_velocity() {
        let mut world = PhysicsWorld3d::new([0.0, 0.0, 0.0]);
        world
            .insert(body(
                4,
                BodyType3d::Dynamic,
                0.0,
                ColliderShape3d::Box {
                    half_extents: [0.5; 3],
                },
            ))
            .unwrap();
        world
            .add_force_at_point(4, [10.0, 0.0, 0.0], [0.0, 1.0, 0.0])
            .unwrap();
        world.add_torque(4, [0.0, 0.0, 2.0]).unwrap();
        world.apply_torque_impulse(4, [0.0, 1.0, 0.0]).unwrap();
        world.step(1.0 / 60.0).unwrap();
        let angular = world.snapshots()[0].angular_velocity;
        assert!(
            angular.iter().any(|value| value.abs() > 0.01),
            "angular velocity {angular:?}"
        );
        world.set_angular_velocity(4, [1.0, 2.0, 3.0]).unwrap();
        assert_eq!(world.snapshots()[0].angular_velocity, [1.0, 2.0, 3.0]);
    }
}

/// Translates a descriptor into a Rapier joint.
fn build_joint(
    descriptor: &JointDescriptor3d,
    collide_connected: bool,
) -> Result<GenericJoint, PhysicsError3d> {
    let unit_axis = |axis: [f32; 3]| -> Result<Vector, PhysicsError3d> {
        finite3(axis, "joint axis")?;
        let vector = Vector::new(axis[0], axis[1], axis[2]);
        if vector.length() < 1.0e-6 {
            return Err(PhysicsError3d::ZeroJointAxis);
        }
        Ok(vector.normalize())
    };
    let limits = |values: [f32; 2]| -> Result<[f32; 2], PhysicsError3d> {
        if !values[0].is_finite() || !values[1].is_finite() {
            return Err(PhysicsError3d::NonFinite("joint limits"));
        }
        if values[0] > values[1] {
            return Err(PhysicsError3d::InvalidJointLimits);
        }
        Ok(values)
    };

    let joint = match descriptor {
        JointDescriptor3d::Fixed { anchor_a, anchor_b } => {
            finite3(*anchor_a, "joint anchor")?;
            finite3(*anchor_b, "joint anchor")?;
            FixedJointBuilder::new()
                .local_anchor1(Vector::from(*anchor_a))
                .local_anchor2(Vector::from(*anchor_b))
                .build()
                .into()
        }
        JointDescriptor3d::Hinge {
            anchor_a,
            anchor_b,
            axis,
            limits: bounds,
            motor,
        } => {
            finite3(*anchor_a, "joint anchor")?;
            finite3(*anchor_b, "joint anchor")?;
            let mut builder = RevoluteJointBuilder::new(unit_axis(*axis)?)
                .local_anchor1(Vector::from(*anchor_a))
                .local_anchor2(Vector::from(*anchor_b));
            if let Some(values) = bounds {
                let checked = limits(*values)?;
                builder = builder.limits(checked);
            }
            if let Some(values) = motor {
                if !values[0].is_finite() {
                    return Err(PhysicsError3d::NonFinite("joint motor velocity"));
                }
                if !values[1].is_finite() || values[1] < 0.0 {
                    return Err(PhysicsError3d::NonNegative("joint motor force"));
                }
                builder = builder.motor_velocity(values[0], values[1]);
            }
            builder.build().into()
        }
        JointDescriptor3d::Slider {
            anchor_a,
            anchor_b,
            axis,
            limits: bounds,
            motor,
        } => {
            finite3(*anchor_a, "joint anchor")?;
            finite3(*anchor_b, "joint anchor")?;
            let mut builder = PrismaticJointBuilder::new(unit_axis(*axis)?)
                .local_anchor1(Vector::from(*anchor_a))
                .local_anchor2(Vector::from(*anchor_b));
            if let Some(values) = bounds {
                let checked = limits(*values)?;
                builder = builder.limits(checked);
            }
            if let Some(values) = motor {
                if !values[0].is_finite() {
                    return Err(PhysicsError3d::NonFinite("joint motor velocity"));
                }
                if !values[1].is_finite() || values[1] < 0.0 {
                    return Err(PhysicsError3d::NonNegative("joint motor force"));
                }
                builder = builder.motor_velocity(values[0], values[1]);
            }
            builder.build().into()
        }
        JointDescriptor3d::Ball { anchor_a, anchor_b } => {
            finite3(*anchor_a, "joint anchor")?;
            finite3(*anchor_b, "joint anchor")?;
            SphericalJointBuilder::new()
                .local_anchor1(Vector::from(*anchor_a))
                .local_anchor2(Vector::from(*anchor_b))
                .build()
                .into()
        }
        JointDescriptor3d::Spring {
            anchor_a,
            anchor_b,
            rest_length,
            stiffness,
            damping,
        } => {
            finite3(*anchor_a, "joint anchor")?;
            finite3(*anchor_b, "joint anchor")?;
            if !rest_length.is_finite() || *rest_length < 0.0 {
                return Err(PhysicsError3d::NonNegative("joint rest length"));
            }
            if !stiffness.is_finite() || *stiffness < 0.0 {
                return Err(PhysicsError3d::NonNegative("joint stiffness"));
            }
            if !damping.is_finite() || *damping < 0.0 {
                return Err(PhysicsError3d::NonNegative("joint damping"));
            }
            RopeJointBuilder::new(*rest_length)
                .local_anchor1(Vector::from(*anchor_a))
                .local_anchor2(Vector::from(*anchor_b))
                .build()
                .into()
        }
    };

    let mut generic: GenericJoint = joint;
    generic.set_contacts_enabled(collide_connected);
    Ok(generic)
}
