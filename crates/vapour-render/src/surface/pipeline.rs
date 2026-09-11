//! Pipeline, bind group layout, buffer, and render graph construction.

use std::collections::HashMap;

use crate::{
    CompiledRenderGraph, GraphError, PassKind, RenderGraph, ResourceKind, mesh::MeshVertex,
};

use super::{frame::*, material::*, mesh::*, shadow::ShadowGpu};

pub(crate) const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

pub(crate) fn fullscreen_primitive_state() -> wgpu::PrimitiveState {
    wgpu::PrimitiveState {
        // Fullscreen triangles cross API viewport conventions; there is no
        // hidden back face worth culling and doing so can blank presentation.
        cull_mode: None,
        ..Default::default()
    }
}

/// Vertex layout shared with `mesh::MeshVertex`; the two must stay in step,
/// which `MeshVertex` being the only producer guarantees.
pub(crate) fn uniform_buffer<T>(device: &wgpu::Device, label: &str) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size: std::mem::size_of::<T>() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

pub(crate) fn create_frame_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
    device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("Vapour frame bind group layout"),
        entries: &[
            uniform_layout_entry(0, wgpu::ShaderStages::VERTEX_FRAGMENT),
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Depth,
                    view_dimension: wgpu::TextureViewDimension::D2Array,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 2,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison),
                count: None,
            },
        ],
    })
}

pub(crate) fn create_frame_gpu(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    shadows: &ShadowGpu,
    index: usize,
) -> FrameGpu {
    let label = format!("Vapour frame layer {index}");
    let buffer = uniform_buffer::<FrameUniforms>(device, &label);
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some(&label),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: buffer.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::TextureView(&shadows.sampling_view),
            },
            wgpu::BindGroupEntry {
                binding: 2,
                resource: wgpu::BindingResource::Sampler(&shadows.sampler),
            },
        ],
    });
    FrameGpu { buffer, bind_group }
}

pub(crate) fn create_instance_buffer(device: &wgpu::Device, capacity: usize) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Vapour render instances"),
        size: (capacity * std::mem::size_of::<InstanceData>()) as u64,
        usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

pub(crate) fn create_standard_pipelines(
    device: &wgpu::Device,
    layout: &wgpu::PipelineLayout,
    shader: &wgpu::ShaderModule,
    format: wgpu::TextureFormat,
) -> HashMap<PipelineKind, wgpu::RenderPipeline> {
    PipelineKind::ALL
        .into_iter()
        .map(|kind| {
            let label = format!("Vapour standard PBR {kind:?}");
            let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(&label),
                layout: Some(layout),
                vertex: wgpu::VertexState {
                    module: shader,
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
                    cull_mode: (!kind.double_sided()).then_some(wgpu::Face::Back),
                    ..Default::default()
                },
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: DEPTH_FORMAT,
                    depth_write_enabled: Some(kind.depth_write()),
                    depth_compare: Some(wgpu::CompareFunction::Less),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module: shader,
                    entry_point: Some("fragment_main"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format,
                        blend: Some(if kind.blended() {
                            wgpu::BlendState::ALPHA_BLENDING
                        } else {
                            wgpu::BlendState::REPLACE
                        }),
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            });
            (kind, pipeline)
        })
        .collect()
}

pub(crate) fn create_sky_pipeline(
    device: &wgpu::Device,
    frame_layout: &wgpu::BindGroupLayout,
    shader: &wgpu::ShaderModule,
) -> wgpu::RenderPipeline {
    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("Vapour procedural sky pipeline layout"),
        bind_group_layouts: &[Some(frame_layout)],
        immediate_size: 0,
    });
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("Vapour procedural sky pipeline"),
        layout: Some(&layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vertex_main"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: fullscreen_primitive_state(),
        depth_stencil: None,
        multisample: Default::default(),
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some("fragment_main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: super::HDR_FORMAT,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        multiview_mask: None,
        cache: None,
    })
}

pub(crate) fn uniform_layout_entry(
    binding: u32,
    visibility: wgpu::ShaderStages,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

pub(crate) fn create_depth(
    device: &wgpu::Device,
    width: u32,
    height: u32,
) -> (wgpu::Texture, wgpu::TextureView) {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Vapour depth texture"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: DEPTH_FORMAT,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    (texture, view)
}

pub(crate) fn create_frame_graph() -> Result<CompiledRenderGraph, GraphError> {
    let mut graph = RenderGraph::default();
    let swapchain = graph.import_resource("swapchain", ResourceKind::Texture);
    let depth = graph.create_resource("depth", ResourceKind::Texture);
    let shadow = graph.create_resource("directional-shadow-array", ResourceKind::Texture);
    let hdr = graph.create_resource("hdr-scene-color", ResourceKind::Texture);
    graph.add_pass("directional-shadow", PassKind::Render, [], [shadow])?;
    graph.add_pass("standard-pbr", PassKind::Render, [shadow], [hdr, depth])?;
    graph.add_pass("tone-map", PassKind::Render, [hdr], [swapchain])?;
    graph.compile()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shadow_depth_is_produced_before_the_material_pass_samples_it() {
        let graph = create_frame_graph().unwrap();
        let names: Vec<_> = graph
            .passes()
            .iter()
            .map(|pass| pass.name.as_str())
            .collect();
        assert_eq!(names, ["directional-shadow", "standard-pbr", "tone-map"]);
    }

    #[test]
    fn fullscreen_passes_never_cull_the_presentation_triangle() {
        assert_eq!(fullscreen_primitive_state().cull_mode, None);
    }
}
