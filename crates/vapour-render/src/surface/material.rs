//! Materials: descriptors, validation, textures, and GPU material state.
//!
//! Authored material JSON arrives here as a [`StandardMaterialDescriptor`], is
//! normalized and validated, and becomes a bind group plus a pipeline kind.

use std::collections::HashMap;

use bytemuck::{Pod, Zeroable};
use serde::Deserialize;
use wgpu::util::DeviceExt;

use crate::GpuContext;

use super::{error::*, pipeline::*};

pub(crate) struct TextureGpu {
    pub(crate) _texture: wgpu::Texture,
    pub(crate) view: wgpu::TextureView,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialTextureSet {
    pub base_color: Option<String>,
    pub normal: Option<String>,
    pub metallic_roughness: Option<String>,
    pub occlusion: Option<String>,
    pub emission: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureAtlasDescriptor {
    pub columns: u32,
    pub rows: u32,
    pub inset: Option<f32>,
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardMaterialDescriptor {
    pub base_color: Option<[f32; 4]>,
    pub emission: Option<[f32; 3]>,
    pub uv_scale: Option<[f32; 2]>,
    pub uv_offset: Option<[f32; 2]>,
    pub normal_scale: Option<f32>,
    pub occlusion_strength: Option<f32>,
    pub textures: Option<MaterialTextureSet>,
    pub filter: Option<String>,
    pub anisotropy: Option<u16>,
    pub address_mode: Option<String>,
    pub atlas: Option<TextureAtlasDescriptor>,
    pub coverage_mode: Option<String>,
    pub alpha_mode: Option<String>,
    pub double_sided: Option<bool>,
    pub depth_write: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum PipelineKind {
    OpaqueCulled,
    OpaqueDoubleSided,
    BlendCulledDepthWrite,
    BlendCulledNoDepthWrite,
    BlendDoubleSidedDepthWrite,
    BlendDoubleSidedNoDepthWrite,
}

impl PipelineKind {
    pub(crate) const ALL: [Self; 6] = [
        Self::OpaqueCulled,
        Self::OpaqueDoubleSided,
        Self::BlendCulledDepthWrite,
        Self::BlendCulledNoDepthWrite,
        Self::BlendDoubleSidedDepthWrite,
        Self::BlendDoubleSidedNoDepthWrite,
    ];

    pub(crate) const fn blended(self) -> bool {
        matches!(
            self,
            Self::BlendCulledDepthWrite
                | Self::BlendCulledNoDepthWrite
                | Self::BlendDoubleSidedDepthWrite
                | Self::BlendDoubleSidedNoDepthWrite
        )
    }

    pub(crate) const fn double_sided(self) -> bool {
        matches!(
            self,
            Self::OpaqueDoubleSided
                | Self::BlendDoubleSidedDepthWrite
                | Self::BlendDoubleSidedNoDepthWrite
        )
    }

    pub(crate) const fn depth_write(self) -> bool {
        matches!(
            self,
            Self::OpaqueCulled
                | Self::OpaqueDoubleSided
                | Self::BlendCulledDepthWrite
                | Self::BlendDoubleSidedDepthWrite
        )
    }
}

#[derive(Debug, Clone)]
pub(crate) struct MaterialDefinition {
    pub(crate) uniforms: MaterialUniforms,
    pub(crate) textures: [Option<String>; 5],
    pub(crate) filter: wgpu::FilterMode,
    pub(crate) anisotropy: u16,
    pub(crate) address_mode: wgpu::AddressMode,
    pub(crate) pipeline: PipelineKind,
}

pub(crate) struct MaterialGpu {
    pub(crate) definition: MaterialDefinition,
    pub(crate) _buffer: wgpu::Buffer,
    pub(crate) bind_group: wgpu::BindGroup,
}

#[derive(Default)]
pub(crate) struct MaterialRegistry {
    pub(crate) materials: Vec<Option<MaterialGpu>>,
    pub(crate) slots: HashMap<String, usize>,
    pub(crate) free: Vec<usize>,
}

impl MaterialRegistry {
    pub(crate) fn slot(&self, id: &str) -> Option<usize> {
        self.slots.get(id).copied()
    }

    pub(crate) fn get(&self, slot: usize) -> Option<&MaterialGpu> {
        self.materials.get(slot).and_then(Option::as_ref)
    }

    pub(crate) fn insert(&mut self, id: &str, material: MaterialGpu) -> usize {
        if let Some(slot) = self.slot(id) {
            self.materials[slot] = Some(material);
            return slot;
        }
        let slot = match self.free.pop() {
            Some(slot) => {
                self.materials[slot] = Some(material);
                slot
            }
            None => {
                self.materials.push(Some(material));
                self.materials.len() - 1
            }
        };
        self.slots.insert(id.to_owned(), slot);
        slot
    }

    pub(crate) fn remove(&mut self, id: &str) -> bool {
        let Some(slot) = self.slots.remove(id) else {
            return false;
        };
        self.materials[slot] = None;
        self.free.push(slot);
        true
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
/// Shared material constants. Field packing mirrors the WGSL `MaterialUniforms`
/// struct exactly; `metallic`, `roughness`, and `alpha_cutoff` are per-instance
/// now and their slots here are inert padding that preserves those offsets.
pub(crate) struct MaterialUniforms {
    pub(crate) base_color: [f32; 4],
    pub(crate) emission_metallic: [f32; 4],
    pub(crate) uv_scale_offset: [f32; 4],
    pub(crate) roughness_normal_occlusion_cutoff: [f32; 4],
    pub(crate) atlas_grid_inset_origin: [f32; 4],
}

// Texture samples multiply material/instance factors. Their fallback must be
// the multiplicative identity; black MR/emission maps would silently disable
// authored metallic surfaces and emissive lamps without texture assets.
pub(crate) const DEFAULT_MATERIAL_TEXTURES: [(&str, [u8; 4], bool); 5] = [
    ("base color", [255, 255, 255, 255], true),
    ("normal", [128, 128, 255, 255], false),
    ("metallic roughness", [255, 255, 255, 255], false),
    ("occlusion", [255, 255, 255, 255], false),
    ("emission", [255, 255, 255, 255], true),
];

pub(crate) fn create_material_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    // The vertex stage reads uv_scale/uv_offset from the material uniform, so the
    // binding must be visible to both stages or pipeline creation is rejected.
    let mut entries = vec![uniform_layout_entry(0, wgpu::ShaderStages::VERTEX_FRAGMENT)];
    for binding in 1..=5 {
        entries.push(wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        });
    }
    entries.push(wgpu::BindGroupLayoutEntry {
        binding: 6,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
        count: None,
    });
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("Vapour material bind group layout"),
        entries: &entries,
    })
}

pub(crate) fn validate_asset_id(kind: &'static str, id: &str) -> Result<(), SurfaceRendererError> {
    let reason = if id.trim().is_empty() {
        Some("identifier is empty")
    } else if id.starts_with("builtin:") {
        Some("the 'builtin:' prefix is reserved")
    } else {
        None
    };
    match (kind, reason) {
        (_, None) => Ok(()),
        ("texture", Some(reason)) => Err(SurfaceRendererError::InvalidTextureId {
            id: id.to_owned(),
            reason,
        }),
        (_, Some(reason)) => Err(SurfaceRendererError::InvalidMaterialId {
            id: id.to_owned(),
            reason,
        }),
    }
}

pub(crate) fn normalize_material(
    id: &str,
    descriptor: &StandardMaterialDescriptor,
) -> Result<MaterialDefinition, SurfaceRendererError> {
    let base_color = descriptor.base_color.unwrap_or([1.0; 4]);
    let emission = descriptor.emission.unwrap_or([1.0; 3]);
    let uv_scale = descriptor.uv_scale.unwrap_or([1.0; 2]);
    let uv_offset = descriptor.uv_offset.unwrap_or([0.0; 2]);
    let normal_scale = descriptor.normal_scale.unwrap_or(1.0);
    let occlusion_strength = descriptor.occlusion_strength.unwrap_or(1.0);
    let atlas = descriptor.atlas.clone().unwrap_or_default();
    let atlas_inset = atlas.inset.unwrap_or(0.0);
    let values = [
        &base_color[..],
        &emission[..],
        &uv_scale[..],
        &uv_offset[..],
        &[normal_scale, occlusion_strength, atlas_inset],
    ];
    if values.into_iter().flatten().any(|value| !value.is_finite()) {
        return Err(SurfaceRendererError::InvalidMaterialId {
            id: id.to_owned(),
            reason: "material constants must be finite",
        });
    }
    let texture_set = descriptor.textures.clone().unwrap_or_default();
    let filter = match descriptor.filter.as_deref().unwrap_or("linear") {
        "linear" => wgpu::FilterMode::Linear,
        "nearest" => wgpu::FilterMode::Nearest,
        _ => {
            return Err(SurfaceRendererError::InvalidMaterialId {
                id: id.to_owned(),
                reason: "filter must be 'nearest' or 'linear'",
            });
        }
    };
    let anisotropy = descriptor.anisotropy.unwrap_or(1);
    if ![1, 2, 4, 8, 16].contains(&anisotropy)
        || (anisotropy > 1 && filter != wgpu::FilterMode::Linear)
    {
        return Err(SurfaceRendererError::InvalidMaterialId {
            id: id.to_owned(),
            reason: "anisotropy must be 1, 2, 4, 8 or 16 and requires linear filtering",
        });
    }
    let address_mode = match descriptor.address_mode.as_deref().unwrap_or("repeat") {
        "repeat" => wgpu::AddressMode::Repeat,
        "clamp" => wgpu::AddressMode::ClampToEdge,
        "mirror" => wgpu::AddressMode::MirrorRepeat,
        _ => {
            return Err(SurfaceRendererError::InvalidMaterialId {
                id: id.to_owned(),
                reason: "addressMode must be repeat, clamp, or mirror",
            });
        }
    };
    if descriptor.atlas.is_some() && (atlas.columns == 0 || atlas.rows == 0) {
        return Err(SurfaceRendererError::InvalidMaterialId {
            id: id.to_owned(),
            reason: "atlas columns and rows must be positive",
        });
    }
    if !(0.0..0.5).contains(&atlas_inset) {
        return Err(SurfaceRendererError::InvalidMaterialId {
            id: id.to_owned(),
            reason: "atlas inset must be in [0, 0.5)",
        });
    }
    let atlas_origin = match atlas.origin.as_deref().unwrap_or("bottom-left") {
        "bottom-left" => 0.0,
        "top-left" => 1.0,
        _ => {
            return Err(SurfaceRendererError::InvalidMaterialId {
                id: id.to_owned(),
                reason: "atlas origin must be bottom-left or top-left",
            });
        }
    };
    let coverage_mode = match descriptor.coverage_mode.as_deref().unwrap_or("alpha") {
        "alpha" => 0.0,
        "sdf" => 1.0,
        _ => {
            return Err(SurfaceRendererError::InvalidMaterialId {
                id: id.to_owned(),
                reason: "coverageMode must be alpha or sdf",
            });
        }
    };
    let blended = match descriptor.alpha_mode.as_deref().unwrap_or("opaque") {
        "opaque" | "mask" => false,
        "blend" => true,
        _ => {
            return Err(SurfaceRendererError::InvalidMaterialId {
                id: id.to_owned(),
                reason: "alphaMode must be opaque, mask, or blend",
            });
        }
    };
    let double_sided = descriptor.double_sided.unwrap_or(false);
    let depth_write = descriptor.depth_write.unwrap_or(!blended);
    let pipeline = match (blended, double_sided, depth_write) {
        (false, false, _) => PipelineKind::OpaqueCulled,
        (false, true, _) => PipelineKind::OpaqueDoubleSided,
        (true, false, true) => PipelineKind::BlendCulledDepthWrite,
        (true, false, false) => PipelineKind::BlendCulledNoDepthWrite,
        (true, true, true) => PipelineKind::BlendDoubleSidedDepthWrite,
        (true, true, false) => PipelineKind::BlendDoubleSidedNoDepthWrite,
    };
    Ok(MaterialDefinition {
        uniforms: MaterialUniforms {
            base_color,
            emission_metallic: [emission[0], emission[1], emission[2], 1.0],
            uv_scale_offset: [uv_scale[0], uv_scale[1], uv_offset[0], uv_offset[1]],
            roughness_normal_occlusion_cutoff: [
                1.0,
                normal_scale,
                occlusion_strength,
                coverage_mode,
            ],
            atlas_grid_inset_origin: [
                atlas.columns as f32,
                atlas.rows as f32,
                atlas_inset,
                atlas_origin,
            ],
        },
        textures: [
            texture_set.base_color,
            texture_set.normal,
            texture_set.metallic_roughness,
            texture_set.occlusion,
            texture_set.emission,
        ],
        filter,
        anisotropy,
        address_mode,
        pipeline,
    })
}

pub(crate) fn create_material_gpu(
    context: &GpuContext,
    layout: &wgpu::BindGroupLayout,
    defaults: &[TextureGpu],
    textures: &HashMap<String, TextureGpu>,
    id: &str,
    definition: MaterialDefinition,
) -> Result<MaterialGpu, SurfaceRendererError> {
    let buffer = context
        .device
        .create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(id),
            contents: bytemuck::bytes_of(&definition.uniforms),
            usage: wgpu::BufferUsages::UNIFORM,
        });
    let mut views = Vec::with_capacity(5);
    for (index, texture_id) in definition.textures.iter().enumerate() {
        let view = match texture_id {
            Some(texture_id) => {
                &textures
                    .get(texture_id)
                    .ok_or_else(|| SurfaceRendererError::UnknownTexture {
                        material: id.to_owned(),
                        texture: texture_id.clone(),
                    })?
                    .view
            }
            None => &defaults[index].view,
        };
        views.push(view);
    }
    let sampler = context.device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some(id),
        address_mode_u: definition.address_mode,
        address_mode_v: definition.address_mode,
        min_filter: definition.filter,
        mag_filter: definition.filter,
        anisotropy_clamp: definition.anisotropy,
        mipmap_filter: match definition.filter {
            wgpu::FilterMode::Linear => wgpu::MipmapFilterMode::Linear,
            wgpu::FilterMode::Nearest => wgpu::MipmapFilterMode::Nearest,
        },
        ..Default::default()
    });
    let mut entries = vec![wgpu::BindGroupEntry {
        binding: 0,
        resource: buffer.as_entire_binding(),
    }];
    for (index, view) in views.iter().enumerate() {
        entries.push(wgpu::BindGroupEntry {
            binding: index as u32 + 1,
            resource: wgpu::BindingResource::TextureView(view),
        });
    }
    entries.push(wgpu::BindGroupEntry {
        binding: 6,
        resource: wgpu::BindingResource::Sampler(&sampler),
    });
    let bind_group = context
        .device
        .create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(id),
            layout,
            entries: &entries,
        });
    Ok(MaterialGpu {
        definition,
        _buffer: buffer,
        bind_group,
    })
}

