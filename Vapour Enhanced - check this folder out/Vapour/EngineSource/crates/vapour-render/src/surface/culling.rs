//! GPU-driven frustum culling with an equivalent CPU fallback.
//!
//! Every submitted instance carries a world bounding sphere and its batch
//! index. A compute pass (`cull_instances.wgsl`) tests each sphere against
//! the layer's frustum, compacts survivors into their batch's run of a second
//! instance buffer, and bumps the batch's indirect instance count; the
//! material pass then issues one `draw_indexed_indirect` per batch. The
//! indirect args carry a non-zero `first_instance`, which WebGPU only allows
//! with the `indirect-first-instance` feature, so the path is gated on
//! `RenderCapabilities::gpu_culling`. Without it [`cull_cpu`] runs the same
//! test on the CPU and writes the compacted buffer and counts itself, and the
//! material pass draws with ordinary instance ranges. Both paths cull the
//! same instances: the set is identical, only the order inside a batch may
//! differ (atomics on the GPU, submission order on the CPU).

use bytemuck::{Pod, Zeroable};
use glam::{Mat4, Vec3, Vec4};

use super::frame::InstanceData;

pub(crate) const CULL_PASS_THROUGH: u32 = 1;
const WORKGROUP_SIZE: u32 = 64;

/// One instance's culling record; parallel to the instance buffer.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub(crate) struct CullInput {
    /// xyz world centre, w radius.
    pub(crate) center_radius: [f32; 4],
    /// x batch index, y flags ([`CULL_PASS_THROUGH`]), zw reserved.
    pub(crate) batch_flags: [u32; 4],
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub(crate) struct CullParams {
    pub(crate) planes: [[f32; 4]; 6],
    /// x first instance, y count, zw reserved.
    pub(crate) range: [u32; 4],
}

/// `wgpu::util::DrawIndexedIndirectArgs` as a plain-old-data record.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Pod, Zeroable)]
pub(crate) struct DrawArgs {
    pub(crate) index_count: u32,
    pub(crate) instance_count: u32,
    pub(crate) first_index: u32,
    pub(crate) base_vertex: i32,
    pub(crate) first_instance: u32,
}

/// The six frustum planes of a view-projection matrix (left, right, bottom,
/// top, near, far), each `(normal, distance)` with the normal pointing
/// inward and normalized, so `dot(n, p) + d` is a signed distance.
#[must_use]
pub fn frustum_planes(view_projection: Mat4) -> [Vec4; 6] {
    let m = view_projection.transpose();
    let rows = [m.x_axis, m.y_axis, m.z_axis, m.w_axis];
    let planes = [
        rows[3] + rows[0],
        rows[3] - rows[0],
        rows[3] + rows[1],
        rows[3] - rows[1],
        rows[2],
        rows[3] - rows[2],
    ];
    planes.map(|plane| {
        let length = plane.truncate().length();
        if length > 1e-12 {
            plane / length
        } else {
            plane
        }
    })
}

/// Whether a sphere is at least partly inside every plane.
#[must_use]
pub fn sphere_inside(planes: &[Vec4; 6], center: Vec3, radius: f32) -> bool {
    planes
        .iter()
        .all(|plane| plane.truncate().dot(center) + plane.w >= -radius)
}

/// World bounding sphere of a mesh with local bounding radius
/// `local_radius` (about its origin) under `model`: the origin moves with
/// the matrix and the radius grows by its largest axis scale.
#[must_use]
pub fn world_bounds(model: Mat4, local_radius: f32) -> (Vec3, f32) {
    let scale = model
        .x_axis
        .truncate()
        .length()
        .max(model.y_axis.truncate().length())
        .max(model.z_axis.truncate().length());
    (model.transform_point3(Vec3::ZERO), local_radius * scale)
}

/// The CPU fallback: culls `inputs[first..first + count]` against `planes`
/// exactly as the compute shader does, writing survivors into `compacted`
/// (each batch's run, in submission order) and adding to each batch's
/// `instance_count` in `args`. Pass-through instances are copied to their
/// own slot without touching the count, matching the shader.
pub(crate) fn cull_cpu(
    inputs: &[CullInput],
    source: &[InstanceData],
    planes: &[Vec4; 6],
    first: usize,
    count: usize,
    compacted: &mut [InstanceData],
    args: &mut [DrawArgs],
) {
    for index in first..first + count {
        let input = inputs[index];
        if input.batch_flags[1] & CULL_PASS_THROUGH != 0 {
            compacted[index] = source[index];
            continue;
        }
        let center = Vec3::from_slice(&input.center_radius[..3]);
        if !sphere_inside(planes, center, input.center_radius[3]) {
            continue;
        }
        let batch = &mut args[input.batch_flags[0] as usize];
        let slot = batch.first_instance + batch.instance_count;
        batch.instance_count += 1;
        compacted[slot as usize] = source[index];
    }
}

