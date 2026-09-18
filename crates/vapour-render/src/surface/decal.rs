//! Box-projected decals.
//!
//! A decal is a unit cube placed by a model matrix. The decal pass draws that
//! cube after the opaque scene, reconstructs each covered pixel's world
//! position from the depth buffer, and projects the atlas region onto pixels
//! whose position falls inside the box, along the box's local -Z. Decals
//! read depth but never write it, so they layer over any opaque surface
//! without touching the geometry underneath.

use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec2, Vec3};

use super::error::*;

/// Floats per decal in a packed submission: model matrix (16), atlas region
/// `u0, v0, u1, v1` (4), linear RGBA tint (4), then
/// `[opacity, angle cutoff cosine, angle softness, z fade]` (4).
pub const DECAL_STRIDE: usize = 28;
/// A frame's decal budget; a submission past it is rejected, not truncated.
pub const MAX_DECALS: usize = 4096;

/// The projected surface coordinate of `world` inside the decal box placed
/// by `model`: `(u, v)` in [0, 1] and the local depth in [-0.5, 0.5], or
/// `None` when the point is outside the box. This is the CPU reference for
/// `decal.wgsl`: +X is right and +Y is up on the projected image, and `v`
/// runs down so an upright decal shows its atlas the right way up.
#[must_use]
pub fn decal_local_uv(model: Mat4, world: Vec3) -> Option<(Vec2, f32)> {
    if model.determinant().abs() <= f32::EPSILON {
        return None;
    }
    let local = model.inverse().transform_point3(world);
    if local.abs().max_element() > 0.5 {
        return None;
    }
    Some((Vec2::new(local.x + 0.5, 0.5 - local.y), local.z))
}

/// Maps a decal-local `(u, v)` into its atlas rectangle `[u0, v0, u1, v1]`.
#[must_use]
pub fn decal_atlas_uv(local_uv: Vec2, region: [f32; 4]) -> Vec2 {
    Vec2::new(
        region[0] + (region[2] - region[0]) * local_uv.x,
        region[1] + (region[3] - region[1]) * local_uv.y,
    )
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub(crate) struct DecalInstance {
    pub(crate) model: [[f32; 4]; 4],
    pub(crate) inverse: [[f32; 4]; 4],
    pub(crate) region: [f32; 4],
    pub(crate) tint: [f32; 4],
    pub(crate) params: [f32; 4],
}

impl DecalInstance {
    pub(crate) const ATTRIBUTES: [wgpu::VertexAttribute; 11] = wgpu::vertex_attr_array![
        1 => Float32x4,
        2 => Float32x4,
        3 => Float32x4,
        4 => Float32x4,
        5 => Float32x4,
        6 => Float32x4,
        7 => Float32x4,
        8 => Float32x4,
        9 => Float32x4,
        10 => Float32x4,
        11 => Float32x4
    ];

    pub(crate) fn layout() -> wgpu::VertexBufferLayout<'static> {
        wgpu::VertexBufferLayout {
            array_stride: std::mem::size_of::<Self>() as wgpu::BufferAddress,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &Self::ATTRIBUTES,
        }
    }
}

