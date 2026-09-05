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

pub use capabilities::{RenderCapabilities, RenderTier, TextureCompression};
pub use context::{GpuContext, GpuContextError, GpuRequest};
pub use graph::{
    CompiledRenderGraph, GraphError, PassId, PassKind, RenderGraph, RenderGraphExecutor,
    RenderPassNode, ResourceId, ResourceKind,
};
pub use mesh::{
    BuiltinMesh, MeshData, MeshError, MeshVertex, build_mesh, build_mesh_with_attributes,
    build_mesh_with_texture_layers,
};
pub use render_world::{
    CameraProjection, MAX_RENDER_INSTANCES, RENDER_WORLD_VERSION, RenderCamera,
    RenderDirectionalLight, RenderInstance, RenderWorld, RenderWorldError,
};
pub use resource::{Arena, Handle};
pub use shader::{ShaderAsset, ShaderError, ShaderLibrary, ShaderStage};
pub use surface::{
    FrameStats, MaterialTextureSet, PostProcessSettings, RENDER_LAYER_CLEAR_COLOR,
    RENDER_LAYER_CLEAR_DEPTH, RENDER_LAYER_HAS_CAMERA, RENDER_LAYER_HAS_ENVIRONMENT,
    RENDER_LAYER_HAS_LIGHT, RenderFrame, RenderLayers, StandardMaterialDescriptor, SurfaceRenderer,
    SurfaceRendererError, TextureAtlasDescriptor, ToneMapping,
};

pub const STANDARD_PBR_SHADER: &str = include_str!("../shaders/standard_pbr.wgsl");
pub const SHADOW_DEPTH_SHADER: &str = include_str!("../shaders/shadow_depth.wgsl");
pub const TONEMAP_SHADER: &str = include_str!("../shaders/tonemap.wgsl");
pub const PROCEDURAL_SKY_SHADER: &str = include_str!("../shaders/procedural_sky.wgsl");
