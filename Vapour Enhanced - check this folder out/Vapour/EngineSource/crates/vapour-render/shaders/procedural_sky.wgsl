struct GpuLight {
    vector_kind: vec4<f32>,
    color_intensity: vec4<f32>,
    secondary_range: vec4<f32>,
    cone: vec4<f32>,
}

struct FrameUniforms {
    view_projection: mat4x4<f32>,
    inverse_view_projection: mat4x4<f32>,
    camera_position: vec3<f32>,
    exposure: f32,
    camera_forward: vec4<f32>,
    light_count: f32,
    time: f32,
    reserved_0: f32,
    reserved_1: f32,
    fog_color_mode: vec4<f32>,
    fog_params: vec4<f32>,
    sky_zenith_mode: vec4<f32>,
    sky_horizon_curve: vec4<f32>,
    sky_ground_sun_size: vec4<f32>,
    lights: array<GpuLight, 64>,
    shadow_matrices: array<mat4x4<f32>, 4>,
    shadow_splits: vec4<f32>,
    shadow_params: vec4<f32>,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) clip_xy: vec2<f32>,
}

@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> VertexOutput {
    let xy = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    )[index];
    var output: VertexOutput;
    output.position = vec4<f32>(xy, 0.999999, 1.0);
    output.clip_xy = xy;
    return output;
}

fn world_ray(clip_xy: vec2<f32>) -> vec3<f32> {
    let far_world = frame.inverse_view_projection * vec4<f32>(clip_xy, 1.0, 1.0);
    let point = far_world.xyz / max(abs(far_world.w), 0.000001);
    return normalize(point - frame.camera_position);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let ray = world_ray(input.clip_xy);
    let up = clamp(ray.y, -1.0, 1.0);
    let curve = max(frame.sky_horizon_curve.w, 0.05);
    let above = pow(max(up, 0.0), curve);
    let below = pow(max(-up, 0.0), curve);
    var color = mix(frame.sky_horizon_curve.rgb, frame.sky_zenith_mode.rgb, above);
    color = mix(color, frame.sky_ground_sun_size.rgb, below);

    // The first live directional light supplies the celestial disc. This keeps
    // the visible sun aligned with the light that shades and casts shadows.
    let sun_size = max(frame.sky_ground_sun_size.w, 0.0001);
    for (var index = 0u; index < min(u32(frame.light_count), 64u); index += 1u) {
        let light = frame.lights[index];
        if (abs(light.vector_kind.w - 1.0) < 0.25) {
            let toward_sun = normalize(-light.vector_kind.xyz);
            let disc = smoothstep(cos(sun_size * 1.35), cos(sun_size), dot(ray, toward_sun));
            let glow = pow(max(dot(ray, toward_sun), 0.0), 256.0) * 0.18;
            color += light.color_intensity.rgb * light.color_intensity.w * (disc + glow);
            break;
        }
    }
    return vec4<f32>(max(color, vec3<f32>(0.0)), 1.0);
}
