//! GPU particle systems with an equivalent CPU fallback.
//!
//! A system is a fixed-capacity pool simulated by `particles_sim.wgsl` —
//! `spawn` appends new particles, `update` ages, integrates, and compacts
//! the survivors into a second buffer — and drawn as billboards by
//! `particles.wgsl` from an indirect-draw record whose `instance_count` is
//! the live count. Nothing about the population crosses back to the CPU.
//!
//! [`step_cpu`] runs the same arithmetic in Rust for devices where the
//! caller prefers it (`SurfaceRenderer::set_gpu_particles(false)`): the same
//! generator, the same spawn sampling, the same integration, writing the
//! same buffers the draw reads. A real-device test asserts the two agree.
//! Spawn sampling in turn mirrors `ParticleEmitter.#spawn` in
//! `packages/engine/src/particles/particles.ts`, so a seed produces the same
//! burst on the GPU, in Rust, and in TypeScript.
//!
//! # Buffer layout
//!
//! * Particle: 3 × `vec4<f32>` = **48 bytes** ([`PARTICLE_STRIDE`]):
//!   `position.xyz, age | velocity.xyz, lifetime | rotation, spin, 0, 0`.
//! * Draw args: `wgpu::util::DrawIndirectArgs`, 16 bytes; `vertex_count`
//!   is always 6, `instance_count` is the live count.
//! * Counters: 4 × `u32` — emitted, expired, dropped, reserved; cumulative.
//! * Params: [`ParticleParams`], **736 bytes** (6 × vec4 = 96, size LUT
//!   128 at offset 96, colour LUT 512 at offset 224), one uniform per system.

use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};

use super::{
    pipeline::{DEPTH_FORMAT, uniform_layout_entry},
    postprocess::HDR_FORMAT,
};

pub const PARTICLE_STRIDE: usize = std::mem::size_of::<GpuParticle>();
pub const PARTICLE_LUT_SAMPLES: usize = 32;
/// Systems above this are refused: the pool is a hard budget, and a request
/// this large is a bug rather than an effect.
pub const MAX_PARTICLE_CAPACITY: u32 = 1 << 20;
const WORKGROUP_SIZE: u32 = 64;
const QUAD_VERTICES: u32 = 6;

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct GpuParticle {
    /// xyz position, w age in seconds.
    pub position_age: [f32; 4],
    /// xyz velocity, w lifetime in seconds.
    pub velocity_life: [f32; 4],
    /// x rotation (radians), y spin (radians/s), zw reserved.
    pub rotation_spin: [f32; 4],
}