pub(crate) fn texture_rgba8(
    context: &GpuContext,
    label: &str,
    width: u32,
    height: u32,
    pixels: &[u8],
    srgb: bool,
    mipmaps: bool,
) -> TextureGpu {
    let (mip_level_count, data) = if mipmaps {
        super::texture_mips::mip_chain(width, height, pixels, srgb)
    } else {
        (1, pixels.to_vec())
    };
    let texture = context.device.create_texture_with_data(
        &context.queue,
        &wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: if srgb {
                wgpu::TextureFormat::Rgba8UnormSrgb
            } else {
                wgpu::TextureFormat::Rgba8Unorm
            },
            usage: wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        },
        wgpu::wgt::TextureDataOrder::LayerMajor,
        &data,
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    TextureGpu {
        _texture: texture,
        view,
    }
}

pub(crate) fn solid_texture(
    context: &GpuContext,
    label: &str,
    color: [u8; 4],
    srgb: bool,
) -> TextureGpu {
    texture_rgba8(context, label, 1, 1, &color, srgb, false)
}

#[cfg(test)]
mod mip_material_tests {
    use super::*;
    #[test]
    fn fallback_maps_preserve_metallic_and_emissive_factors() {
        assert_eq!(DEFAULT_MATERIAL_TEXTURES[2].1, [255; 4]);
        assert_eq!(DEFAULT_MATERIAL_TEXTURES[4].1, [255; 4]);
    }
    #[test]
    fn anisotropy_requires_supported_factor_and_linear_filtering() {
        for invalid in [0, 3, 32] {
            assert!(
                normalize_material(
                    "test",
                    &StandardMaterialDescriptor {
                        anisotropy: Some(invalid),
                        ..Default::default()
                    }
                )
                .is_err()
            );
        }
        assert!(
            normalize_material(
                "test",
                &StandardMaterialDescriptor {
                    anisotropy: Some(8),
                    filter: Some("nearest".into()),
                    ..Default::default()
                }
            )
            .is_err()
        );
        assert!(
            normalize_material(
                "test",
                &StandardMaterialDescriptor {
                    anisotropy: Some(8),
                    ..Default::default()
                }
            )
            .is_ok()
        );
    }
}
