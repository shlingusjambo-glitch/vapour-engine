//! Environment maps and image-based lighting.
//!
//! One environment cubemap lights every layer of a frame. It arrives either as
//! six RGBA8 faces or by capturing the procedural sky, and is convolved on the
//! GPU into the two split-sum inputs the material pass samples: a
//! GGX-prefiltered specular chain (one mip per roughness step) and a
//! cosine-weighted irradiance cube. The BRDF lookup completing the split sum
//! is rendered once at startup and never changes.

use glam::{Mat3, Vec3};
use wgpu::util::DeviceExt;

use super::{material::TextureGpu, pipeline::uniform_layout_entry, texture_mips::mip_chain};

/// All convolved targets and the BRDF lookup are scene-linear half floats,
/// the same as the HDR scene target they feed.
pub(crate) const IBL_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// Sampled by materials, rendered by the convolution, and copyable so tests
/// and capture tools can read them back.
pub(crate) const IBL_TARGET_USAGE: wgpu::TextureUsages = wgpu::TextureUsages::TEXTURE_BINDING
    .union(wgpu::TextureUsages::RENDER_ATTACHMENT)
    .union(wgpu::TextureUsages::COPY_SRC);
/// The prefiltered specular chain stops here rather than at 1x1: below this a
/// face is too coarse to carry direction at all, and roughness 1 already maps
/// to it.
pub const PREFILTER_MIN_FACE_SIZE: u32 = 4;
pub const IRRADIANCE_FACE_SIZE: u32 = 32;
pub const BRDF_LUT_SIZE: u32 = 128;
/// Face size used when the environment is captured from the procedural sky.
pub const SKY_CAPTURE_FACE_SIZE: u32 = 128;
/// Largest uploadable face, chosen so the source mip chain plus the
/// prefiltered chain stay well inside a baseline adapter's texture budget.
pub const MAX_ENVIRONMENT_FACE_SIZE: u32 = 2048;

/// Mips in the prefiltered specular chain for a cubemap of `face_size`:
/// every power-of-two level from the full face down to
/// [`PREFILTER_MIN_FACE_SIZE`], and never fewer than one.
#[must_use]
pub const fn prefiltered_mip_count(face_size: u32) -> u32 {
    let mut count = 1;
    let mut size = face_size;
    while size / 2 >= PREFILTER_MIN_FACE_SIZE {
        size /= 2;
        count += 1;
    }
    count
}

/// The roughness a prefiltered mip represents: mips spread linearly over
/// [0, 1], so the shader's `roughness * (count - 1)` lands exactly on a level.
#[must_use]
pub fn mip_roughness(mip: u32, mip_count: u32) -> f32 {
    if mip_count <= 1 {
        0.0
    } else {
        mip as f32 / (mip_count - 1) as f32
    }
}

/// Full mip count for a square texture down to 1x1.
#[must_use]
pub const fn full_mip_count(size: u32) -> u32 {
    if size == 0 { 1 } else { size.ilog2() + 1 }
}

/// World direction through the centre of texel `(u, v)` (both in [0, 1],
/// `v` increasing downwards) of cube `face`, in the standard WebGPU/Vulkan
/// cubemap parameterisation. `ibl_prefilter.wgsl`'s `face_direction` is the
/// same table.
#[must_use]
pub fn cube_face_direction(face: u32, u: f32, v: f32) -> Vec3 {
    let u = u * 2.0 - 1.0;
    let v = v * 2.0 - 1.0;
    match face {
        0 => Vec3::new(1.0, -v, -u),
        1 => Vec3::new(-1.0, -v, u),
        2 => Vec3::new(u, 1.0, v),
        3 => Vec3::new(u, -1.0, -v),
        4 => Vec3::new(u, -v, 1.0),
        _ => Vec3::new(-u, -v, -1.0),
    }
    .normalize()
}

/// The face and `(u, v)` a cube sampler reads for `direction`: the inverse of
/// [`cube_face_direction`], following the texture-cube selection rules the
/// GPU applies (largest-magnitude axis picks the face).
#[must_use]
pub fn cube_face_uv(direction: Vec3) -> (u32, f32, f32) {
    let abs = direction.abs();
    let (face, sc, tc, ma) = if abs.x >= abs.y && abs.x >= abs.z {
        if direction.x > 0.0 {
            (0, -direction.z, -direction.y, abs.x)
        } else {
            (1, direction.z, -direction.y, abs.x)
        }
    } else if abs.y >= abs.z {
        if direction.y > 0.0 {
            (2, direction.x, direction.z, abs.y)
        } else {
            (3, direction.x, -direction.z, abs.y)
        }
    } else if direction.z > 0.0 {
        (4, direction.x, -direction.y, abs.z)
    } else {
        (5, -direction.x, -direction.y, abs.z)
    };
    (face, (sc / ma + 1.0) * 0.5, (tc / ma + 1.0) * 0.5)
}

