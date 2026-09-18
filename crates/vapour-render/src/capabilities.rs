use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RenderTier {
    Baseline,
    Enhanced,
    HighEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TextureCompression {
    None,
    Etc2,
    Bc,
    Astc,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderCapabilities {
    pub tier: RenderTier,
    pub adapter_name: String,
    pub backend: String,
    pub timestamp_queries: bool,
    pub multi_draw_indirect: bool,
    pub indirect_first_instance: bool,
    /// Whether instances can be frustum-culled on the GPU. Compute and
    /// indirect draws are WebGPU core; what the compaction needs beyond them
    /// is a non-zero `first_instance` in indirect args, which is the
    /// `indirect-first-instance` feature.
    pub gpu_culling: bool,
    pub shader_f16: bool,
    pub texture_compression: TextureCompression,
    pub max_texture_dimension_2d: u32,
    pub max_bind_groups: u32,
    pub max_storage_buffers_per_shader_stage: u32,
}

impl RenderCapabilities {
    #[must_use]
    pub fn from_adapter(adapter: &wgpu::Adapter) -> Self {
        let features = adapter.features();
        let limits = adapter.limits();
        let info = adapter.get_info();
        let texture_compression = if features.contains(wgpu::Features::TEXTURE_COMPRESSION_ASTC) {
            TextureCompression::Astc
        } else if features.contains(wgpu::Features::TEXTURE_COMPRESSION_BC) {
            TextureCompression::Bc
        } else if features.contains(wgpu::Features::TEXTURE_COMPRESSION_ETC2) {
            TextureCompression::Etc2
        } else {
            TextureCompression::None
        };
        let timestamp_queries = features.contains(wgpu::Features::TIMESTAMP_QUERY);
        let multi_draw_indirect = features.contains(wgpu::Features::MULTI_DRAW_INDIRECT_COUNT);
        let indirect_first_instance = features.contains(wgpu::Features::INDIRECT_FIRST_INSTANCE);
        let shader_f16 = features.contains(wgpu::Features::SHADER_F16);
        let tier = if timestamp_queries && multi_draw_indirect && shader_f16 {
            RenderTier::HighEnd
        } else if timestamp_queries
            || indirect_first_instance
            || texture_compression != TextureCompression::None
        {
            RenderTier::Enhanced
        } else {
            RenderTier::Baseline
        };
        Self {
            tier,
            adapter_name: info.name,
            backend: format!("{:?}", info.backend),
            timestamp_queries,
            multi_draw_indirect,
            indirect_first_instance,
            gpu_culling: indirect_first_instance,
            shader_f16,
            texture_compression,
            max_texture_dimension_2d: limits.max_texture_dimension_2d,
            max_bind_groups: limits.max_bind_groups,
            max_storage_buffers_per_shader_stage: limits.max_storage_buffers_per_shader_stage,
        }
    }

    #[must_use]
    pub fn optional_features(&self) -> wgpu::Features {
        let mut features = wgpu::Features::empty();
        features.set(wgpu::Features::TIMESTAMP_QUERY, self.timestamp_queries);
        features.set(
            wgpu::Features::INDIRECT_FIRST_INSTANCE,
            self.indirect_first_instance,
        );
        features.set(wgpu::Features::SHADER_F16, self.shader_f16);
        features
    }
}
