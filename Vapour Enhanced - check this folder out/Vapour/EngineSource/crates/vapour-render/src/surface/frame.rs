//! Per-frame submission types: layers, batches, instances, and statistics.

use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3};

use super::{
    lighting::*,
    material::*,
    shadow::{MAX_SHADOW_SLOTS, SHADOW_CASCADE_COUNT},
    view::*,
};

/// A frame submitted as packed arrays.
///
/// Field lengths are checked on submission; see
/// [`SurfaceRenderer::set_render_frame`] for what each one holds.
#[derive(Debug, Clone, Copy)]
pub struct RenderFrame<'a> {
    /// Distinct mesh identifiers. One entry per mesh, not per instance.
    pub mesh_table: &'a [String],
    /// One entry per instance, indexing `mesh_table`.
    pub mesh_indices: &'a [u32],
    /// Distinct material identifiers. One entry per material, not instance.
    pub material_table: &'a [String],
    /// One entry per instance, indexing `material_table`.
    pub material_indices: &'a [u32],
    /// 16 column-major floats per instance.
    pub matrices: &'a [f32],
    /// 4 floats per instance, or empty for opaque white.
    pub base_colors: &'a [f32],
    /// 4 floats per instance, or empty for the default dielectric.
    pub material_params: &'a [f32],
    /// 16 matrix floats, projection mode (0 perspective, 1 orthographic),
    /// projection size, near, and far. Empty uses the default framing.
    pub camera: &'a [f32],
    /// 3 direction floats, 3 colour floats, then intensity. Empty uses the
    /// default sun.
    pub light: &'a [f32],
    /// Clear colour and optional fog, three aligned vec4 lanes.
    pub environment: &'a [f32],
}

pub const RENDER_LAYER_CLEAR_COLOR: u32 = 1;
pub const RENDER_LAYER_CLEAR_DEPTH: u32 = 2;
pub const RENDER_LAYER_HAS_CAMERA: u32 = 4;
pub const RENDER_LAYER_HAS_LIGHT: u32 = 8;
pub const RENDER_LAYER_HAS_ENVIRONMENT: u32 = 16;
/// The layer supplies its own projection matrix (`RenderLayers::projections`)
/// instead of the symmetric perspective its camera record describes — an XR
/// eye's asymmetric frustum, for instance. The camera record's field of
/// view, near, and far still describe the frustum for shadow cascades.
pub const RENDER_LAYER_HAS_PROJECTION: u32 = 32;

/// Several camera layers packed into one atomic surface submission. Instance
/// arrays are concatenated in layer order; `layer_instance_counts` partitions
/// them and `layer_flags` controls colour/depth clears and optional view data.
#[derive(Debug, Clone, Copy)]
pub struct RenderLayers<'a> {
    pub mesh_table: &'a [String],
    pub mesh_indices: &'a [u32],
    pub material_table: &'a [String],
    pub material_indices: &'a [u32],
    pub matrices: &'a [f32],
    pub base_colors: &'a [f32],
    pub material_params: &'a [f32],
    pub layer_instance_counts: &'a [u32],
    pub layer_flags: &'a [u32],
    /// Exactly 20 values per layer; ignored unless HAS_CAMERA is set.
    pub cameras: &'a [f32],
    /// Every layer's light rig, concatenated. A layer's slice is
    /// `LIGHT_STRIDE * layer_light_counts[layer]` long and starts after the
    /// preceding layers'; ignored unless HAS_LIGHT is set.
    pub lights: &'a [f32],
    /// Lights belonging to each layer. Empty means no layer carries a rig.
    pub layer_light_counts: &'a [u32],
    /// Exactly `ENVIRONMENT_STRIDE` values per layer; ignored unless HAS_ENVIRONMENT is set.
    pub environments: &'a [f32],
    /// One entry per instance: that instance's offset into `bone_matrices`,
    /// or a negative value if it is not skinned. Empty means no instance in
    /// this submission is skinned.
    pub bone_offsets: &'a [f32],
    /// Every skinned instance's bone palette this frame, concatenated: 16
    /// column-major floats per bone, back to back (see
    /// `crate::mesh::pack_bone_palette`). Indexed by `bone_offsets`.
    pub bone_matrices: &'a [f32],
    /// One entry per layer naming the render target it draws into, or an
    /// empty string for the presentation surface. Empty means every layer
    /// presents to the surface.
    pub layer_targets: &'a [String],
    /// Four values per layer — `x, y, width, height` as fractions of the
    /// destination in [0, 1] — or empty for full-destination layers. The
    /// viewport and scissor are set together, so a layer never draws outside
    /// its rectangle even with a sky or clear.
    pub viewports: &'a [f32],
    /// Sixteen column-major floats per layer, or empty; a layer's matrix is
    /// used only when its flags carry `RENDER_LAYER_HAS_PROJECTION`.
    pub projections: &'a [f32],
}

/// The whole destination.
pub(crate) const FULL_VIEWPORT: [f32; 4] = [0.0, 0.0, 1.0, 1.0];

/// One instance on its way to the GPU, before sorting and packing.
#[derive(Debug, Clone, Copy)]
pub(crate) struct InstanceSubmission {
    pub(crate) slot: usize,
    pub(crate) material: usize,
    pub(crate) pipeline: PipelineKind,
    pub(crate) model: Mat4,
    pub(crate) base_color: [f32; 4],
    pub(crate) material_params: [f32; 4],
    /// Index of this instance's first bone in the frame's bone palette, or
    /// -1 if it is not skinned.
    pub(crate) bone_offset: f32,
}