/// Maps a fullscreen triangle's clip-space `(x, y, 1)` to the world direction
/// through that pixel of cube `face`, so rendering the sky with this as the
/// inverse view-projection's rotation writes the face in sampling
/// orientation directly. Clip y is up while texel rows run down, hence the
/// flipped second column.
#[must_use]
pub fn cube_face_ray_basis(face: u32) -> Mat3 {
    // Columns: what clip x, clip y, and the constant 1 contribute.
    match face {
        0 => Mat3::from_cols(Vec3::new(0.0, 0.0, -1.0), Vec3::new(0.0, 1.0, 0.0), Vec3::X),
        1 => Mat3::from_cols(
            Vec3::new(0.0, 0.0, 1.0),
            Vec3::new(0.0, 1.0, 0.0),
            Vec3::NEG_X,
        ),
        2 => Mat3::from_cols(Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 0.0, -1.0), Vec3::Y),
        3 => Mat3::from_cols(
            Vec3::new(1.0, 0.0, 0.0),
            Vec3::new(0.0, 0.0, 1.0),
            Vec3::NEG_Y,
        ),
        4 => Mat3::from_cols(Vec3::new(1.0, 0.0, 0.0), Vec3::new(0.0, 1.0, 0.0), Vec3::Z),
        _ => Mat3::from_cols(
            Vec3::new(-1.0, 0.0, 0.0),
            Vec3::new(0.0, 1.0, 0.0),
            Vec3::NEG_Z,
        ),
    }
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct PrefilterParams {
    face_mode_roughness_size: [f32; 4],
}

/// A cubemap with every mip and face view the convolution passes need.
pub(crate) struct CubemapGpu {
    pub(crate) texture: wgpu::Texture,
    /// Cube view over every mip, for sampling.
    pub(crate) view: wgpu::TextureView,
    pub(crate) face_size: u32,
    pub(crate) mip_count: u32,
}

impl CubemapGpu {
    pub(crate) fn new(
        device: &wgpu::Device,
        label: &str,
        face_size: u32,
        mip_count: u32,
        usage: wgpu::TextureUsages,
    ) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: face_size,
                height: face_size,
                depth_or_array_layers: 6,
            },
            mip_level_count: mip_count,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: IBL_FORMAT,
            usage,
            view_formats: &[],
        });
        Self::from_texture(texture, face_size, mip_count)
    }

    fn from_texture(texture: wgpu::Texture, face_size: u32, mip_count: u32) -> Self {
        let view = texture.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::Cube),
            ..Default::default()
        });
        Self {
            texture,
            view,
            face_size,
            mip_count,
        }
    }

    /// A render-attachment view of one face at one mip.
    pub(crate) fn face_view(&self, face: u32, mip: u32) -> wgpu::TextureView {
        self.texture.create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::D2),
            base_mip_level: mip,
            mip_level_count: Some(1),
            base_array_layer: face,
            array_layer_count: Some(1),
            ..Default::default()
        })
    }
}

pub(crate) struct EnvironmentGpu {
    prefilter_layout: wgpu::BindGroupLayout,
    prefilter_pipeline: wgpu::RenderPipeline,
    pub(crate) sampler: wgpu::Sampler,
    pub(crate) brdf_lut: TextureGpu,
    pub(crate) specular: CubemapGpu,
    pub(crate) irradiance: CubemapGpu,
    /// False until an environment is uploaded or captured; the material pass
    /// then keeps its analytic sky-gradient ambient instead.
    pub(crate) live: bool,
    pub(crate) intensity: f32,
}

