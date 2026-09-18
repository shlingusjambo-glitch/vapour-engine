//! GPU mesh upload and the mesh registry.
//!
//! Owns the vertex layout the standard pipeline expects and the generational
//! registry that maps stable mesh ids to uploaded buffers.

use std::collections::HashMap;

use wgpu::util::DeviceExt;

use crate::mesh::{MeshData, MeshVertex, SkinVertex};

impl VertexLayout for MeshVertex {
    const ATTRIBUTES: [wgpu::VertexAttribute; 6] = wgpu::vertex_attr_array![
        0 => Float32x3,
        1 => Float32x3,
        2 => Float32x2,
        3 => Float32x4,
        4 => Float32x4,
        5 => Float32
    ];
}

pub(crate) trait VertexLayout {
    const ATTRIBUTES: [wgpu::VertexAttribute; 6];

    fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<MeshVertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

/// The standard vertex buffer exposing only its position at location 0, for
/// passes (decal volumes) that draw a mesh's shape and nothing else.
pub(crate) const POSITION_ONLY_ATTRIBUTES: [wgpu::VertexAttribute; 1] =
    wgpu::vertex_attr_array![0 => Float32x3];

pub(crate) fn position_only_layout() -> wgpu::VertexBufferLayout<'static> {
    wgpu::VertexBufferLayout {
        array_stride: std::mem::size_of::<MeshVertex>() as wgpu::BufferAddress,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &POSITION_ONLY_ATTRIBUTES,
    }
}

/// Locations 13/14 sit past `MeshVertex` (0-5) and `InstanceData` (6-12), so
/// every mesh — skinned or not — can bind this as a third vertex buffer
/// without the pipeline needing a skinned/static variant.
impl SkinVertex {
    pub(crate) const ATTRIBUTES: [wgpu::VertexAttribute; 2] = wgpu::vertex_attr_array![
        13 => Uint32x4,
        14 => Float32x4
    ];

    pub(crate) fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<SkinVertex>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

/// One uploaded mesh: its buffers and how many indices to draw.
pub(crate) struct MeshGpu {
    pub(crate) vertex_buffer: wgpu::Buffer,
    pub(crate) index_buffer: wgpu::Buffer,
    pub(crate) index_count: u32,
    /// Always present, even for a static mesh (zero-filled): see
    /// `SkinVertex`'s doc comment for why the pipeline never branches on it.
    pub(crate) skin_buffer: wgpu::Buffer,
    /// Radius of the smallest origin-centred sphere enclosing the mesh's
    /// bounds, for frustum culling (see `surface::culling::world_bounds`).
    pub(crate) bounding_radius: f32,
}

/// Meshes the renderer can draw, addressed by identifier.
///
/// Built-ins are registered under their `builtin:` names at startup; a game
/// uploads its own geometry — meshed voxel chunks, imported models — under any
/// other identifier. Slots are recycled on release so a world that streams
/// chunks in and out does not grow the table without bound.
#[derive(Default)]
pub(crate) struct MeshRegistry {
    pub(crate) meshes: Vec<Option<MeshGpu>>,
    pub(crate) slots: HashMap<String, usize>,
    pub(crate) free: Vec<usize>,
}

impl MeshRegistry {
    pub(crate) fn slot(&self, id: &str) -> Option<usize> {
        self.slots.get(id).copied()
    }

    pub(crate) fn get(&self, slot: usize) -> Option<&MeshGpu> {
        self.meshes.get(slot).and_then(Option::as_ref)
    }

    /// Adds or replaces a mesh. Replacing keeps the same slot, so instances
    /// already referencing this identifier pick up the new geometry with no
    /// further bookkeeping — which is exactly what remeshing an edited chunk
    /// needs.
    pub(crate) fn insert(&mut self, id: &str, mesh: MeshGpu) {
        if let Some(slot) = self.slot(id) {
            self.meshes[slot] = Some(mesh);
            return;
        }
        let slot = match self.free.pop() {
            Some(slot) => {
                self.meshes[slot] = Some(mesh);
                slot
            }
            None => {
                self.meshes.push(Some(mesh));
                self.meshes.len() - 1
            }
        };
        self.slots.insert(id.to_owned(), slot);
    }

    pub(crate) fn remove(&mut self, id: &str) -> bool {
        let Some(slot) = self.slots.remove(id) else {
            return false;
        };
        self.meshes[slot] = None;
        self.free.push(slot);
        true
    }

    pub(crate) fn ids(&self) -> Vec<&str> {
        let mut ids: Vec<&str> = self.slots.keys().map(String::as_str).collect();
        ids.sort_unstable();
        ids
    }

    pub(crate) fn len(&self) -> usize {
        self.slots.len()
    }
}

/// Distance from the origin to the farthest corner of the mesh's bounds.
pub(crate) fn bounding_radius(data: &MeshData) -> f32 {
    let (minimum, maximum) = data.bounds();
    (0..3)
        .map(|axis| minimum[axis].abs().max(maximum[axis].abs()).powi(2))
        .sum::<f32>()
        .sqrt()
}

/// The camera and light the next frame will use.
///
/// Both submission paths — the editor's JSON render world and a game's binary
/// frame — resolve into this, so `update_uniforms` has exactly one input shape
/// and the two paths cannot drift apart in how they light a scene.
impl MeshGpu {
    /// Uploads prepared geometry. The caller has already validated it,
    /// including that `data.skin`, when present, has one entry per vertex.
    pub(crate) fn upload(device: &wgpu::Device, label: &str, data: &MeshData) -> Self {
        let owned_zeroed_skin;
        let skin: &[SkinVertex] = match &data.skin {
            Some(skin) => skin,
            None => {
                owned_zeroed_skin = vec![SkinVertex::UNSKINNED; data.vertices.len()];
                &owned_zeroed_skin
            }
        };
        Self {
            vertex_buffer: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents: bytemuck::cast_slice(&data.vertices),
                usage: wgpu::BufferUsages::VERTEX,
            }),
            index_buffer: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents: bytemuck::cast_slice(&data.indices),
                usage: wgpu::BufferUsages::INDEX,
            }),
            index_count: data.indices.len() as u32,
            bounding_radius: bounding_radius(data),
            skin_buffer: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents: bytemuck::cast_slice(skin),
                usage: wgpu::BufferUsages::VERTEX,
            }),
        }
    }
}
