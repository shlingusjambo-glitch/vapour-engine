//! Allocation-conscious runtime primitives shared by native tooling and WASM.

mod entity;
mod physics2d;
mod physics3d;
mod scene;
mod sparse_set;
mod time;
mod transform;
mod world;

pub use entity::{Entity, EntityAllocator};
pub use physics2d::{
    BodyType2d, CharacterControllerDescriptor2d, CharacterMovement2d, ColliderShape2d,
    PhysicsBodyDescriptor2d, PhysicsBodySnapshot2d, PhysicsError2d, PhysicsEvent2d, PhysicsWorld2d,
    RaycastHit2d, ShapeCastHit2d,
};
pub use physics3d::{
    BodyType3d, CharacterControllerDescriptor3d, CharacterMovement3d, ColliderShape3d,
    CompoundColliderChild3d, JointDescriptor3d, JointSpec3d, PhysicsBodyDescriptor3d,
    PhysicsBodySnapshot3d, PhysicsError3d, PhysicsEvent3d, PhysicsEventKind, PhysicsWorld3d,
    RaycastHit3d, ShapeCastHit3d,
};
pub use scene::{ComponentRecord, SCENE_FORMAT_VERSION, SceneAsset, SceneEntity, SceneError};
pub use sparse_set::SparseSet;
pub use time::{FrameStep, Time};
pub use transform::{GlobalTransform, HierarchyError, Transform, TransformHierarchy};
pub use world::{Component, World, WorldError};
