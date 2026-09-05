//! Directional cascaded shadow-map resources and stable cascade fitting.

use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3};

use super::{
    InstanceData, ViewState,
    lighting::LIGHT_KIND_DIRECTIONAL,
    mesh::VertexLayout,
    pipeline::{DEPTH_FORMAT, uniform_buffer},
};
use crate::mesh::MeshVertex;

pub(crate) const SHADOW_CASCADE_COUNT: usize = 4;
pub(crate) const SHADOW_MAP_SIZE: u32 = 2048;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(crate) struct ShadowPassUniform {
    pub(crate) view_projection: [[f32; 4]; 4],
    pub(crate) far: f32,
    pub(crate) _padding: [f32; 3],
}

pub(crate) struct ShadowGpu {
    pub(crate) layout: wgpu::BindGroupLayout,
    pub(crate) _texture: wgpu::Texture,
    pub(crate) sampling_view: wgpu::TextureView,
    pub(crate) layer_views: Vec<wgpu::TextureView>,
    pub(crate) sampler: wgpu::Sampler,
    pub(crate) cascade_buffers: Vec<wgpu::Buffer>,
    pub(crate) cascade_bind_groups: Vec<wgpu::BindGroup>,
}

impl ShadowGpu {
    pub(crate) fn new(device: &wgpu::Device) -> Self {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Vapour shadow-pass layout"),
            entries: &[super::uniform_layout_entry(0, wgpu::ShaderStages::VERTEX)],
        });
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Vapour directional cascade maps"),
            size: wgpu::Extent3d {
                width: SHADOW_MAP_SIZE,
                height: SHADOW_MAP_SIZE,
                depth_or_array_layers: SHADOW_CASCADE_COUNT as u32,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let sampling_view = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("Vapour shadow sampling view"),
            dimension: Some(wgpu::TextureViewDimension::D2Array),
            ..Default::default()
        });
        let layer_views = (0..SHADOW_CASCADE_COUNT)
            .map(|layer| {
                texture.create_view(&wgpu::TextureViewDescriptor {
                    label: Some("Vapour shadow layer"),
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_array_layer: layer as u32,
                    array_layer_count: Some(1),
                    ..Default::default()
                })
            })
            .collect();
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("Vapour shadow sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            compare: Some(wgpu::CompareFunction::LessEqual),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let mut cascade_buffers = Vec::new();
        let mut cascade_bind_groups = Vec::new();
        for index in 0..SHADOW_CASCADE_COUNT {
            let buffer = uniform_buffer::<ShadowPassUniform>(
                device,
                &format!("Vapour shadow cascade {index}"),
            );
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Vapour shadow cascade bind group"),
                layout: &layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: buffer.as_entire_binding(),
                }],
            });
            cascade_buffers.push(buffer);
            cascade_bind_groups.push(bind_group);
        }
        Self {
            layout,
            _texture: texture,
            sampling_view,
            layer_views,
            sampler,
            cascade_buffers,
            cascade_bind_groups,
        }
    }
}

pub(crate) fn create_shadow_pipeline(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
) -> wgpu::RenderPipeline {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("Vapour shadow depth shader"),
        source: wgpu::ShaderSource::Wgsl(crate::SHADOW_DEPTH_SHADER.into()),
    });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("Vapour shadow pipeline layout"),
        bind_group_layouts: &[Some(layout)],
        immediate_size: 0,
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("Vapour directional shadow pipeline"),
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vertex_main"),
            compilation_options: Default::default(),
            buffers: &[
                Some(<MeshVertex as VertexLayout>::layout()),
                Some(InstanceData::layout()),
            ],
        },
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleList,
            front_face: wgpu::FrontFace::Ccw,
            cull_mode: Some(wgpu::Face::Front),
            ..Default::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: DEPTH_FORMAT,
            depth_write_enabled: Some(true),
            depth_compare: Some(wgpu::CompareFunction::Less),
            stencil: Default::default(),
            bias: wgpu::DepthBiasState {
                constant: 2,
                slope_scale: 2.0,
                clamp: 0.0,
            },
        }),
        multisample: Default::default(),
        fragment: None,
        multiview_mask: None,
        cache: None,
    })
}