pub(crate) fn workgroups_for(count: u32) -> u32 {
    count.div_ceil(WORKGROUP_SIZE)
}

/// Compute pipeline and the per-layer bind groups it needs.
pub(crate) struct CullingGpu {
    pub(crate) pipeline: wgpu::ComputePipeline,
    pub(crate) layout: wgpu::BindGroupLayout,
}

impl CullingGpu {
    pub(crate) fn new(device: &wgpu::Device, shader: &wgpu::ShaderModule) -> Self {
        let storage = |binding: u32, read_only: bool| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Vapour cull layout"),
            entries: &[
                super::pipeline::uniform_layout_entry(0, wgpu::ShaderStages::COMPUTE),
                storage(1, true),
                storage(2, true),
                storage(3, false),
                storage(4, false),
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Vapour cull pipeline layout"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("Vapour cull pipeline"),
            layout: Some(&pipeline_layout),
            module: shader,
            entry_point: Some("cull"),
            compilation_options: Default::default(),
            cache: None,
        });
        Self { pipeline, layout }
    }

    pub(crate) fn bind_group(
        &self,
        device: &wgpu::Device,
        params: &wgpu::Buffer,
        inputs: &wgpu::Buffer,
        source: &wgpu::Buffer,
        compacted: &wgpu::Buffer,
        args: &wgpu::Buffer,
    ) -> wgpu::BindGroup {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("Vapour cull bind group"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: params.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: inputs.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: source.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: compacted.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: args.as_entire_binding(),
                },
            ],
        })
    }
}

/// One layer's culling job: its frustum and its contiguous instance range.
pub(crate) struct CullJob {
    pub(crate) planes: [Vec4; 6],
    pub(crate) first: u32,
    pub(crate) count: u32,
}

/// Which path culled the frame and, where it is known, how much it dropped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CullOutcome {
    pub(crate) gpu: bool,
    /// Instances the CPU fallback dropped. The GPU path compacts on-device
    /// and never reads back, so it reports `None` rather than a guess.
    pub(crate) culled: Option<u32>,
}

/// Everything the renderer keeps between `commit` and `render` to cull a
/// frame: the CPU-side records, the GPU buffers they mirror, and the compute
/// pipeline. The renderer owns the *source* instance buffer (the shadow
/// passes draw from it uncompacted); this owns the compacted copy the
/// material pass draws from.
pub(crate) struct CullState {
    gpu: CullingGpu,
    pub(crate) inputs: Vec<CullInput>,
    pub(crate) source: Vec<InstanceData>,
    /// One record per batch across every layer; instance counts are
    /// reset each frame (zero for opaque, full for pass-through).
    pub(crate) args: Vec<DrawArgs>,
    input_buffer: wgpu::Buffer,
    pub(crate) compacted: wgpu::Buffer,
    pub(crate) args_buffer: wgpu::Buffer,
    params: Vec<wgpu::Buffer>,
    instance_capacity: usize,
    args_capacity: usize,
    /// Caller preference; the GPU path also needs
    /// `RenderCapabilities::gpu_culling`.
    pub(crate) prefer_gpu: bool,
}

impl CullState {
    pub(crate) fn new(device: &wgpu::Device, shader: &wgpu::ShaderModule) -> Self {
        Self {
            gpu: CullingGpu::new(device, shader),
            inputs: Vec::new(),
            source: Vec::new(),
            args: Vec::new(),
            input_buffer: create_input_buffer(device, 1),
            compacted: create_compacted_buffer(device, 1),
            args_buffer: create_args_buffer(device, 1),
            params: Vec::new(),
            instance_capacity: 1,
            args_capacity: 1,
            prefer_gpu: true,
        }
    }

