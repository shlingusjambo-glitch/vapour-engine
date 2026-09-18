// GPU particle billboards: draws the compacted output buffer of
// `particles_sim.wgsl` as camera-facing soft discs, one instance per
// particle, six vertices each, via `draw_indirect` (or `draw` with the CPU
// fallback's count). Size and colour over lifetime come from the 32-sample
// look-up tables the host bakes from its curve and gradient.

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

struct FrameUniforms {
    view_projection: mat4x4<f32>,
    inverse_view_projection: mat4x4<f32>,
    camera_position: vec3<f32>,
    exposure: f32,
    camera_forward: vec4<f32>,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(1) @binding(0) var<uniform> draw_params: Params;
@group(1) @binding(1) var<storage, read> particles: array<Particle>;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
}

fn sample_lut_scalar(t: f32) -> f32 {
    let x = clamp(t, 0.0, 1.0) * 31.0;
    let i = u32(floor(x));
    let j = min(i + 1u, 31u);
    let a = draw_params.size_lut[i / 4u][i % 4u];
    let b = draw_params.size_lut[j / 4u][j % 4u];
    return mix(a, b, x - floor(x));
}

fn sample_lut_color(t: f32) -> vec4<f32> {
    let x = clamp(t, 0.0, 1.0) * 31.0;
    let i = u32(floor(x));
    let j = min(i + 1u, 31u);
    return mix(draw_params.color_lut[i], draw_params.color_lut[j], x - floor(x));
}

@vertex
fn vertex_main(
    @builtin(vertex_index) vertex: u32,
    @builtin(instance_index) instance: u32,
) -> VertexOutput {
    let particle = particles[instance];
    let t = particle.position_age.w / max(particle.velocity_life.w, 0.000001);
    let corner = array<vec2<f32>, 6>(
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, -0.5), vec2<f32>(0.5, 0.5),
        vec2<f32>(-0.5, -0.5), vec2<f32>(0.5, 0.5), vec2<f32>(-0.5, 0.5),
    )[vertex];
    let rotation = particle.rotation_spin.x;
    let rotated = vec2<f32>(
        corner.x * cos(rotation) - corner.y * sin(rotation),
        corner.x * sin(rotation) + corner.y * cos(rotation),
    );
    // ponytail: camera basis from forward × world up; degenerate looking
    // straight down. Ship a view-matrix basis if that ever matters.
    let forward = normalize(frame.camera_forward.xyz);
    var right = cross(forward, vec3<f32>(0.0, 1.0, 0.0));
    if dot(right, right) < 0.0001 {
        right = vec3<f32>(1.0, 0.0, 0.0);
    }
    right = normalize(right);
    let up = cross(right, forward);
    let size = sample_lut_scalar(t);
    let world = particle.position_age.xyz + (right * rotated.x + up * rotated.y) * size;
    var output: VertexOutput;
    output.position = frame.view_projection * vec4<f32>(world, 1.0);
    output.uv = corner + vec2<f32>(0.5);
    output.color = sample_lut_color(t);
    return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // A soft disc: full inside r = 0.35, feathered to nothing at the edge.
    let distance = length(input.uv - vec2<f32>(0.5));
    let coverage = 1.0 - smoothstep(0.35, 0.5, distance);
    let alpha = input.color.a * coverage;
    if draw_params.counts.w == 1u {
        // Additive: premultiplied colour, no destination attenuation.
        return vec4<f32>(input.color.rgb * alpha, 0.0);
    }
    return vec4<f32>(input.color.rgb * alpha, alpha);
}