/// Mirrors `Params` in both particle shaders.
#[repr(C)]
#[derive(Debug, Clone, Copy, Pod, Zeroable)]
pub struct ParticleParams {
    pub gravity_dt: [f32; 4],
    pub origin_decay: [f32; 4],
    pub lifetime_speed: [f32; 4],
    pub shape: [f32; 4],
    pub angle_spin: [f32; 4],
    /// spawn count, capacity, generator state, blend (0 alpha, 1 additive).
    pub counts: [u32; 4],
    pub size_lut: [[f32; 4]; 8],
    pub color_lut: [[f32; 4]; 32],
}

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Pod, Zeroable)]
struct DrawArgs {
    vertex_count: u32,
    instance_count: u32,
    first_vertex: u32,
    first_instance: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ParticleShapeKind {
    Point,
    Sphere,
    Box,
    Cone,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ParticleBlend {
    Alpha,
    Additive,
}

/// What a host describes when it creates a system. Everything that changes
/// per frame — delta, spawn count, origin — travels with `update` instead.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticleSystemDescriptor {
    pub capacity: u32,
    /// Seconds, `[min, max]`.
    pub lifetime: [f32; 2],
    /// Units per second, `[min, max]`.
    pub speed: [f32; 2],
    pub gravity: [f32; 3],
    /// Velocity retained per second.
    pub drag: f32,
    pub shape: ParticleShapeKind,
    /// Sphere or cone radius in x; box half-extents.
    pub shape_size: [f32; 3],
    /// Cone half-angle in degrees.
    pub cone_angle: f32,
    /// Radians per second, `[min, max]`.
    pub angular_speed: [f32; 2],
    pub seed: u32,
    pub blend: ParticleBlend,
    /// Size over normalized lifetime, exactly [`PARTICLE_LUT_SAMPLES`].
    pub size_lut: Vec<f32>,
    /// RGBA over normalized lifetime, exactly `4 * PARTICLE_LUT_SAMPLES`.
    pub color_lut: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ParticleError {
    #[error("particle system '{0}' already exists")]
    Duplicate(String),
    #[error("particle system '{0}' does not exist")]
    Missing(String),
    #[error("particle system capacity must be in 1..={MAX_PARTICLE_CAPACITY}, got {0}")]
    Capacity(u32),
    #[error("particle system {0}")]
    Invalid(&'static str),
}

impl ParticleSystemDescriptor {
    pub fn validate(&self) -> Result<(), ParticleError> {
        if self.capacity == 0 || self.capacity > MAX_PARTICLE_CAPACITY {
            return Err(ParticleError::Capacity(self.capacity));
        }
        let finite = self
            .lifetime
            .iter()
            .chain(&self.speed)
            .chain(&self.gravity)
            .chain(&self.shape_size)
            .chain(&self.angular_speed)
            .chain(&self.size_lut)
            .chain(&self.color_lut)
            .all(|v| v.is_finite())
            && self.drag.is_finite()
            && self.cone_angle.is_finite();
        if !finite {
            return Err(ParticleError::Invalid("parameters must be finite"));
        }
        if self.lifetime[0] <= 0.0 || self.lifetime[1] < self.lifetime[0] {
            return Err(ParticleError::Invalid(
                "lifetime must be a positive [min, max] range",
            ));
        }
        if self.speed[1] < self.speed[0] {
            return Err(ParticleError::Invalid(
                "speed must be an ordered [min, max] range",
            ));
        }
        if self.drag < 0.0 {
            return Err(ParticleError::Invalid("drag must not be negative"));
        }
        if self.size_lut.len() != PARTICLE_LUT_SAMPLES {
            return Err(ParticleError::Invalid(
                "size look-up table must have 32 samples",
            ));
        }
        if self.color_lut.len() != PARTICLE_LUT_SAMPLES * 4 {
            return Err(ParticleError::Invalid(
                "colour look-up table must have 32 RGBA samples",
            ));
        }
        Ok(())
    }

    fn shape_kind(&self) -> u32 {
        match self.shape {
            ParticleShapeKind::Point => 0,
            ParticleShapeKind::Sphere => 1,
            ParticleShapeKind::Box => 2,
            ParticleShapeKind::Cone => 3,
        }
    }

    /// The uniform block for one step.
    pub fn params(&self, dt: f32, spawn: u32, origin: [f32; 3], state: u32) -> ParticleParams {
        let mut size_lut = [[0.0; 4]; 8];
        for (i, v) in self.size_lut.iter().enumerate() {
            size_lut[i / 4][i % 4] = *v;
        }
        let mut color_lut = [[0.0; 4]; 32];
        for (i, v) in self.color_lut.iter().enumerate() {
            color_lut[i / 4][i % 4] = *v;
        }
        ParticleParams {
            gravity_dt: [self.gravity[0], self.gravity[1], self.gravity[2], dt],
            origin_decay: [
                origin[0],
                origin[1],
                origin[2],
                if self.drag == 1.0 {
                    1.0
                } else {
                    self.drag.powf(dt)
                },
            ],
            lifetime_speed: [
                self.lifetime[0],
                self.lifetime[1],
                self.speed[0],
                self.speed[1],
            ],
            shape: [
                self.shape_kind() as f32,
                self.shape_size[0],
                self.shape_size[1],
                self.shape_size[2],
            ],
            angle_spin: [
                self.cone_angle.to_radians(),
                self.angular_speed[0],
                self.angular_speed[1],
                0.0,
            ],
            counts: [
                spawn,
                self.capacity,
                state,
                match self.blend {
                    ParticleBlend::Alpha => 0,
                    ParticleBlend::Additive => 1,
                },
            ],
            size_lut,
            color_lut,
        }
    }
}

/// Cumulative counters, exact on the CPU path.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct ParticleCounters {
    pub emitted: u32,
    pub expired: u32,
    pub dropped: u32,
}

/// `seededRandom` from particles.ts: xorshift32, then a six-digit fraction.
pub fn seed_state(seed: u32) -> u32 {
    if seed == 0 { 0x9e37_79b9 } else { seed }
}

fn xorshift(mut s: u32) -> u32 {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    s
}

fn draw(state: &mut u32) -> f32 {
    *state = xorshift(*state);
    (*state % 1_000_000) as f32 / 1_000_000.0
}

fn unit_direction(state: &mut u32) -> [f32; 3] {
    let z = draw(state) * 2.0 - 1.0;
    let theta = draw(state) * std::f32::consts::PI * 2.0;
    let r = (1.0 - z * z).max(0.0).sqrt();
    [theta.cos() * r, z, theta.sin() * r]
}

/// One spawned particle, advancing `state` exactly as the shader's thread
/// for that spawn does (and as `ParticleEmitter.#spawn` does).
pub fn spawn_particle(params: &ParticleParams, state: &mut u32) -> GpuParticle {
    let size = [params.shape[1], params.shape[2], params.shape[3]];
    let (offset, direction) = match params.shape[0] as u32 {
        1 => {
            let direction = unit_direction(state);
            let radius = size[0] * draw(state).powf(1.0 / 3.0);
            (direction.map(|d| d * radius), direction)
        }
        2 => {
            let offset = [0, 1, 2].map(|axis| (draw(state) * 2.0 - 1.0) * size[axis]);
            (offset, unit_direction(state))
        }
        3 => {
            let theta = draw(state) * std::f32::consts::PI * 2.0;
            let spread = params.angle_spin[0].tan() * draw(state);
            let cone = [theta.cos() * spread, 1.0, theta.sin() * spread];
            let radius = size[0] * draw(state);
            let length = (cone[0] * cone[0] + cone[1] * cone[1] + cone[2] * cone[2]).sqrt();
            (
                [theta.cos() * radius, 0.0, theta.sin() * radius],
                cone.map(|c| c / length),
            )
        }
        _ => ([0.0; 3], unit_direction(state)),
    };
    let speed = params.lifetime_speed[2]
        + draw(state) * (params.lifetime_speed[3] - params.lifetime_speed[2]);
    let life = params.lifetime_speed[0]
        + draw(state) * (params.lifetime_speed[1] - params.lifetime_speed[0]);
    let rotation = draw(state) * std::f32::consts::PI * 2.0;
    let spin = params.angle_spin[1] + draw(state) * (params.angle_spin[2] - params.angle_spin[1]);
    GpuParticle {
        position_age: [
            params.origin_decay[0] + offset[0],
            params.origin_decay[1] + offset[1],
            params.origin_decay[2] + offset[2],
            0.0,
        ],
        velocity_life: [
            direction[0] * speed,
            direction[1] * speed,
            direction[2] * speed,
            life,
        ],
        rotation_spin: [rotation, spin, 0.0, 0.0],
    }
}

/// The CPU fallback for one step: spawn `params.counts[0]` particles (dropping
/// past capacity), then age, integrate, and drop the expired — the same
/// arithmetic as `spawn` and `update` in particles_sim.wgsl. Survivors keep
/// their order; the GPU's compaction order comes from atomics, so the two
/// agree as sets. Returns the generator state after the spawns.
pub fn step_cpu(
    particles: &mut Vec<GpuParticle>,
    params: &ParticleParams,
    counters: &mut ParticleCounters,
) -> u32 {
    let mut state = params.counts[2];
    for _ in 0..params.counts[0] {
        let particle = spawn_particle(params, &mut state);
        if particles.len() as u32 >= params.counts[1] {
            counters.dropped += 1;
            continue;
        }
        counters.emitted += 1;
        particles.push(particle);
    }
    let dt = params.gravity_dt[3];
    let decay = params.origin_decay[3];
    particles.retain_mut(|particle| {
        let age = particle.position_age[3] + dt;
        if age >= particle.velocity_life[3] {
            counters.expired += 1;
            return false;
        }
        for (axis, gravity) in params.gravity_dt[..3].iter().enumerate() {
            let velocity = (particle.velocity_life[axis] + gravity * dt) * decay;
            particle.velocity_life[axis] = velocity;
            particle.position_age[axis] += velocity * dt;
        }
        particle.position_age[3] = age;
        particle.rotation_spin[0] += particle.rotation_spin[1] * dt;
        true
    });
    state
}

/// Shared pipelines: two compute entry points and the billboard pipeline.
pub(crate) struct ParticlesGpu {
    sim_layout: wgpu::BindGroupLayout,
    spawn_pipeline: wgpu::ComputePipeline,
    update_pipeline: wgpu::ComputePipeline,
    draw_layout: wgpu::BindGroupLayout,
    pub(crate) draw_pipeline: wgpu::RenderPipeline,
}

impl ParticlesGpu {
    pub(crate) fn new(
        device: &wgpu::Device,
        frame_layout: &wgpu::BindGroupLayout,
        sim_shader: &wgpu::ShaderModule,
        draw_shader: &wgpu::ShaderModule,
    ) -> Self {
        let storage = |binding: u32, visibility: wgpu::ShaderStages, read_only: bool| {
            wgpu::BindGroupLayoutEntry {
                binding,
                visibility,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }
        };
        let compute = wgpu::ShaderStages::COMPUTE;
        let sim_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Vapour particle sim layout"),
            entries: &[
                uniform_layout_entry(0, compute),
                storage(1, compute, false),
                storage(2, compute, false),
                storage(3, compute, false),
                storage(4, compute, false),
                storage(5, compute, false),
            ],
        });
        let sim_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Vapour particle sim pipeline layout"),
            bind_group_layouts: &[Some(&sim_layout)],
            immediate_size: 0,
        });
        let compute_pipeline = |entry: &str| {
            device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(&format!("Vapour particle {entry}")),
                layout: Some(&sim_pipeline_layout),
                module: sim_shader,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        let draw_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("Vapour particle draw layout"),
            entries: &[
                uniform_layout_entry(0, wgpu::ShaderStages::VERTEX_FRAGMENT),
                storage(1, wgpu::ShaderStages::VERTEX, true),
            ],
        });
        let draw_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("Vapour particle draw pipeline layout"),
            bind_group_layouts: &[Some(frame_layout), Some(&draw_layout)],
            immediate_size: 0,
        });
        let draw_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("Vapour particle billboard pipeline"),
            layout: Some(&draw_pipeline_layout),
            vertex: wgpu::VertexState {
                module: draw_shader,
                entry_point: Some("vertex_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                cull_mode: None,
                ..Default::default()
            },
            depth_stencil: Some(wgpu::DepthStencilState {
                format: DEPTH_FORMAT,
                depth_write_enabled: Some(false),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: draw_shader,
                entry_point: Some("fragment_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: HDR_FORMAT,
                    // The fragment stage premultiplies, and writes alpha 0
                    // for additive particles, so one blend covers both.
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        Self {
            spawn_pipeline: compute_pipeline("spawn"),
            update_pipeline: compute_pipeline("update"),
            sim_layout,
            draw_layout,
            draw_pipeline,
        }
    }
}

/// Which path a system stepped on and what it knows about its population.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParticleSystemStats {
    pub gpu: bool,
    /// Spawns requested so far, both paths.
    pub requested: u32,
    /// Exact on the CPU path; `None` on the GPU path, where the population
    /// never leaves the device.
    pub alive: Option<u32>,
    pub emitted: Option<u32>,
    pub expired: Option<u32>,
    pub dropped: Option<u32>,
}

/// One live system: its ping-pong buffers and, on the CPU path, its
/// particles. `current` indexes the buffer the next draw reads and the next
/// step consumes.
pub(crate) struct ParticleSystemGpu {
    descriptor: ParticleSystemDescriptor,
    gpu: bool,
    state: u32,
    requested: u32,
    counters: ParticleCounters,
    cpu: Vec<GpuParticle>,
    buffers: [wgpu::Buffer; 2],
    args: [wgpu::Buffer; 2],
    counters_buffer: wgpu::Buffer,
    params: wgpu::Buffer,
    sim_bind_groups: [wgpu::BindGroup; 2],
    draw_bind_groups: [wgpu::BindGroup; 2],
    current: usize,
}

impl ParticleSystemGpu {
    pub(crate) fn new(
        device: &wgpu::Device,
        shared: &ParticlesGpu,
        descriptor: ParticleSystemDescriptor,
        gpu: bool,
    ) -> Self {
        let buffer = |label: &str, size: u64, usage: wgpu::BufferUsages| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size,
                usage,
                mapped_at_creation: false,
            })
        };
        let particles = wgpu::BufferUsages::STORAGE
            | wgpu::BufferUsages::COPY_DST
            | wgpu::BufferUsages::COPY_SRC;
        let args_usage = particles | wgpu::BufferUsages::INDIRECT;
        let pool = (descriptor.capacity as usize * PARTICLE_STRIDE) as u64;
        let buffers = [
            buffer("Vapour particles A", pool, particles),
            buffer("Vapour particles B", pool, particles),
        ];
        let args = [
            buffer("Vapour particle args A", 16, args_usage),
            buffer("Vapour particle args B", 16, args_usage),
        ];
        let counters_buffer = buffer("Vapour particle counters", 16, particles);
        let params = buffer(
            "Vapour particle params",
            std::mem::size_of::<ParticleParams>() as u64,
            wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        );
        let sim_bind_group = |input: usize| {
            let output = 1 - input;
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Vapour particle sim bind group"),
                layout: &shared.sim_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: params.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: buffers[input].as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: args[input].as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 3,
                        resource: buffers[output].as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 4,
                        resource: args[output].as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 5,
                        resource: counters_buffer.as_entire_binding(),
                    },
                ],
            })
        };
        let draw_bind_group = |index: usize| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("Vapour particle draw bind group"),
                layout: &shared.draw_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: params.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: buffers[index].as_entire_binding(),
                    },
                ],
            })
        };
        let sim_bind_groups = [sim_bind_group(0), sim_bind_group(1)];
        let draw_bind_groups = [draw_bind_group(0), draw_bind_group(1)];
        Self {
            state: seed_state(descriptor.seed),
            descriptor,
            gpu,
            requested: 0,
            counters: ParticleCounters::default(),
            cpu: Vec::new(),
            buffers,
            args,
            counters_buffer,
            params,
            sim_bind_groups,
            draw_bind_groups,
            current: 0,
        }
    }

    /// Resets both args records and the counters; call once after creation
    /// and on `clear`.
    pub(crate) fn reset(&mut self, queue: &wgpu::Queue) {
        let empty = DrawArgs {
            vertex_count: QUAD_VERTICES,
            instance_count: 0,
            first_vertex: 0,
            first_instance: 0,
        };
        for args in &self.args {
            queue.write_buffer(args, 0, bytemuck::bytes_of(&empty));
        }
        queue.write_buffer(&self.counters_buffer, 0, &[0; 16]);
        self.cpu.clear();
        self.counters = ParticleCounters::default();
        self.requested = 0;
        self.state = seed_state(self.descriptor.seed);
    }

    /// Advances the system one step: `spawn` new particles at `origin`, then
    /// integrate by `dt`. On the GPU path this submits its own command
    /// buffer; on the CPU path it uploads the stepped population.
    pub(crate) fn step(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        shared: &ParticlesGpu,
        dt: f32,
        spawn: u32,
        origin: [f32; 3],
    ) {
        let spawn = spawn.min(self.descriptor.capacity);
        let params = self.descriptor.params(dt, spawn, origin, self.state);
        queue.write_buffer(&self.params, 0, bytemuck::bytes_of(&params));
        self.requested += spawn;
        // The generator advances by exactly the draws the spawns consume,
        // on both paths, so later frames stay in step with a serial emitter.
        if !self.gpu {
            self.state = step_cpu(&mut self.cpu, &params, &mut self.counters);
            if !self.cpu.is_empty() {
                queue.write_buffer(
                    &self.buffers[self.current],
                    0,
                    bytemuck::cast_slice(&self.cpu),
                );
            }
            queue.write_buffer(
                &self.args[self.current],
                0,
                bytemuck::bytes_of(&DrawArgs {
                    vertex_count: QUAD_VERTICES,
                    instance_count: self.cpu.len() as u32,
                    first_vertex: 0,
                    first_instance: 0,
                }),
            );
            return;
        }
        let mut state = self.state;
        for _ in 0..spawn * draws_per_spawn(params.shape[0] as u32) {
            state = xorshift(state);
        }
        self.state = state;
        let output = 1 - self.current;
        queue.write_buffer(
            &self.args[output],
            0,
            bytemuck::bytes_of(&DrawArgs {
                vertex_count: QUAD_VERTICES,
                instance_count: 0,
                first_vertex: 0,
                first_instance: 0,
            }),
        );
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("Vapour particle step"),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("Vapour particle step"),
                timestamp_writes: None,
            });
            pass.set_bind_group(0, &self.sim_bind_groups[self.current], &[]);
            if spawn > 0 {
                pass.set_pipeline(&shared.spawn_pipeline);
                pass.dispatch_workgroups(spawn.div_ceil(WORKGROUP_SIZE), 1, 1);
            }
            pass.set_pipeline(&shared.update_pipeline);
            pass.dispatch_workgroups(self.descriptor.capacity.div_ceil(WORKGROUP_SIZE), 1, 1);
        }
        queue.submit([encoder.finish()]);
        self.current = output;
    }

    pub(crate) fn stats(&self) -> ParticleSystemStats {
        let cpu = |value: u32| if self.gpu { None } else { Some(value) };
        ParticleSystemStats {
            gpu: self.gpu,
            requested: self.requested,
            alive: cpu(self.cpu.len() as u32),
            emitted: cpu(self.counters.emitted),
            expired: cpu(self.counters.expired),
            dropped: cpu(self.counters.dropped),
        }
    }

    /// Records one draw of the live population into `pass`, whose bind
    /// group 0 is already the frame uniforms.
    pub(crate) fn draw(&self, pass: &mut wgpu::RenderPass<'_>) -> bool {
        if !self.gpu && self.cpu.is_empty() {
            return false;
        }
        pass.set_bind_group(1, &self.draw_bind_groups[self.current], &[]);
        if self.gpu {
            pass.draw_indirect(&self.args[self.current], 0);
        } else {
            pass.draw(0..QUAD_VERTICES, 0..self.cpu.len() as u32);
        }
        true
    }

    #[cfg(test)]
    fn live_buffers(&self) -> (&wgpu::Buffer, &wgpu::Buffer, &wgpu::Buffer) {
        (
            &self.buffers[self.current],
            &self.args[self.current],
            &self.counters_buffer,
        )
    }
}

