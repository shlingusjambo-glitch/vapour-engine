//! WebGPU-first rendering primitives. This crate owns GPU policy; browser DOM
//! integration remains in `vapour-wasm` and passes an HTML canvas surface in.

mod capabilities;
mod clock;
mod context;
mod graph;
mod mesh;
mod render_world;
mod resource;
mod shader;
mod surface;
#[cfg(test)]
pub(crate) mod test_gpu;

pub use capabilities::{RenderCapabilities, RenderTier, TextureCompression};
pub use context::{GpuContext, GpuContextError, GpuRequest};
pub use graph::{
    CompiledRenderGraph, GraphError, PassId, PassKind, RenderGraph, RenderGraphExecutor,
    RenderPassNode, ResourceId, ResourceKind,
};
pub use mesh::{
    BuiltinMesh, MeshData, MeshError, MeshVertex, SkinVertex, build_mesh,
    build_mesh_with_attributes, build_mesh_with_texture_layers, pack_bone_palette,
    skin_vertex_position,
};
pub use render_world::{
    CameraProjection, MAX_RENDER_INSTANCES, RENDER_WORLD_VERSION, RenderCamera,
    RenderDirectionalLight, RenderInstance, RenderWorld, RenderWorldError,
};
pub use resource::{Arena, Handle};
pub use shader::{ShaderAsset, ShaderError, ShaderLibrary, ShaderStage};
pub use surface::{
    AntiAliasing, BRDF_LUT_SIZE, DECAL_STRIDE, DebugView, FrameStats, GpuParticle,
    IRRADIANCE_FACE_SIZE, MAX_BONE_MATRICES, MAX_DECALS, MAX_ENVIRONMENT_FACE_SIZE,
    MAX_PARTICLE_CAPACITY, MaterialTextureSet, PARTICLE_LUT_SAMPLES, PARTICLE_STRIDE,
    PREFILTER_MIN_FACE_SIZE, ParticleBlend, ParticleCounters, ParticleError, ParticleParams,
    ParticleShapeKind, ParticleSystemDescriptor, ParticleSystemStats, PostProcessSettings,
    RENDER_LAYER_CLEAR_COLOR, RENDER_LAYER_CLEAR_DEPTH, RENDER_LAYER_HAS_CAMERA,
    RENDER_LAYER_HAS_ENVIRONMENT, RENDER_LAYER_HAS_LIGHT, RENDER_LAYER_HAS_PROJECTION, RenderFrame,
    RenderLayers, RenderTargetSize, SKY_CAPTURE_FACE_SIZE, StandardMaterialDescriptor,
    SurfaceRenderer, SurfaceRendererError, TextureAtlasDescriptor, ToneMapping,
    cube_face_direction, cube_face_uv, decal_atlas_uv, decal_local_uv, detect_render_target_cycle,
    frustum_planes, mip_roughness, prefiltered_mip_count, seed_state, spawn_particle,
    sphere_inside, step_cpu, target_extent, world_bounds,
};

pub const STANDARD_PBR_SHADER: &str = include_str!("../shaders/standard_pbr.wgsl");
pub const SHADOW_DEPTH_SHADER: &str = include_str!("../shaders/shadow_depth.wgsl");
pub const TONEMAP_SHADER: &str = include_str!("../shaders/tonemap.wgsl");
pub const PROCEDURAL_SKY_SHADER: &str = include_str!("../shaders/procedural_sky.wgsl");
pub const DECAL_SHADER: &str = include_str!("../shaders/decal.wgsl");
pub const IBL_PREFILTER_SHADER: &str = include_str!("../shaders/ibl_prefilter.wgsl");
pub const IBL_BRDF_LUT_SHADER: &str = include_str!("../shaders/ibl_brdf_lut.wgsl");
pub const CULL_INSTANCES_SHADER: &str = include_str!("../shaders/cull_instances.wgsl");
pub const PARTICLES_SIM_SHADER: &str = include_str!("../shaders/particles_sim.wgsl");
pub const PARTICLES_SHADER: &str = include_str!("../shaders/particles.wgsl");