    /// Stores the frame's records and uploads the culling inputs. The
    /// source instances themselves are uploaded by the renderer.
    pub(crate) fn upload(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        inputs: Vec<CullInput>,
        source: Vec<InstanceData>,
        args: Vec<DrawArgs>,
    ) {
        debug_assert_eq!(inputs.len(), source.len());
        if inputs.len() > self.instance_capacity {
            self.instance_capacity = inputs.len().next_power_of_two();
            self.input_buffer = create_input_buffer(device, self.instance_capacity);
            self.compacted = create_compacted_buffer(device, self.instance_capacity);
        }
        if args.len() > self.args_capacity {
            self.args_capacity = args.len().next_power_of_two();
            self.args_buffer = create_args_buffer(device, self.args_capacity);
        }
        if !inputs.is_empty() {
            queue.write_buffer(&self.input_buffer, 0, bytemuck::cast_slice(&inputs));
        }
        self.inputs = inputs;
        self.source = source;
        self.args = args;
    }

    /// Culls every layer, on the GPU when `gpu_supported && prefer_gpu`
    /// and otherwise on the CPU, leaving `compacted` and the per-batch
    /// instance counts ready for the material pass. On the GPU path the
    /// counts live in `args_buffer` (draw indirect); on the CPU path they
    /// are in `args` (draw with explicit ranges).
    pub(crate) fn cull(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        source_buffer: &wgpu::Buffer,
        jobs: &[CullJob],
        gpu_supported: bool,
    ) -> CullOutcome {
        let use_gpu = gpu_supported && self.prefer_gpu;
        if self.inputs.is_empty() {
            return CullOutcome {
                gpu: use_gpu,
                culled: Some(0),
            };
        }
        if !use_gpu {
            let mut compacted = vec![InstanceData::zeroed(); self.source.len()];
            for job in jobs {
                cull_cpu(
                    &self.inputs,
                    &self.source,
                    &job.planes,
                    job.first as usize,
                    job.count as usize,
                    &mut compacted,
                    &mut self.args,
                );
            }
            queue.write_buffer(&self.compacted, 0, bytemuck::cast_slice(&compacted));
            let drawn: u32 = self.args.iter().map(|args| args.instance_count).sum();
            return CullOutcome {
                gpu: false,
                culled: Some(self.source.len() as u32 - drawn),
            };
        }
        queue.write_buffer(&self.args_buffer, 0, bytemuck::cast_slice(&self.args));
        while self.params.len() < jobs.len() {
            self.params
                .push(device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("Vapour cull params"),
                    size: std::mem::size_of::<CullParams>() as u64,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }));
        }
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("Vapour instance culling"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.gpu.pipeline);
        for (job, params) in jobs.iter().zip(&self.params) {
            if job.count == 0 {
                continue;
            }
            queue.write_buffer(
                params,
                0,
                bytemuck::bytes_of(&CullParams {
                    planes: job.planes.map(|plane| plane.to_array()),
                    range: [job.first, job.count, 0, 0],
                }),
            );
            let bind_group = self.gpu.bind_group(
                device,
                params,
                &self.input_buffer,
                source_buffer,
                &self.compacted,
                &self.args_buffer,
            );
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(workgroups_for(job.count), 1, 1);
        }
        CullOutcome {
            gpu: true,
            culled: None,
        }
    }
}

fn create_input_buffer(device: &wgpu::Device, capacity: usize) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Vapour cull inputs"),
        size: (capacity * std::mem::size_of::<CullInput>()) as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

fn create_compacted_buffer(device: &wgpu::Device, capacity: usize) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Vapour culled instances"),
        size: (capacity * std::mem::size_of::<InstanceData>()) as u64,
        usage: SOURCE_INSTANCE_USAGE,
        mapped_at_creation: false,
    })
}

fn create_args_buffer(device: &wgpu::Device, capacity: usize) -> wgpu::Buffer {
    device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Vapour indirect draw args"),
        size: (capacity * std::mem::size_of::<DrawArgs>()) as u64,
        usage: ARGS_USAGE,
        mapped_at_creation: false,
    })
}

/// Byte offset of one batch's record in the indirect args buffer.
pub(crate) fn args_offset(batch: usize) -> u64 {
    (batch * std::mem::size_of::<DrawArgs>()) as u64
}

/// Buffer usages the culling path needs on top of a plain vertex buffer.
pub(crate) const SOURCE_INSTANCE_USAGE: wgpu::BufferUsages = wgpu::BufferUsages::VERTEX
    .union(wgpu::BufferUsages::COPY_DST)
    .union(wgpu::BufferUsages::STORAGE);
