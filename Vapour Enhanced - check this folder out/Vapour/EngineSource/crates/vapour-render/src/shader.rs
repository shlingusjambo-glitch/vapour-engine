use std::collections::HashMap;

use naga::{
    ShaderStage as NagaShaderStage,
    valid::{Capabilities, ValidationFlags, Validator},
};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShaderStage {
    Vertex,
    Fragment,
    Compute,
    Task,
    Mesh,
    RayTracing,
}

#[derive(Debug, Clone)]
pub struct ShaderAsset {
    pub name: String,
    pub source: String,
    pub entry_points: Vec<(String, ShaderStage)>,
}

#[derive(Debug, Error)]
pub enum ShaderError {
    #[error("shader '{name}' contains invalid WGSL: {message}")]
    Parse { name: String, message: String },
    #[error("shader '{name}' failed validation: {message}")]
    Validation { name: String, message: String },
    #[error("shader '{0}' is already registered")]
    Duplicate(String),
    #[error("shader '{0}' is not registered")]
    Missing(String),
}

#[derive(Default)]
pub struct ShaderLibrary {
    assets: HashMap<String, ShaderAsset>,
}

impl ShaderLibrary {
    pub fn register(
        &mut self,
        name: impl Into<String>,
        source: impl Into<String>,
    ) -> Result<(), ShaderError> {
        let name = name.into();
        if self.assets.contains_key(&name) {
            return Err(ShaderError::Duplicate(name));
        }
        let source = source.into();
        let module = naga::front::wgsl::parse_str(&source).map_err(|error| ShaderError::Parse {
            name: name.clone(),
            message: error.emit_to_string(&source),
        })?;
        Validator::new(ValidationFlags::all(), Capabilities::all())
            .validate(&module)
            .map_err(|error| ShaderError::Validation {
                name: name.clone(),
                message: error.to_string(),
            })?;
        let entry_points = module
            .entry_points
            .iter()
            .map(|entry| {
                let stage = match entry.stage {
                    NagaShaderStage::Vertex => ShaderStage::Vertex,
                    NagaShaderStage::Fragment => ShaderStage::Fragment,
                    NagaShaderStage::Compute => ShaderStage::Compute,
                    NagaShaderStage::Task => ShaderStage::Task,
                    NagaShaderStage::Mesh => ShaderStage::Mesh,
                    NagaShaderStage::RayGeneration
                    | NagaShaderStage::Miss
                    | NagaShaderStage::AnyHit
                    | NagaShaderStage::ClosestHit => ShaderStage::RayTracing,
                };
                (entry.name.clone(), stage)
            })
            .collect();
        self.assets.insert(
            name.clone(),
            ShaderAsset {
                name,
                source,
                entry_points,
            },
        );
        Ok(())
    }

    pub fn standard() -> Result<Self, ShaderError> {
        let mut library = Self::default();
        library.register("vapour.standard-pbr", crate::STANDARD_PBR_SHADER)?;
        library.register("vapour.shadow-depth", crate::SHADOW_DEPTH_SHADER)?;
        library.register("vapour.tonemap", crate::TONEMAP_SHADER)?;
        library.register("vapour.procedural-sky", crate::PROCEDURAL_SKY_SHADER)?;
        library.register("vapour.decal", crate::DECAL_SHADER)?;
        library.register("vapour.ibl-prefilter", crate::IBL_PREFILTER_SHADER)?;
        library.register("vapour.ibl-brdf-lut", crate::IBL_BRDF_LUT_SHADER)?;
        library.register("vapour.cull-instances", crate::CULL_INSTANCES_SHADER)?;
        library.register("vapour.particles-sim", crate::PARTICLES_SIM_SHADER)?;
        library.register("vapour.particles", crate::PARTICLES_SHADER)?;
        Ok(library)
    }

    pub fn get(&self, name: &str) -> Result<&ShaderAsset, ShaderError> {
        self.assets
            .get(name)
            .ok_or_else(|| ShaderError::Missing(name.to_owned()))
    }

    pub fn create_module(
        &self,
        device: &wgpu::Device,
        name: &str,
    ) -> Result<wgpu::ShaderModule, ShaderError> {
        let asset = self.get(name)?;
        Ok(device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(&asset.name),
            source: wgpu::ShaderSource::Wgsl(asset.source.as_str().into()),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_standard_pbr_and_discovers_entry_points() {
        let library = ShaderLibrary::standard().unwrap();
        let shader = library.get("vapour.standard-pbr").unwrap();
        assert!(
            shader
                .entry_points
                .contains(&("vertex_main".into(), ShaderStage::Vertex))
        );
        let shadow = library.get("vapour.shadow-depth").unwrap();
        assert!(
            shadow
                .entry_points
                .contains(&("vertex_main".into(), ShaderStage::Vertex))
        );
        assert!(
            shader
                .entry_points
                .contains(&("fragment_main".into(), ShaderStage::Fragment))
        );
        assert!(
            shader
                .source
                .contains("var output_color = ambient + direct + emission;")
        );
        let cull = library.get("vapour.cull-instances").unwrap();
        assert!(
            cull.entry_points
                .contains(&("cull".into(), ShaderStage::Compute))
        );
        let sim = library.get("vapour.particles-sim").unwrap();
        assert!(
            sim.entry_points
                .contains(&("spawn".into(), ShaderStage::Compute))
        );
        assert!(
            sim.entry_points
                .contains(&("update".into(), ShaderStage::Compute))
        );
        let particles = library.get("vapour.particles").unwrap();
        assert!(
            particles
                .entry_points
                .contains(&("vertex_main".into(), ShaderStage::Vertex))
        );
        let tonemap = library.get("vapour.tonemap").unwrap();
        assert!(
            tonemap
                .entry_points
                .contains(&("fragment_main".into(), ShaderStage::Fragment))
        );
        let sky = library.get("vapour.procedural-sky").unwrap();
        assert!(
            sky.entry_points
                .contains(&("vertex_main".into(), ShaderStage::Vertex))
        );
        assert!(
            sky.entry_points
                .contains(&("fragment_main".into(), ShaderStage::Fragment))
        );
        assert!(sky.source.contains("frame.inverse_view_projection"));
        assert!(
            shader
                .source
                .contains("return vec4<f32>(output_color, sampled_base.a);")
        );
        assert!(
            shader
                .source
                .contains("tangent_normal.xy * material.normal_scale"),
            "normal strength must be applied in tangent space"
        );
        assert!(
            shader
                .source
                .contains("mat3x3<f32>(tangent, bitangent, input.world_normal)"),
            "normal maps must be transformed through an authored TBN frame"
        );
        assert!(
            shader
                .source
                .contains("(cell.y + (1.0 - repeated_uv.y)) / rows"),
            "top-left atlases must preserve WebGPU's uploaded row order"
        );
        assert!(
            !shader.source.contains("DEBUG:"),
            "a diagnostic fragment return must never replace shipping PBR output"
        );
    }

    #[test]
    fn reports_source_context_for_invalid_wgsl() {
        let mut library = ShaderLibrary::default();
        let error = library
            .register("broken.shader", "@vertex fn nope( {")
            .unwrap_err();
        assert!(error.to_string().contains("invalid WGSL"));
    }
}