/// A contiguous run of instances that share a mesh, so they draw in one call.
#[derive(Debug, Clone, Copy)]
pub(crate) struct DrawBatch {
    pub(crate) mesh: usize,
    pub(crate) material: usize,
    pub(crate) pipeline: PipelineKind,
    pub(crate) first_instance: u32,
    pub(crate) instance_count: u32,
}

pub(crate) struct LayerSubmission {
    pub(crate) view: ViewState,
    pub(crate) default_view: bool,
    pub(crate) clear_color: bool,
    pub(crate) clear_depth: bool,
    pub(crate) instances: Vec<InstanceSubmission>,
    /// Render target identifier, or `None` for the surface.
    pub(crate) target: Option<String>,
    pub(crate) viewport: [f32; 4],
}

pub(crate) struct RenderLayerState {
    /// Where this layer's instances and batches start in the frame-wide
    /// arrays (every layer's are concatenated in order).
    pub(crate) first_instance: u32,
    pub(crate) instance_count: u32,
    pub(crate) first_batch: u32,
    pub(crate) view: ViewState,
    pub(crate) default_view: bool,
    pub(crate) clear_color: bool,
    pub(crate) clear_depth: bool,
    pub(crate) batches: Vec<DrawBatch>,
    pub(crate) target: Option<String>,
    pub(crate) viewport: [f32; 4],
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub(crate) struct FrameUniforms {
    pub(crate) view_projection: [[f32; 4]; 4],
    pub(crate) inverse_view_projection: [[f32; 4]; 4],
    pub(crate) camera_position_exposure: [f32; 4],
    /// xyz camera forward; w reserved. Shadow cascade selection uses view depth,
    /// not radial distance, so screen corners do not switch too early.
    pub(crate) camera_forward: [f32; 4],
    /// [live light count, time in seconds, reserved, reserved]
    pub(crate) light_count_time: [f32; 4],
    pub(crate) fog_color_mode: [f32; 4],
    pub(crate) fog_params: [f32; 4],
    pub(crate) sky_zenith_mode: [f32; 4],
    pub(crate) sky_horizon_curve: [f32; 4],
    pub(crate) sky_ground_sun_size: [f32; 4],
    pub(crate) lights: [GpuLight; MAX_LIGHTS],
    pub(crate) shadow_matrices: [[[f32; 4]; 4]; SHADOW_CASCADE_COUNT],
    pub(crate) shadow_splits: [f32; SHADOW_CASCADE_COUNT],
    /// cascade count, map size, constant bias, reserved
    pub(crate) shadow_params: [f32; 4],
    /// One view-projection matrix per point/spot atlas slot. A point light
    /// occupies 6 consecutive slots (its cube faces); a spot light occupies
    /// one. A light's `cone.z` (see `GpuLight`) carries its base slot, or -1 if
    /// it was not granted one this frame — see `assign_shadow_slots`.
    pub(crate) point_spot_matrices: [[[f32; 4]; 4]; MAX_SHADOW_SLOTS],
    /// slots in use, atlas face size, constant bias, reserved
    pub(crate) point_spot_params: [f32; 4],
    /// Image-based lighting: [environment live, highest prefiltered mip,
    /// intensity, reserved]. See `EnvironmentGpu::params`.
    pub(crate) ibl_params: [f32; 4],
}

pub(crate) struct FrameGpu {
    pub(crate) buffer: wgpu::Buffer,
    pub(crate) bind_group: wgpu::BindGroup,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub(crate) struct InstanceData {
    /// The normal matrix is derived from this in the vertex shader rather
    /// than shipped: WebGPU guarantees only 16 vertex attributes, and the
    /// mesh, instance, and skin buffers together must fit that budget.
    pub(crate) model: [[f32; 4]; 4],
    pub(crate) base_color: [f32; 4],
    pub(crate) material_params: [f32; 4],
    /// x: this instance's bone-palette offset, or -1 if unskinned. yzw
    /// reserved.
    pub(crate) skin: [f32; 4],
}

impl InstanceData {
    pub(crate) const ATTRIBUTES: [wgpu::VertexAttribute; 7] = wgpu::vertex_attr_array![
        6 => Float32x4,
        7 => Float32x4,
        8 => Float32x4,
        9 => Float32x4,
        10 => Float32x4,
        11 => Float32x4,
        12 => Float32x4
    ];

    pub(crate) fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameStats {
    pub draw_calls: u32,
    /// Triangles submitted, before culling.
    pub triangles: u32,
    pub cpu_encode_ms: f32,
    /// Whether this frame's frustum culling ran as a compute pass.
    pub gpu_culling: bool,
    /// Instances the CPU fallback dropped; `None` on the GPU path, which
    /// compacts on-device without a readback.
    pub culled_instances: Option<u32>,
}

pub(crate) fn sort_submissions(submission: &mut [InstanceSubmission], camera: Vec3) {
    // Opaque/masked surfaces maximize batching. Blended surfaces follow them
    // and sort by object origin from far to near; only consecutive equal
    // mesh/material runs instance together, preserving transparency.
    submission.sort_by(
        |left, right| match (left.pipeline.blended(), right.pipeline.blended()) {
            (false, true) => std::cmp::Ordering::Less,
            (true, false) => std::cmp::Ordering::Greater,
            (false, false) => (left.material, left.slot).cmp(&(right.material, right.slot)),
            (true, true) => {
                let left_distance = left
                    .model
                    .transform_point3(Vec3::ZERO)
                    .distance_squared(camera);
                let right_distance = right
                    .model
                    .transform_point3(Vec3::ZERO)
                    .distance_squared(camera);
                right_distance
                    .total_cmp(&left_distance)
                    .then_with(|| (left.material, left.slot).cmp(&(right.material, right.slot)))
            }
        },
    );
}