pub(crate) const ARGS_USAGE: wgpu::BufferUsages = wgpu::BufferUsages::INDIRECT
    .union(wgpu::BufferUsages::COPY_DST)
    .union(wgpu::BufferUsages::COPY_SRC)
    .union(wgpu::BufferUsages::STORAGE);

#[cfg(test)]
mod tests {
    use super::*;

    fn instance(slot: u32) -> InstanceData {
        InstanceData {
            model: Mat4::from_translation(Vec3::splat(slot as f32)).to_cols_array_2d(),
            base_color: [slot as f32; 4],
            material_params: [0.0; 4],
            skin: [-1.0, 0.0, 0.0, 0.0],
        }
    }

    /// A test scene: three batches, some instances outside the frustum, and
    /// a pass-through (blended) batch that must stay in place.
    fn scene() -> (Mat4, Vec<CullInput>, Vec<InstanceData>, Vec<DrawArgs>) {
        let view_projection = Mat4::perspective_rh(60f32.to_radians(), 1.0, 0.1, 100.0)
            * Mat4::look_at_rh(Vec3::new(0.0, 0.0, 10.0), Vec3::ZERO, Vec3::Y);
        let mut inputs = Vec::new();
        let mut source = Vec::new();
        // Batch 0: 5 opaque instances along x; ±30 are outside a 60° cone
        // at distance 10, the middle three are inside.
        for (i, x) in [-30.0, -2.0, 0.0, 2.0, 30.0].into_iter().enumerate() {
            inputs.push(CullInput {
                center_radius: [x, 0.0, 0.0, 0.5],
                batch_flags: [0, 0, 0, 0],
            });
            source.push(instance(i as u32));
        }
        // Batch 1: 2 blended instances, one of them far outside — kept.
        for x in [0.0, 500.0] {
            inputs.push(CullInput {
                center_radius: [x, 0.0, 0.0, 0.5],
                batch_flags: [1, CULL_PASS_THROUGH, 0, 0],
            });
            source.push(instance(source.len() as u32));
        }
        // Batch 2: 3 opaque — one behind the camera, one past the far
        // plane, one huge sphere that straddles the frustum from far away.
        for (x, z, r) in [(0.0, 20.0, 0.5), (0.0, -200.0, 0.5), (200.0, 0.0, 300.0)] {
            inputs.push(CullInput {
                center_radius: [x, 0.0, z, r],
                batch_flags: [2, 0, 0, 0],
            });
            source.push(instance(source.len() as u32));
        }
        let args = vec![
            DrawArgs {
                index_count: 36,
                instance_count: 0,
                first_index: 0,
                base_vertex: 0,
                first_instance: 0,
            },
            DrawArgs {
                index_count: 36,
                instance_count: 2,
                first_index: 0,
                base_vertex: 0,
                first_instance: 5,
            },
            DrawArgs {
                index_count: 36,
                instance_count: 0,
                first_index: 0,
                base_vertex: 0,
                first_instance: 7,
            },
        ];
        (view_projection, inputs, source, args)
    }

    #[test]
    fn frustum_planes_classify_spheres() {
        let (vp, ..) = scene();
        let planes = frustum_planes(vp);
        assert!(sphere_inside(&planes, Vec3::ZERO, 0.5));
        assert!(
            !sphere_inside(&planes, Vec3::new(0.0, 0.0, 20.0), 0.5),
            "behind camera"
        );
        assert!(
            !sphere_inside(&planes, Vec3::new(30.0, 0.0, 0.0), 0.5),
            "outside cone"
        );
        assert!(
            sphere_inside(&planes, Vec3::new(30.0, 0.0, 0.0), 30.0),
            "large sphere overlaps"
        );
        assert!(
            !sphere_inside(&planes, Vec3::new(0.0, 0.0, -200.0), 1.0),
            "past far"
        );
        let (center, radius) = world_bounds(
            Mat4::from_scale_rotation_translation(
                Vec3::new(2.0, 1.0, 1.0),
                glam::Quat::IDENTITY,
                Vec3::X,
            ),
            0.5,
        );
        assert_eq!(center, Vec3::X);
        assert_eq!(radius, 1.0);
    }