/// Validates and unpacks a decal submission. The atlas texture is resolved by
/// the caller; this only checks the numbers.
pub(crate) fn decode_decals(packed: &[f32]) -> Result<Vec<DecalInstance>, SurfaceRendererError> {
    if !packed.len().is_multiple_of(DECAL_STRIDE) {
        return Err(SurfaceRendererError::FrameArrayLength {
            field: "decals",
            actual: packed.len(),
            expected: packed.len().next_multiple_of(DECAL_STRIDE),
        });
    }
    let count = packed.len() / DECAL_STRIDE;
    if count > MAX_DECALS {
        return Err(SurfaceRendererError::InvalidDecal {
            index: count,
            reason: format!("a frame may carry at most {MAX_DECALS} decals"),
        });
    }
    finite("decals", packed)?;
    let mut decals = Vec::with_capacity(count);
    for (index, record) in packed.as_chunks::<DECAL_STRIDE>().0.iter().enumerate() {
        let mut columns = [0.0_f32; 16];
        columns.copy_from_slice(&record[..16]);
        let model = Mat4::from_cols_array(&columns);
        if model.determinant().abs() <= f32::EPSILON {
            return Err(SurfaceRendererError::InvalidDecal {
                index,
                reason: "model matrix is singular; a decal box needs volume".into(),
            });
        }
        let region = [record[16], record[17], record[18], record[19]];
        if region.iter().any(|value| !(0.0..=1.0).contains(value)) {
            return Err(SurfaceRendererError::InvalidDecal {
                index,
                reason: "atlas region must lie within [0, 1]".into(),
            });
        }
        let tint = [record[20], record[21], record[22], record[23]];
        if tint.iter().any(|value| *value < 0.0) {
            return Err(SurfaceRendererError::InvalidDecal {
                index,
                reason: "tint must be non-negative".into(),
            });
        }
        let params = [record[24], record[25], record[26], record[27]];
        if !(0.0..=1.0).contains(&params[0]) {
            return Err(SurfaceRendererError::InvalidDecal {
                index,
                reason: "opacity must be in [0, 1]".into(),
            });
        }
        if !(0.0..=1.0).contains(&params[1]) || !(0.0..=1.0).contains(&params[2]) {
            return Err(SurfaceRendererError::InvalidDecal {
                index,
                reason: "angle cutoff and softness are cosines in [0, 1]".into(),
            });
        }
        if !(0.0..=1.0).contains(&params[3]) {
            return Err(SurfaceRendererError::InvalidDecal {
                index,
                reason: "z fade must be in [0, 1]".into(),
            });
        }
        decals.push(DecalInstance {
            model: model.to_cols_array_2d(),
            inverse: model.inverse().to_cols_array_2d(),
            region,
            tint,
            params,
        });
    }
    Ok(decals)
}

pub(crate) struct DecalGpu {
    pub(crate) layout: wgpu::BindGroupLayout,
    pub(crate) pipeline: wgpu::RenderPipeline,
    pub(crate) sampler: wgpu::Sampler,
    pub(crate) instance_buffer: wgpu::Buffer,
    pub(crate) capacity: usize,
    pub(crate) count: u32,
    /// Texture identifier the decals sample, or `None` for the default white
    /// map (tint-only decals).
    pub(crate) atlas: Option<String>,
}

impl DecalGpu {
    pub(crate) fn new(
        device: &wgpu::Device,
        frame_layout: &wgpu::BindGroupLayout,
        shader: &wgpu::ShaderModule,
        format: wgpu::TextureFormat,
    ) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Vapour decal layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Vapour decal pipeline layout"),
            bind_group_layouts: &[Some(frame_layout), Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Vapour decal pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: shader,
                entry_point: Some("vertex_main"),
                compilation_options: Default::default(),
                buffers: &[
                    Some(super::mesh::position_only_layout()),
                    Some(DecalInstance::layout()),
                ],
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                front_face: wgpu::FrontFace::Ccw,
                // Draw the box's back faces so a camera inside the volume
                // still covers every pixel the decal can touch.
                cull_mode: Some(wgpu::Face::Front),
                ..Default::default()
            },
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: shader,
                entry_point: Some("fragment_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Vapour decal sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        let capacity = 16;
        Self {
            layout,
            pipeline,
            sampler,
            instance_buffer: create_decal_buffer(device, capacity),
            capacity,
            count: 0,
            atlas: None,
        }
    }

    pub(crate) fn upload(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        decals: &[DecalInstance],
    ) {
        if decals.len() > self.capacity {
            self.capacity = decals.len().next_power_of_two();
            self.instance_buffer = create_decal_buffer(device, self.capacity);
        }
        if !decals.is_empty() {
            queue.write_buffer(&self.instance_buffer, 0, bytemuck::cast_slice(decals));
        }
        self.count = decals.len() as u32;
    }

    pub(crate) fn bind_group(
        &self,
        device: &wgpu::Device,
        depth: &wgpu::TextureView,
        atlas: &wgpu::TextureView,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Vapour decal bind group"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(depth),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(atlas),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        })
    }
}

