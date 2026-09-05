//! HDR scene target and final presentation pass.

use bytemuck::{Pod, Zeroable};

pub(crate) const HDR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ToneMapping {
    None,
    Reinhard,
    #[default]
    Aces,
}

impl ToneMapping {
    const fn shader_id(self) -> u32 {
        match self {
            Self::None => 0,
            Self::Reinhard => 1,
            Self::Aces => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PostProcessSettings {
    pub exposure: f32,
    pub tone_mapping: ToneMapping,
    pub bloom_intensity: f32,
    pub bloom_threshold: f32,
    pub bloom_scatter: f32,
    pub saturation: f32,
    pub contrast: f32,
    pub vignette: f32,
    pub chromatic_aberration: f32,
}

impl Default for PostProcessSettings {
    fn default() -> Self {
        Self {
            exposure: 1.0,
            tone_mapping: ToneMapping::Aces,
            bloom_intensity: 0.0,
            bloom_threshold: 1.0,
            bloom_scatter: 0.5,
            saturation: 1.0,
            contrast: 1.0,
            vignette: 0.0,
            chromatic_aberration: 0.0,
        }
    }
}

impl PostProcessSettings {
    pub fn validate(self) -> Result<Self, &'static str> {
        if !self.exposure.is_finite() || self.exposure < 0.0 || self.exposure > 64.0 {
            return Err("exposure must be finite and in [0, 64]");
        }
        validate_effect(
            self.bloom_intensity,
            10.0,
            "bloom intensity must be finite and in [0, 10]",
        )?;
        validate_effect(
            self.bloom_threshold,
            64.0,
            "bloom threshold must be finite and in [0, 64]",
        )?;
        validate_effect(
            self.bloom_scatter,
            1.0,
            "bloom scatter must be finite and in [0, 1]",
        )?;
        validate_effect(
            self.saturation,
            4.0,
            "saturation must be finite and in [0, 4]",
        )?;
        validate_effect(self.contrast, 4.0, "contrast must be finite and in [0, 4]")?;
        validate_effect(self.vignette, 1.0, "vignette must be finite and in [0, 1]")?;
        validate_effect(
            self.chromatic_aberration,
            1.0,
            "chromatic aberration must be finite and in [0, 1]",
        )?;
        Ok(self)
    }
}

fn validate_effect(value: f32, maximum: f32, message: &'static str) -> Result<(), &'static str> {
    if !value.is_finite() || value < 0.0 || value > maximum {
        Err(message)
    } else {
        Ok(())
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PostUniforms {
    exposure_tone_bloom: [f32; 4],
    bloom_color: [f32; 4],
    lens: [f32; 4],
}

pub(crate) struct HdrTarget {
    pub(crate) _texture: wgpu::Texture,
    pub(crate) view: wgpu::TextureView,
}

impl HdrTarget {
    pub(crate) fn new(device: &wgpu::Device, width: u32, height: u32) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Vapour HDR scene color"),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: HDR_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        Self {
            _texture: texture,
            view,
        }
    }
}

pub(crate) struct PostProcessGpu {
    pub(crate) pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    uniforms: wgpu::Buffer,
}

impl PostProcessGpu {
    pub(crate) fn new(device: &wgpu::Device, surface_format: wgpu::TextureFormat) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Vapour tone-map layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                super::pipeline::uniform_layout_entry(2, wgpu::ShaderStages::FRAGMENT),
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Vapour tone-map pipeline layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("Vapour tone-map shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../../shaders/tonemap.wgsl").into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Vapour tone-map pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vertex_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fragment_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: surface_format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Vapour HDR sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let uniforms =
            super::pipeline::uniform_buffer::<PostUniforms>(device, "Vapour tone-map uniforms");
        Self {
            pipeline,
            layout,
            sampler,
            uniforms,
        }
    }

    pub(crate) fn bind_group(
        &self,
        device: &wgpu::Device,
        view: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Vapour tone-map bind group"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: self.uniforms.as_entire_binding(),
                },
            ],
        })
    }

    pub(crate) fn update(&self, queue: &wgpu::Queue, settings: PostProcessSettings) {
        queue.write_buffer(
            &self.uniforms,
            0,
            bytemuck::bytes_of(&PostUniforms {
                exposure_tone_bloom: [
                    settings.exposure,
                    settings.tone_mapping.shader_id() as f32,
                    settings.bloom_intensity,
                    settings.bloom_threshold,
                ],
                bloom_color: [
                    settings.bloom_scatter,
                    settings.saturation,
                    settings.contrast,
                    settings.vignette,
                ],
                lens: [settings.chromatic_aberration, 0.0, 0.0, 0.0],
            }),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_hdr_settings() {
        assert!(PostProcessSettings::default().validate().is_ok());
        assert!(
            PostProcessSettings {
                exposure: f32::NAN,
                ..Default::default()
            }
            .validate()
            .is_err()
        );
        assert!(
            PostProcessSettings {
                exposure: 65.0,
                tone_mapping: ToneMapping::None,
                ..Default::default()
            }
            .validate()
            .is_err()
        );
        assert!(
            PostProcessSettings {
                bloom_scatter: 1.1,
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }
    #[test]
    fn tone_mapping_ids_are_stable() {
        assert_eq!(ToneMapping::None.shader_id(), 0);
        assert_eq!(ToneMapping::Reinhard.shader_id(), 1);
        assert_eq!(ToneMapping::Aces.shader_id(), 2);
    }
}