pub(crate) fn shadow_cascades(
    view: &ViewState,
    aspect: f32,
) -> [ShadowPassUniform; SHADOW_CASCADE_COUNT] {
    let direction = view
        .lights
        .iter()
        .find(|light| (light.vector_kind[3] - LIGHT_KIND_DIRECTIONAL).abs() < 0.1)
        .map(|light| Vec3::from_slice(&light.vector_kind[..3]))
        .unwrap_or(Vec3::new(-0.4, -1.0, -0.35))
        .normalize();
    let near = view.near.max(0.01);
    let far = view.far.min(200.0).max(near + 0.01);
    let mut splits = [near; SHADOW_CASCADE_COUNT + 1];
    for (index, split) in splits.iter_mut().enumerate().skip(1) {
        let t = index as f32 / SHADOW_CASCADE_COUNT as f32;
        *split = (near * (far / near).powf(t)) * 0.75 + (near + (far - near) * t) * 0.25;
    }
    let position = view.camera_world.transform_point3(Vec3::ZERO);
    let forward = view.camera_world.transform_vector3(Vec3::NEG_Z).normalize();
    std::array::from_fn(|index| {
        let slice_near = splits[index];
        let slice_far = splits[index + 1];
        let middle = (slice_near + slice_far) * 0.5;
        let half_height = if view.projection == crate::CameraProjection::Perspective {
            (view.field_of_view_degrees.to_radians() * 0.5).tan() * slice_far
        } else {
            view.orthographic_size * 0.5
        };
        let half_width = half_height * aspect;
        let half_depth = (slice_far - slice_near) * 0.5;
        let radius =
            (half_width * half_width + half_height * half_height + half_depth * half_depth)
                .sqrt()
                .max(0.01);
        let center = position + forward * middle;
        let texel = radius * 2.0 / SHADOW_MAP_SIZE as f32;
        let light_up = if direction.y.abs() > 0.99 {
            Vec3::Z
        } else {
            Vec3::Y
        };
        let basis = Mat4::look_at_rh(Vec3::ZERO, direction, light_up);
        let light_center = basis.transform_point3(center);
        let snapped = Vec3::new(
            (light_center.x / texel).round() * texel,
            (light_center.y / texel).round() * texel,
            light_center.z,
        );
        let target = basis.inverse().transform_point3(snapped);
        let eye = target - direction * (radius + 50.0);
        let matrix =
            Mat4::orthographic_rh(-radius, radius, -radius, radius, 0.01, radius * 2.0 + 50.0)
                * Mat4::look_at_rh(eye, target, light_up);
        ShadowPassUniform {
            view_projection: matrix.to_cols_array_2d(),
            far: slice_far,
            _padding: [0.0; 3],
        }
    })
}

pub(crate) fn has_directional_shadow(view: &ViewState) -> bool {
    view.lights.iter().any(|light| {
        (light.vector_kind[3] - LIGHT_KIND_DIRECTIONAL).abs() < 0.1
            && light.color_intensity[3] > 0.0
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cascades_are_ordered_and_end_at_the_shadow_distance() {
        let cascades = shadow_cascades(&ViewState::default(), 16.0 / 9.0);
        assert!(cascades.windows(2).all(|pair| pair[0].far < pair[1].far));
        assert!((cascades[3].far - 200.0).abs() < 0.001);
        assert!(
            cascades
                .iter()
                .flat_map(|cascade| cascade.view_projection)
                .flatten()
                .all(f32::is_finite)
        );
    }

    #[test]
    fn sub_texel_camera_motion_keeps_the_light_projection_stable() {
        let view = ViewState::default();
        let first = shadow_cascades(&view, 1.0);
        let texel_scale = 0.00001;
        let mut moved = view.clone();
        moved.camera_world.w_axis.x += texel_scale;
        let second = shadow_cascades(&moved, 1.0);
        let delta = first[0].view_projection[3][0] - second[0].view_projection[3][0];
        assert!(delta.abs() < 0.0001, "cascade projection moved by {delta}");
    }

    #[test]
    fn rigs_without_a_live_directional_light_disable_shadow_sampling() {
        let mut view = ViewState::default();
        view.lights.clear();
        assert!(!has_directional_shadow(&view));
        view.lights
            .push(super::super::lighting::GpuLight::directional(
                Vec3::NEG_Y,
                Vec3::ONE,
                0.0,
            ));
        assert!(!has_directional_shadow(&view));
    }
}