    #[test]
    fn the_cpu_path_compacts_survivors_per_batch_in_order() {
        let (vp, inputs, source, mut args) = scene();
        let planes = frustum_planes(vp);
        let mut compacted = vec![InstanceData::zeroed(); source.len()];
        cull_cpu(
            &inputs,
            &source,
            &planes,
            0,
            inputs.len(),
            &mut compacted,
            &mut args,
        );
        assert_eq!(
            args.iter().map(|a| a.instance_count).collect::<Vec<_>>(),
            [3, 2, 1]
        );
        // Batch 0 survivors are instances 1, 2, 3 packed from slot 0.
        assert_eq!(compacted[0].base_color[0], 1.0);
        assert_eq!(compacted[1].base_color[0], 2.0);
        assert_eq!(compacted[2].base_color[0], 3.0);
        // Pass-through instances keep their own slots.
        assert_eq!(compacted[5].base_color[0], 5.0);
        assert_eq!(compacted[6].base_color[0], 6.0);
        // Batch 2: only the huge straddling sphere (instance 9) survives.
        assert_eq!(compacted[7].base_color[0], 9.0);
    }

    /// Runs the compute pass on the real device and reads the results back.
    fn cull_on_gpu(
        gpu: &crate::test_gpu::TestGpu,
        planes: &[Vec4; 6],
        inputs: &[CullInput],
        source: &[InstanceData],
        args_initial: &[DrawArgs],
    ) -> (Vec<DrawArgs>, Vec<InstanceData>) {
        use wgpu::util::DeviceExt;
        let shaders = crate::ShaderLibrary::standard().unwrap();
        let module = shaders
            .create_module(&gpu.device, "vapour.cull-instances")
            .unwrap();
        let culling = CullingGpu::new(&gpu.device, &module);
        let params = gpu
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents: bytemuck::bytes_of(&CullParams {
                    planes: planes.map(|p| p.to_array()),
                    range: [0, inputs.len() as u32, 0, 0],
                }),
                usage: wgpu::BufferUsages::UNIFORM,
            });
        let input_buffer = gpu
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents: bytemuck::cast_slice(inputs),
                usage: wgpu::BufferUsages::STORAGE,
            });
        let source_buffer = gpu
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents: bytemuck::cast_slice(source),
                usage: SOURCE_INSTANCE_USAGE,
            });
        let compacted_size = std::mem::size_of_val(source) as u64;
        let compacted_buffer = gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: compacted_size,
            usage: SOURCE_INSTANCE_USAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let args_buffer = gpu
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: None,
                contents: bytemuck::cast_slice(args_initial),
                usage: ARGS_USAGE,
            });
        let bind_group = culling.bind_group(
            &gpu.device,
            &params,
            &input_buffer,
            &source_buffer,
            &compacted_buffer,
            &args_buffer,
        );
        let mut encoder = gpu
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: None,
                timestamp_writes: None,
            });
            pass.set_pipeline(&culling.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.dispatch_workgroups(workgroups_for(inputs.len() as u32), 1, 1);
        }
        gpu.queue.submit([encoder.finish()]);
        let args = bytemuck::cast_slice(
            &gpu.read_buffer(&args_buffer, std::mem::size_of_val(args_initial) as u64),
        )
        .to_vec();
        let compacted =
            bytemuck::cast_slice(&gpu.read_buffer(&compacted_buffer, compacted_size)).to_vec();
        (args, compacted)
    }

    /// Asserts the GPU and CPU paths agree: identical indirect args and,
    /// per batch, the same survivor *set* (the GPU's order comes from
    /// atomics), every survivor a verbatim copy of its source record.
    fn assert_paths_agree(
        cpu_args: &[DrawArgs],
        cpu_compacted: &[InstanceData],
        gpu_args: &[DrawArgs],
        gpu_compacted: &[InstanceData],
        source: &[InstanceData],
    ) {
        assert_eq!(gpu_args, cpu_args, "indirect args differ");
        for batch in cpu_args {
            let range = batch.first_instance as usize
                ..(batch.first_instance + batch.instance_count) as usize;
            let mut cpu: Vec<u32> = cpu_compacted[range.clone()]
                .iter()
                .map(|i| i.base_color[0] as u32)
                .collect();
            let mut gpu_ids: Vec<u32> = gpu_compacted[range.clone()]
                .iter()
                .map(|i| i.base_color[0] as u32)
                .collect();
            cpu.sort_unstable();
            gpu_ids.sort_unstable();
            assert_eq!(gpu_ids, cpu, "batch {batch:?} survivors differ");
            for record in &gpu_compacted[range] {
                assert_eq!(*record, source[record.base_color[0] as usize]);
            }
        }
    }

    /// Real-device check on the hand-built scene: the compute pass and the
    /// CPU fallback produce the same per-batch counts and survivor sets.
    #[test]
    fn gpu_and_cpu_culling_agree_on_every_batch() {
        let Some(gpu) = crate::test_gpu::device() else {
            return;
        };
        let (vp, inputs, source, args_initial) = scene();
        let planes = frustum_planes(vp);
        let mut cpu_args = args_initial.clone();
        let mut cpu_compacted = vec![InstanceData::zeroed(); source.len()];
        cull_cpu(
            &inputs,
            &source,
            &planes,
            0,
            inputs.len(),
            &mut cpu_compacted,
            &mut cpu_args,
        );
        let (gpu_args, gpu_compacted) = cull_on_gpu(&gpu, &planes, &inputs, &source, &args_initial);
        assert_eq!(
            gpu_args
                .iter()
                .map(|a| a.instance_count)
                .collect::<Vec<_>>(),
            [3, 2, 1]
        );
        assert_paths_agree(
            &cpu_args,
            &cpu_compacted,
            &gpu_args,
            &gpu_compacted,
            &source,
        );
        assert_eq!(gpu_compacted[5], source[5]);
        assert_eq!(gpu_compacted[7], source[9]);
    }

    /// A seeded random scene: 1000 spheres scattered around the camera in
    /// 8 batches (one blended), a spread of radii so some straddle planes.
    fn random_scene(seed: u64) -> (Mat4, Vec<CullInput>, Vec<InstanceData>, Vec<DrawArgs>) {
        let mut state = seed;
        let mut next = move || {
            // ponytail: LCG is plenty for a deterministic fixture.
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            ((state >> 33) as f32) / (u32::MAX >> 1) as f32
        };
        let view_projection = Mat4::perspective_rh(70f32.to_radians(), 16.0 / 9.0, 0.1, 60.0)
            * Mat4::look_at_rh(Vec3::new(2.0, 3.0, 12.0), Vec3::new(0.0, 1.0, 0.0), Vec3::Y);
        const BATCHES: u32 = 8;
        const PER_BATCH: u32 = 125;
        let mut inputs = Vec::new();
        let mut source = Vec::new();
        let mut args = Vec::new();
        for batch in 0..BATCHES {
            let blended = batch == 3;
            args.push(DrawArgs {
                index_count: 36,
                instance_count: if blended { PER_BATCH } else { 0 },
                first_index: 0,
                base_vertex: 0,
                first_instance: batch * PER_BATCH,
            });
            for _ in 0..PER_BATCH {
                let center = [
                    next() * 120.0 - 60.0,
                    next() * 60.0 - 30.0,
                    next() * 160.0 - 100.0,
                ];
                let radius = next() * next() * 12.0 + 0.05;
                inputs.push(CullInput {
                    center_radius: [center[0], center[1], center[2], radius],
                    batch_flags: [batch, if blended { CULL_PASS_THROUGH } else { 0 }, 0, 0],
                });
                source.push(instance(source.len() as u32));
            }
        }
        (view_projection, inputs, source, args)
    }

    /// Real-device check on a random scene of 1000 instances.
    #[test]
    fn gpu_and_cpu_culling_agree_on_a_random_scene() {
        let Some(gpu) = crate::test_gpu::device() else {
            return;
        };
        for seed in [7, 1234, 98765] {
            let (vp, inputs, source, args_initial) = random_scene(seed);
            let planes = frustum_planes(vp);
            let mut cpu_args = args_initial.clone();
            let mut cpu_compacted = vec![InstanceData::zeroed(); source.len()];
            cull_cpu(
                &inputs,
                &source,
                &planes,
                0,
                inputs.len(),
                &mut cpu_compacted,
                &mut cpu_args,
            );
            let (gpu_args, gpu_compacted) =
                cull_on_gpu(&gpu, &planes, &inputs, &source, &args_initial);
            let survivors: u32 = gpu_args.iter().map(|a| a.instance_count).sum();
            eprintln!(
                "seed {seed}: survivors per batch {:?}, {survivors}/{} kept",
                gpu_args
                    .iter()
                    .map(|a| a.instance_count)
                    .collect::<Vec<_>>(),
                source.len()
            );
            // A useful fixture culls a real fraction and keeps a real fraction.
            assert!(
                survivors > 200 && survivors < 900,
                "seed {seed}: {survivors} survivors"
            );
            assert_paths_agree(
                &cpu_args,
                &cpu_compacted,
                &gpu_args,
                &gpu_compacted,
                &source,
            );
        }
    }
}
