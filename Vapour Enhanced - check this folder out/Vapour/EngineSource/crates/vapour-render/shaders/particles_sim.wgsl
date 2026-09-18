// GPU particle simulation: spawn, update, compact.
//
// One system is two ping-pong particle buffers plus an indirect-draw record
// whose `instance_count` doubles as the live count. Each frame runs, in
// order: `spawn` appends this frame's new particles to the *input* buffer
// (claiming slots with an atomic on its count, dropping past capacity),
// then `update` ages and integrates every input particle and compacts the
// survivors into the *output* buffer with an atomic on its count. The
// output is then drawn with `draw_indirect` (particles.wgsl) and becomes
// next frame's input.
// `particles.rs` runs the same arithmetic on the CPU (`step_cpu`) and a
// real-device test asserts the two agree.
//
// The spawn arithmetic mirrors `ParticleEmitter.#spawn` in
// packages/engine/src/particles/particles.ts, including its xorshift32
// generator and draw order, so a seed produces the same burst on both.

// Mirrors `GpuParticle` (3 × vec4, 48 bytes).
struct Particle {
    // xyz position, w age in seconds.
    position_age: vec4<f32>,
    // xyz velocity, w lifetime in seconds.
    velocity_life: vec4<f32>,
    // x rotation (radians), y spin (radians/s), zw reserved.
    rotation_spin: vec4<f32>,
}

// Mirrors `ParticleParams`.
struct Params {
    // xyz gravity, w delta seconds.
    gravity_dt: vec4<f32>,
    // xyz emitter origin, w drag decay for this step (drag ^ dt).
    origin_decay: vec4<f32>,
    // lifetime min, lifetime max, speed min, speed max.
    lifetime_speed: vec4<f32>,
    // x shape kind (0 point, 1 sphere, 2 box, 3 cone), yzw shape size.
    shape: vec4<f32>,
    // x cone half-angle (radians), y spin min, z spin max, w reserved.
    angle_spin: vec4<f32>,
    // x spawn count, y capacity, z generator state, w blend (0 alpha, 1 additive).
    counts: vec4<u32>,
    // Size over normalized lifetime, 32 samples.
    size_lut: array<vec4<f32>, 8>,
    // Colour over normalized lifetime, 32 samples.
    color_lut: array<vec4<f32>, 32>,
}

// Mirrors `wgpu::util::DrawIndirectArgs`; `instance_count` is the live count.
struct DrawArgs {
    vertex_count: u32,
    instance_count: atomic<u32>,
    first_vertex: u32,
    first_instance: u32,
}

// Cumulative counters: x emitted, y expired, z dropped, w reserved.
struct Counters {
    emitted: atomic<u32>,
    expired: atomic<u32>,
    dropped: atomic<u32>,
    reserved: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> input: array<Particle>;
@group(0) @binding(2) var<storage, read_write> input_args: DrawArgs;
@group(0) @binding(3) var<storage, read_write> output: array<Particle>;
@group(0) @binding(4) var<storage, read_write> output_args: DrawArgs;
@group(0) @binding(5) var<storage, read_write> counters: Counters;

const PI: f32 = 3.14159265358979;

// xorshift32 exactly as `seededRandom` in particles.ts.
fn xorshift(state: u32) -> u32 {
    var s = state;
    s ^= s << 13u;
    s ^= s >> 17u;
    s ^= s << 5u;
    return s;
}

fn draw(state: ptr<function, u32>) -> f32 {
    *state = xorshift(*state);
    return f32(*state % 1000000u) / 1000000.0;
}

// How many generator draws one spawn of this shape consumes.
fn draws_per_spawn(kind: u32) -> u32 {
    switch kind {
        case 1u: { return 7u; }
        case 2u: { return 9u; }
        case 3u: { return 7u; }
        default: { return 6u; }
    }
}

fn unit_direction(state: ptr<function, u32>) -> vec3<f32> {
    let z = draw(state) * 2.0 - 1.0;
    let theta = draw(state) * PI * 2.0;
    let r = sqrt(max(0.0, 1.0 - z * z));
    return vec3<f32>(cos(theta) * r, z, sin(theta) * r);
}

@compute @workgroup_size(64)
fn spawn(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= params.counts.x {
        return;
    }
    let kind = u32(params.shape.x);
    // Thread k consumes the k-th run of draws from the shared generator, so
    // the burst is the same sequence a serial emitter would produce.
    var state = params.counts.z;
    for (var step = 0u; step < id.x * draws_per_spawn(kind); step = step + 1u) {
        state = xorshift(state);
    }
    let size = params.shape.yzw;
    var offset = vec3<f32>(0.0);
    var direction = vec3<f32>(0.0, 1.0, 0.0);
    switch kind {
        case 1u: {
            direction = unit_direction(&state);
            let radius = size.x * pow(draw(&state), 1.0 / 3.0);
            offset = direction * radius;
        }
        case 2u: {
            offset = vec3<f32>(draw(&state) * 2.0 - 1.0, draw(&state) * 2.0 - 1.0, draw(&state) * 2.0 - 1.0) * size;
            direction = unit_direction(&state);
        }
        case 3u: {
            let theta = draw(&state) * PI * 2.0;
            let spread = tan(params.angle_spin.x) * draw(&state);
            let cone = vec3<f32>(cos(theta) * spread, 1.0, sin(theta) * spread);
            let radius = size.x * draw(&state);
            offset = vec3<f32>(cos(theta) * radius, 0.0, sin(theta) * radius);
            direction = cone / length(cone);
        }
        default: {
            direction = unit_direction(&state);
        }
    }
    let speed = params.lifetime_speed.z + draw(&state) * (params.lifetime_speed.w - params.lifetime_speed.z);
    let life = params.lifetime_speed.x + draw(&state) * (params.lifetime_speed.y - params.lifetime_speed.x);
    let rotation = draw(&state) * PI * 2.0;
    let spin = params.angle_spin.y + draw(&state) * (params.angle_spin.z - params.angle_spin.y);

    let slot = atomicAdd(&input_args.instance_count, 1u);
    if slot >= params.counts.y {
        // Over capacity: give the slot back. Every over-capacity thread adds
        // and subtracts one, so the count settles at exactly the live total.
        atomicSub(&input_args.instance_count, 1u);
        atomicAdd(&counters.dropped, 1u);
        return;
    }
    atomicAdd(&counters.emitted, 1u);
    input[slot] = Particle(
        vec4<f32>(params.origin_decay.xyz + offset, 0.0),
        vec4<f32>(direction * speed, life),
        vec4<f32>(rotation, spin, 0.0, 0.0),
    );
}

@compute @workgroup_size(64)
fn update(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= atomicLoad(&input_args.instance_count) {
        return;
    }
    var particle = input[id.x];
    let dt = params.gravity_dt.w;
    let age = particle.position_age.w + dt;
    if age >= particle.velocity_life.w {
        atomicAdd(&counters.expired, 1u);
        return;
    }
    let velocity = (particle.velocity_life.xyz + params.gravity_dt.xyz * dt) * params.origin_decay.w;
    particle.position_age = vec4<f32>(particle.position_age.xyz + velocity * dt, age);
    particle.velocity_life = vec4<f32>(velocity, particle.velocity_life.w);
    particle.rotation_spin.x = particle.rotation_spin.x + particle.rotation_spin.y * dt;
    let slot = atomicAdd(&output_args.instance_count, 1u);
    output[slot] = particle;
}