fn create_decal_buffer(device: &wgpu::Device, capacity: usize) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Vapour decal instances"),
        size: (capacity * std::mem::size_of::<DecalInstance>()) as u64,
        usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_decal_projection_maps_world_points_to_the_expected_local_uv() {
        // A 4 wide, 2 tall, 1 deep box at x = 2: its centre is (2, 0, 0).
        let model = Mat4::from_translation(Vec3::new(2.0, 0.0, 0.0))
            * Mat4::from_scale(Vec3::new(4.0, 2.0, 1.0));
        let (uv, depth) = decal_local_uv(model, Vec3::new(3.0, 0.5, 0.0)).unwrap();
        assert!((uv.x - 0.75).abs() < 1e-6 && (uv.y - 0.25).abs() < 1e-6);
        assert_eq!(depth, 0.0);
        // The centre projects to the middle; the top-left corner to (0, 0).
        let (centre, _) = decal_local_uv(model, Vec3::new(2.0, 0.0, 0.25)).unwrap();
        assert!((centre - Vec2::splat(0.5)).length() < 1e-6);
        let (corner, _) = decal_local_uv(model, Vec3::new(0.0, 1.0, -0.5)).unwrap();
        assert!(corner.length() < 1e-6);
        // Just outside any face is rejected.
        assert!(decal_local_uv(model, Vec3::new(4.01, 0.0, 0.0)).is_none());
        assert!(decal_local_uv(model, Vec3::new(2.0, 0.0, 0.51)).is_none());
        // A box rotated 90° about Y has its local +X along world -Z, so a
        // point at world z = -0.25 sits a quarter of the way right of centre.
        let rotated = Mat4::from_rotation_y(std::f32::consts::FRAC_PI_2);
        let (uv, depth) = decal_local_uv(rotated, Vec3::new(0.0, 0.0, -0.25)).unwrap();
        assert!(
            (uv.x - 0.75).abs() < 1e-6 && (uv.y - 0.5).abs() < 1e-6,
            "{uv}"
        );
        assert!(depth.abs() < 1e-6);
        // Atlas regions remap the projected coordinate.
        let atlas = decal_atlas_uv(Vec2::new(0.75, 0.25), [0.5, 0.0, 1.0, 0.5]);
        assert!((atlas - Vec2::new(0.875, 0.125)).length() < 1e-6);
        assert!(decal_local_uv(Mat4::ZERO, Vec3::ZERO).is_none());
    }

    #[test]
    fn decal_records_are_validated_before_upload() {
        let mut record = vec![0.0_f32; DECAL_STRIDE];
        record[..16].copy_from_slice(&Mat4::IDENTITY.to_cols_array());
        record[16..20].copy_from_slice(&[0.0, 0.0, 1.0, 1.0]);
        record[20..24].copy_from_slice(&[1.0; 4]);
        record[24..28].copy_from_slice(&[1.0, 0.3, 0.2, 0.1]);
        let decoded = decode_decals(&record).unwrap();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].inverse, Mat4::IDENTITY.to_cols_array_2d());
        assert!(decode_decals(&[]).unwrap().is_empty());
        assert!(matches!(
            decode_decals(&record[..27]),
            Err(SurfaceRendererError::FrameArrayLength {
                field: "decals",
                ..
            })
        ));
        let mut singular = record.clone();
        singular[0] = 0.0;
        assert!(matches!(
            decode_decals(&singular),
            Err(SurfaceRendererError::InvalidDecal { index: 0, .. })
        ));
        let mut region = record.clone();
        region[18] = 1.5;
        assert!(decode_decals(&region).is_err());
        let mut opacity = record.clone();
        opacity[24] = 2.0;
        assert!(decode_decals(&opacity).is_err());
        let mut nan = record;
        nan[21] = f32::NAN;
        assert!(decode_decals(&nan).is_err());
        assert_eq!(std::mem::size_of::<DecalInstance>(), 44 * 4);
        assert_eq!(DecalInstance::ATTRIBUTES.len(), 11);
    }
}