impl EnvironmentGpu {
    pub(crate) fn new(device: &wgpu::Device, queue: &wgpu::Queue) -> Self {
        let prefilter_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Vapour IBL prefilter layout"),
            entries: &[
                uniform_layout_entry(0, wgpu::ShaderStages::FRAGMENT),
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::Cube,
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
        let prefilter_pipeline = fullscreen_pipeline(
            device,
            "Vapour IBL prefilter",
            &[Some(&prefilter_layout)],
            crate::IBL_PREFILTER_SHADER,
        );
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Vapour environment sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        let brdf_lut = render_brdf_lut(device, queue);
        let usage = IBL_TARGET_USAGE;
        Self {
            prefilter_layout,
            prefilter_pipeline,
            sampler,
            brdf_lut,
            specular: CubemapGpu::new(device, "Vapour environment specular", 1, 1, usage),
            irradiance: CubemapGpu::new(device, "Vapour environment irradiance", 1, 1, usage),
            live: false,
            intensity: 1.0,
        }
    }

    /// Builds a mipmapped source cubemap from six RGBA8 faces, in +X, -X, +Y,
    /// -Y, +Z, -Z order, each `face_size * face_size * 4` bytes. Colour mips
    /// average in linear light so a bright sun does not darken as it shrinks.
    pub(crate) fn source_from_rgba8(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        face_size: u32,
        faces: &[u8],
        srgb: bool,
    ) -> CubemapGpu {
        let face_bytes = (face_size * face_size * 4) as usize;
        let mut data = Vec::with_capacity(face_bytes * 6 * 2);
        let mut mip_count = 1;
        for face in 0..6 {
            let (levels, chain) = mip_chain(
                face_size,
                face_size,
                &faces[face * face_bytes..(face + 1) * face_bytes],
                srgb,
            );
            mip_count = levels;
            data.extend(chain);
        }
        let texture = device.create_texture_with_data(
            queue,
            &wgpu::TextureDescriptor {
                label: Some("Vapour environment source"),
                size: wgpu::Extent3d {
                    width: face_size,
                    height: face_size,
                    depth_or_array_layers: 6,
                },
                mip_level_count: mip_count,
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
        CubemapGpu::from_texture(texture, face_size, mip_count)
    }

    /// Convolves `source` into the specular chain and irradiance cube, and
    /// makes the environment live. Submits its own command buffer.
    pub(crate) fn convolve(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        source: &CubemapGpu,
        intensity: f32,
    ) {
        let usage = IBL_TARGET_USAGE;
        let specular_mips = prefiltered_mip_count(source.face_size);
        self.specular = CubemapGpu::new(
            device,
            "Vapour environment specular",
            source.face_size,
            specular_mips,
            usage,
        );
        self.irradiance = CubemapGpu::new(
            device,
            "Vapour environment irradiance",
            IRRADIANCE_FACE_SIZE,
            1,
            usage,
        );
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Vapour IBL convolution"),
        });
        let mut passes = Vec::new();
        for mip in 0..specular_mips {
            for face in 0..6 {
                passes.push((
                    face,
                    mip,
                    0.0,
                    mip_roughness(mip, specular_mips),
                    &self.specular,
                ));
            }
        }
        for face in 0..6 {
            passes.push((face, 0, 1.0, 1.0, &self.irradiance));
        }
        for (face, mip, mode, roughness, target) in passes {
            let params = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("Vapour IBL prefilter params"),
                contents: bytemuck::bytes_of(&PrefilterParams {
                    face_mode_roughness_size: [
                        face as f32,
                        mode,
                        roughness,
                        source.face_size as f32,
                    ],
                }),
                usage: wgpu::BufferUsages::UNIFORM,
            });
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Vapour IBL prefilter bind group"),
                layout: &self.prefilter_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: params.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(&source.view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::Sampler(&self.sampler),
                    },
                ],
            });
            let view = target.face_view(face, mip);
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("Vapour IBL prefilter pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            pass.set_pipeline(&self.prefilter_pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        queue.submit([encoder.finish()]);
        self.live = true;
        self.intensity = intensity;
    }

    pub(crate) fn clear(&mut self) {
        self.live = false;
    }

    /// `[live, highest specular mip, intensity, reserved]` for the frame
    /// uniforms.
    pub(crate) fn params(&self) -> [f32; 4] {
        [
            if self.live { 1.0 } else { 0.0 },
            self.specular.mip_count.saturating_sub(1) as f32,
            self.intensity,
            0.0,
        ]
    }
}

pub(crate) fn fullscreen_pipeline(
    device: &wgpu::Device,
    label: &str,
    bind_group_layouts: &[Option<&wgpu::BindGroupLayout>],
    source: &str,
) -> wgpu::RenderPipeline {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(label),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    });
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(label),
        bind_group_layouts,
        immediate_size: 0,
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vertex_main"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: super::pipeline::fullscreen_primitive_state(),
        depth_stencil: None,
        multisample: Default::default(),
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fragment_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: IBL_FORMAT,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