fn draws_per_spawn(kind: u32) -> u32 {
    match kind {
        1 | 3 => 7,
        2 => 9,
        _ => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor(shape: ParticleShapeKind) -> ParticleSystemDescriptor {
        ParticleSystemDescriptor {
            capacity: 256,
            lifetime: [1.0, 2.0],
            speed: [1.0, 3.0],
            gravity: [0.0, -9.81, 0.0],
            drag: 1.0,
            shape,
            shape_size: [1.0, 1.0, 1.0],
            cone_angle: 25.0,
            angular_speed: [0.0, 0.0],
            seed: 1,
            blend: ParticleBlend::Alpha,
            size_lut: vec![1.0; 32],
            color_lut: (0..32)
                .flat_map(|i| [1.0, 1.0, 1.0, 1.0 - i as f32 / 31.0])
                .collect(),
        }
    }

    #[test]
    fn buffer_layout_matches_the_shader_structs() {
        assert_eq!(PARTICLE_STRIDE, 48);
        assert_eq!(std::mem::size_of::<ParticleParams>(), 736);
        assert_eq!(std::mem::offset_of!(ParticleParams, counts), 80);
        assert_eq!(std::mem::offset_of!(ParticleParams, size_lut), 96);
        assert_eq!(std::mem::offset_of!(ParticleParams, color_lut), 224);
        assert_eq!(std::mem::size_of::<DrawArgs>(), 16);
        assert_eq!(std::mem::offset_of!(GpuParticle, velocity_life), 16);
        assert_eq!(std::mem::offset_of!(GpuParticle, rotation_spin), 32);
    }

    #[test]
    fn the_generator_matches_particles_ts() {
        // `seededRandom(1)` in particles.ts: first three draws.
        let mut state = seed_state(1);
        let first: Vec<f32> = (0..3).map(|_| draw(&mut state)).collect();
        assert_eq!(first, [0.270369, 0.634689, 0.435461]);
        assert_eq!(seed_state(0), 0x9e37_79b9);
    }

    #[test]
    fn spawns_consume_the_documented_number_of_draws() {
        for (shape, draws) in [
            (ParticleShapeKind::Point, 6),
            (ParticleShapeKind::Sphere, 7),
            (ParticleShapeKind::Box, 9),
            (ParticleShapeKind::Cone, 7),
        ] {
            let params = descriptor(shape).params(0.0, 1, [0.0; 3], seed_state(1));
            let mut state = seed_state(1);
            spawn_particle(&params, &mut state);
            let mut expected = seed_state(1);
            for _ in 0..draws {
                expected = xorshift(expected);
            }
            assert_eq!(state, expected, "{shape:?}");
            assert_eq!(draws_per_spawn(params.shape[0] as u32), draws);
        }
    }

    #[test]
    fn the_cpu_step_spawns_integrates_and_expires() {
        let mut descriptor = descriptor(ParticleShapeKind::Point);
        descriptor.capacity = 4;
        let mut particles = Vec::new();
        let mut counters = ParticleCounters::default();
        let params = descriptor.params(0.5, 6, [1.0, 2.0, 3.0], seed_state(7));
        let state = step_cpu(&mut particles, &params, &mut counters);
        assert_eq!(particles.len(), 4);
        assert_eq!(
            counters,
            ParticleCounters {
                emitted: 4,
                expired: 0,
                dropped: 2
            }
        );
        assert_ne!(state, seed_state(7));
        for p in &particles {
            assert_eq!(p.position_age[3], 0.5);
            assert!(p.velocity_life[3] >= 1.0 && p.velocity_life[3] <= 2.0);
            // Fell under gravity for half a second from the origin.
            assert!(p.position_age[1] < 2.0 + p.velocity_life[1] * 0.5 + 1e-5);
        }
        // Step past every lifetime: all expire.
        let params = descriptor.params(2.0, 0, [0.0; 3], state);
        step_cpu(&mut particles, &params, &mut counters);
        assert!(particles.is_empty());
        assert_eq!(counters.expired, 4);
    }

    #[test]
    fn descriptors_are_validated() {
        let mut bad = descriptor(ParticleShapeKind::Point);
        bad.capacity = 0;
        assert_eq!(bad.validate(), Err(ParticleError::Capacity(0)));
        let mut bad = descriptor(ParticleShapeKind::Point);
        bad.size_lut.pop();
        assert!(bad.validate().is_err());
        let mut bad = descriptor(ParticleShapeKind::Point);
        bad.lifetime = [2.0, 1.0];
        assert!(bad.validate().is_err());
        assert!(descriptor(ParticleShapeKind::Cone).validate().is_ok());
    }

    /// Reads the live population of a system back from the device.
    fn read_back(
        gpu: &crate::test_gpu::TestGpu,
        system: &ParticleSystemGpu,
    ) -> (Vec<GpuParticle>, ParticleCounters) {
        let (particles, args, counters) = system.live_buffers();
        let args: DrawArgs = *bytemuck::from_bytes(&gpu.read_buffer(args, 16));
        assert_eq!(args.vertex_count, 6);
        let bytes = gpu.read_buffer(
            particles,
            (args.instance_count as usize * PARTICLE_STRIDE).max(4) as u64,
        );
        let live =
            bytemuck::cast_slice(&bytes[..args.instance_count as usize * PARTICLE_STRIDE]).to_vec();
        let counters: [u32; 4] = *bytemuck::from_bytes(&gpu.read_buffer(counters, 16));
        (
            live,
            ParticleCounters {
                emitted: counters[0],
                expired: counters[1],
                dropped: counters[2],
            },
        )
    }

    fn sorted_by_life(mut particles: Vec<GpuParticle>) -> Vec<GpuParticle> {
        particles.sort_by(|a, b| {
            a.velocity_life[3]
                .total_cmp(&b.velocity_life[3])
                .then(a.rotation_spin[0].total_cmp(&b.rotation_spin[0]))
        });
        particles
    }

    fn assert_close(gpu: &[GpuParticle], cpu: &[GpuParticle], tolerance: f32) {
        assert_eq!(gpu.len(), cpu.len(), "population differs");
        for (g, c) in gpu.iter().zip(cpu) {
            for (a, b) in g
                .position_age
                .iter()
                .chain(&g.velocity_life)
                .chain(&g.rotation_spin)
                .zip(
                    c.position_age
                        .iter()
                        .chain(&c.velocity_life)
                        .chain(&c.rotation_spin),
                )
            {
                assert!(
                    (a - b).abs() <= tolerance * (1.0 + b.abs()),
                    "gpu {g:?}\ncpu {c:?}"
                );
            }
        }
    }

    fn shared(gpu: &crate::test_gpu::TestGpu) -> ParticlesGpu {
        let shaders = crate::ShaderLibrary::standard().unwrap();
        let frame_layout = super::super::pipeline::create_frame_layout(&gpu.device);
        ParticlesGpu::new(
            &gpu.device,
            &frame_layout,
            &shaders
                .create_module(&gpu.device, "vapour.particles-sim")
                .unwrap(),
            &shaders
                .create_module(&gpu.device, "vapour.particles")
                .unwrap(),
        )
    }

    /// Real-device check: for every shape, three GPU steps (a burst, then a
    /// spawn-and-integrate, then a step past every lifetime) match the CPU
    /// fallback particle for particle to float tolerance, counters included.
    #[test]
    fn gpu_steps_match_the_cpu_fallback_for_every_shape() {
        let Some(gpu) = crate::test_gpu::device() else {
            return;
        };
        let shared = shared(&gpu);
        for shape in [
            ParticleShapeKind::Point,
            ParticleShapeKind::Sphere,
            ParticleShapeKind::Box,
            ParticleShapeKind::Cone,
        ] {
            let mut descriptor = descriptor(shape);
            descriptor.capacity = 100;
            descriptor.angular_speed = [-1.0, 1.0];
            descriptor.drag = 0.5;
            descriptor.seed = 42;
            let mut on_gpu = ParticleSystemGpu::new(&gpu.device, &shared, descriptor.clone(), true);
            let mut on_cpu =
                ParticleSystemGpu::new(&gpu.device, &shared, descriptor.clone(), false);
            on_gpu.reset(&gpu.queue);
            on_cpu.reset(&gpu.queue);
            // Burst of 90 at the origin, then 5 more from a moved origin,
            // then a step that expires roughly a quarter of them.
            for (dt, spawn, origin) in [
                (1.0 / 60.0, 90, [0.0; 3]),
                (0.25, 5, [5.0, 0.0, -2.0]),
                (1.0, 0, [0.0; 3]),
            ] {
                on_gpu.step(&gpu.device, &gpu.queue, &shared, dt, spawn, origin);
                on_cpu.step(&gpu.device, &gpu.queue, &shared, dt, spawn, origin);
                let (live, counters) = read_back(&gpu, &on_gpu);
                let cpu = on_cpu.cpu.clone();
                eprintln!(
                    "{shape:?} dt {dt}: gpu {} live, cpu {} live, counters {counters:?}",
                    live.len(),
                    cpu.len()
                );
                assert_eq!(counters, on_cpu.counters, "{shape:?} counters");
                assert_close(&sorted_by_life(live), &sorted_by_life(cpu), 1e-4);
                assert_eq!(on_gpu.state, on_cpu.state, "{shape:?} generator state");
            }
            // Over capacity, both paths drop the excess and agree on how
            // much; *which* spawns the GPU drops depends on atomic order, so
            // only the counts are compared here.
            on_gpu.step(&gpu.device, &gpu.queue, &shared, 0.01, 60, [0.0; 3]);
            on_cpu.step(&gpu.device, &gpu.queue, &shared, 0.01, 60, [0.0; 3]);
            let (live, counters) = read_back(&gpu, &on_gpu);
            eprintln!(
                "{shape:?} over capacity: gpu {} live, cpu {} live, counters {counters:?}",
                live.len(),
                on_cpu.cpu.len()
            );
            assert_eq!(
                live.len(),
                on_cpu.cpu.len(),
                "{shape:?} population after drops"
            );
            assert_eq!(counters, on_cpu.counters, "{shape:?} drop counters");
            assert!(counters.dropped > 0 && counters.emitted + counters.dropped == 155);
            let stats = on_gpu.stats();
            assert_eq!((stats.gpu, stats.requested, stats.alive), (true, 155, None));
            let stats = on_cpu.stats();
            assert_eq!(
                (stats.gpu, stats.requested, stats.alive, stats.dropped),
                (
                    false,
                    155,
                    Some(on_cpu.cpu.len() as u32),
                    Some(on_cpu.counters.dropped)
                )
            );
        }
    }

    /// Real-device check against `ParticleEmitter` in particles.ts: the
    /// golden below is `new ParticleEmitter({ capacity: 8, burst: 8, rate:
    /// 0, seed: 1 })`, `play()`, `update(1 / 60)`, `buffers()` — the eight
    /// positions and rotations, and lifetimes recovered from `ages`.
    /// `gpu-particles.test.ts` regenerates the same values from the emitter
    /// and fails if this file drifts from them.
    #[test]
    fn a_gpu_burst_matches_the_typescript_emitter() {
        let Some(gpu) = crate::test_gpu::device() else {
            return;
        };
        let golden: Vec<([f32; 3], f32, f32)> =
            serde_json::from_str(include_str!("particles_golden.json")).unwrap();
        let shared = shared(&gpu);
        let mut descriptor = descriptor(ParticleShapeKind::Point);
        descriptor.capacity = 8;
        let mut system = ParticleSystemGpu::new(&gpu.device, &shared, descriptor, true);
        system.reset(&gpu.queue);
        system.step(&gpu.device, &gpu.queue, &shared, 1.0 / 60.0, 8, [0.0; 3]);
        let (live, counters) = read_back(&gpu, &system);
        assert_eq!(
            counters,
            ParticleCounters {
                emitted: 8,
                expired: 0,
                dropped: 0
            }
        );
        let mut live: Vec<_> = live
            .into_iter()
            .map(|p| {
                (
                    [p.position_age[0], p.position_age[1], p.position_age[2]],
                    p.rotation_spin[0],
                    p.velocity_life[3],
                )
            })
            .collect();
        live.sort_by(|a, b| a.2.total_cmp(&b.2));
        let mut expected = golden.clone();
        expected.sort_by(|a, b| a.2.total_cmp(&b.2));
        assert_eq!(live.len(), 8);
        for (got, want) in live.iter().zip(&expected) {
            for axis in 0..3 {
                assert!(
                    (got.0[axis] - want.0[axis]).abs() < 1e-4,
                    "position {got:?} vs {want:?}"
                );
            }
            assert!(
                (got.1 - want.1).abs() < 1e-4,
                "rotation {got:?} vs {want:?}"
            );
            assert!(
                (got.2 - want.2).abs() < 1e-3,
                "lifetime {got:?} vs {want:?}"
            );
        }
    }
}