fn render_brdf_lut(device: &wgpu::Device, queue: &wgpu::Queue) -> TextureGpu {
    let pipeline = fullscreen_pipeline(device, "Vapour BRDF LUT", &[], crate::IBL_BRDF_LUT_SHADER);
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Vapour BRDF LUT"),
        size: wgpu::Extent3d {
            width: BRDF_LUT_SIZE,
            height: BRDF_LUT_SIZE,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: IBL_FORMAT,
        usage: IBL_TARGET_USAGE,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("Vapour BRDF LUT"),
    });
    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("Vapour BRDF LUT pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&pipeline);
        pass.draw(0..3, 0..1);
    }
    queue.submit([encoder.finish()]);
    TextureGpu {
        _texture: texture,
        view,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefiltered_chain_stops_at_the_minimum_face() {
        // 128 → 64 → 32 → 16 → 8 → 4: six levels, roughness 0, 0.2, ..., 1.
        assert_eq!(prefiltered_mip_count(128), 6);
        assert_eq!(prefiltered_mip_count(SKY_CAPTURE_FACE_SIZE), 6);
        assert_eq!(prefiltered_mip_count(256), 7);
        assert_eq!(prefiltered_mip_count(16), 3);
        assert_eq!(prefiltered_mip_count(4), 1);
        assert_eq!(prefiltered_mip_count(1), 1);
        // Non-power-of-two faces still descend by halving.
        assert_eq!(prefiltered_mip_count(100), 5);
        let roughness: Vec<f32> = (0..6).map(|mip| mip_roughness(mip, 6)).collect();
        assert_eq!(roughness, [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]);
        assert_eq!(mip_roughness(0, 1), 0.0);
        assert_eq!(full_mip_count(128), 8);
        assert_eq!(full_mip_count(1), 1);
    }

    #[test]
    fn face_directions_round_trip_through_the_sampling_convention() {
        // Every face centre points down its axis, and every texel maps back
        // to the face and coordinates the GPU's cube-sampling rules select.
        let axes = [
            Vec3::X,
            Vec3::NEG_X,
            Vec3::Y,
            Vec3::NEG_Y,
            Vec3::Z,
            Vec3::NEG_Z,
        ];
        for (face, axis) in axes.into_iter().enumerate() {
            assert!(cube_face_direction(face as u32, 0.5, 0.5).abs_diff_eq(axis, 1e-6));
            for (u, v) in [(0.1, 0.2), (0.9, 0.3), (0.25, 0.85), (0.6, 0.6)] {
                let (found_face, found_u, found_v) =
                    cube_face_uv(cube_face_direction(face as u32, u, v));
                assert_eq!(found_face, face as u32, "face {face} at ({u}, {v})");
                assert!((found_u - u).abs() < 1e-5 && (found_v - v).abs() < 1e-5);
            }
        }
        // The +X face's top-left texel looks up and toward -Z, as the
        // spec's (sc, tc) = (-z, -y) table requires.
        let corner = cube_face_direction(0, 0.0, 0.0);
        assert!(corner.y > 0.0 && corner.z > 0.0 && corner.x > 0.0);
    }

    #[test]
    fn the_sky_capture_basis_matches_the_face_parameterisation() {
        // Rendering with the basis must write texel (u, v) with the direction
        // the sampler later reads for it. Clip y = +1 is texel row 0.
        for face in 0..6 {
            let basis = cube_face_ray_basis(face);
            for (u, v) in [(0.0, 0.0), (1.0, 0.0), (0.5, 0.5), (0.3, 0.9)] {
                let clip = Vec3::new(u * 2.0 - 1.0, 1.0 - v * 2.0, 1.0);
                let ray = (basis * clip).normalize();
                let expected = cube_face_direction(face, u, v);
                assert!(
                    ray.abs_diff_eq(expected, 1e-6),
                    "face {face} ({u}, {v}): {ray} vs {expected}"
                );
            }
        }
    }

    /// Real-GPU check: convolving a uniform environment must return that
    /// same radiance at every roughness and in the irradiance cube (the
    /// cosine-weighted mean of a constant is the constant), and the BRDF
    /// lookup must reach (scale, bias) ≈ (1, 0) for a smooth surface seen
    /// head-on. Also compiles the full standard pipeline set against the
    /// widened frame layout, so a binding mismatch fails here, not in a
    /// browser.
    #[test]
    fn gpu_convolution_of_a_uniform_environment_is_that_environment() {
        let Some(gpu) = crate::test_gpu::device() else {
            return;
        };
        let mut environment = EnvironmentGpu::new(&gpu.device, &gpu.queue);
        assert!(!environment.live);
        assert_eq!(environment.params()[0], 0.0);

        // Every face a mid-grey: sRGB 128 decodes to linear ~0.2158.
        let face = 16;
        let faces = vec![128u8, 128, 128, 255].repeat((face * face * 6) as usize);
        let source = EnvironmentGpu::source_from_rgba8(&gpu.device, &gpu.queue, face, &faces, true);
        assert_eq!(source.mip_count, full_mip_count(face));
        environment.convolve(&gpu.device, &gpu.queue, &source, 1.0);
        assert!(environment.live);
        assert_eq!(environment.specular.mip_count, prefiltered_mip_count(face));
        assert_eq!(environment.params(), [1.0, 2.0, 1.0, 0.0]);

        let expected = 0.2158;
        for mip in 0..environment.specular.mip_count {
            let size = face >> mip;
            for cube_face in 0..6 {
                let texels =
                    gpu.read_rgba16f(&environment.specular.texture, mip, cube_face, size, size);
                for texel in &texels {
                    for channel in 0..3 {
                        assert!(
                            (texel[channel] - expected).abs() < 0.01,
                            "specular mip {mip} face {cube_face}: {texel:?}"
                        );
                    }
                }
            }
        }
        let irradiance = gpu.read_rgba16f(
            &environment.irradiance.texture,
            0,
            3,
            IRRADIANCE_FACE_SIZE,
            IRRADIANCE_FACE_SIZE,
        );
        let centre = irradiance
            [(IRRADIANCE_FACE_SIZE * IRRADIANCE_FACE_SIZE / 2 + IRRADIANCE_FACE_SIZE / 2) as usize];
        assert!((centre[0] - expected).abs() < 0.01, "irradiance {centre:?}");

        let lut = gpu.read_rgba16f(
            &environment.brdf_lut._texture,
            0,
            0,
            BRDF_LUT_SIZE,
            BRDF_LUT_SIZE,
        );
        // Top-right texel: n_dot_v → 1, roughness → 0.
        let smooth_head_on = lut[(BRDF_LUT_SIZE - 1) as usize];
        assert!(
            smooth_head_on[0] > 0.97 && smooth_head_on[1] < 0.03,
            "{smooth_head_on:?}"
        );
        // Top-left: smooth and grazing is almost pure Fresnel — all bias.
        let smooth_grazing = lut[0];
        assert!(
            smooth_grazing[0] < 0.05 && smooth_grazing[1] > 0.9,
            "{smooth_grazing:?}"
        );
        // Bottom-left: rough and grazing loses energy to masking; well under
        // one in total and far from the smooth extremes.
        let rough_grazing = lut[((BRDF_LUT_SIZE - 1) * BRDF_LUT_SIZE) as usize];
        assert!(
            rough_grazing[0] + rough_grazing[1] < 0.8 && rough_grazing[0] > 0.3,
            "{rough_grazing:?}"
        );

        // The material pipelines must accept the frame layout carrying the
        // new environment bindings.
        let shaders = crate::ShaderLibrary::standard().unwrap();
        let module = shaders
            .create_module(&gpu.device, "vapour.standard-pbr")
            .unwrap();
        let frame_layout = super::super::pipeline::create_frame_layout(&gpu.device);
        let material_layout = super::super::material::create_material_layout(&gpu.device);
        let layout = gpu
            .device
            .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[Some(&frame_layout), Some(&material_layout)],
                immediate_size: 0,
            });
        let pipelines = super::super::pipeline::create_standard_pipelines(
            &gpu.device,
            &layout,
            &module,
            super::super::HDR_FORMAT,
        );
        assert_eq!(pipelines.len(), 6);
        // The decal pass shares the frame layout and must compile too.
        let decal_module = shaders.create_module(&gpu.device, "vapour.decal").unwrap();
        let decals = super::super::decal::DecalGpu::new(
            &gpu.device,
            &frame_layout,
            &decal_module,
            super::super::HDR_FORMAT,
        );
        assert_eq!(decals.count, 0);
        gpu.device
            .poll(wgpu::PollType::wait_indefinitely())
            .unwrap();
    }
}
