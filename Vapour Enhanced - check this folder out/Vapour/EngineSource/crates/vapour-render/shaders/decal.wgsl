// Box-projected decals. Each decal is a unit cube in its own space; the pass
// draws that cube, reconstructs the world position under every covered pixel
// from the scene depth buffer, and keeps only pixels whose reconstructed
// position falls inside the box. The atlas is projected along the decal's
// local -Z axis. `decal_local_uv` in decal.rs is the CPU reference for the
// projection, and is tested against known points.
struct GpuLight {
    vector_kind: vec4<f32>,
    color_intensity: vec4<f32>,
    secondary_range: vec4<f32>,
    cone: vec4<f32>,
}

// Prefix of the frame uniforms shared with standard_pbr.wgsl.
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
@group(1) @binding(0) var scene_depth: texture_depth_2d;
@group(1) @binding(1) var atlas: texture_2d<f32>;
@group(1) @binding(2) var atlas_sampler: sampler;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) model_0: vec4<f32>,
    @location(2) model_1: vec4<f32>,
    @location(3) model_2: vec4<f32>,
    @location(4) model_3: vec4<f32>,
    @location(5) inverse_0: vec4<f32>,
    @location(6) inverse_1: vec4<f32>,
    @location(7) inverse_2: vec4<f32>,
    @location(8) inverse_3: vec4<f32>,
    // Atlas rectangle: u0, v0, u1, v1.
    @location(9) region: vec4<f32>,
    @location(10) tint: vec4<f32>,
    // x: opacity, y: cosine of the surface angle where the decal has faded
    // out, z: softness of that fade (in cosine), w: fraction of the box's
    // half depth over which alpha fades to zero at the ±Z faces.
    @location(11) params: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) inverse_0: vec4<f32>,
    @location(1) inverse_1: vec4<f32>,
    @location(2) inverse_2: vec4<f32>,
    @location(3) inverse_3: vec4<f32>,
    @location(4) region: vec4<f32>,
    @location(5) tint: vec4<f32>,
    @location(6) params: vec4<f32>,
    @location(7) axis: vec3<f32>,
}

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
    let model = mat4x4<f32>(input.model_0, input.model_1, input.model_2, input.model_3);
    var output: VertexOutput;
    output.clip_position = frame.view_projection * model * vec4<f32>(input.position, 1.0);
    output.inverse_0 = input.inverse_0;
    output.inverse_1 = input.inverse_1;
    output.inverse_2 = input.inverse_2;
    output.inverse_3 = input.inverse_3;
    output.region = input.region;
    output.tint = input.tint;
    output.params = input.params;
    // The decal projects along its local -Z; the world-space axis is the
    // model's third column.
    output.axis = normalize(input.model_2.xyz);
    return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(scene_depth));
    let texel = vec2<i32>(input.clip_position.xy);
    let depth = textureLoad(scene_depth, texel, 0);
    if depth >= 1.0 {
        discard;
    }
    let uv = input.clip_position.xy / size;
    let clip = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
    let world_h = frame.inverse_view_projection * clip;
    let world = world_h.xyz / world_h.w;
    let inverse = mat4x4<f32>(input.inverse_0, input.inverse_1, input.inverse_2, input.inverse_3);
    let local = (inverse * vec4<f32>(world, 1.0)).xyz;
    if any(abs(local) > vec3<f32>(0.5)) {
        discard;
    }
    // Same mapping as `decal_local_uv`: +X right, +Y up on the surface.
    let local_uv = vec2<f32>(local.x + 0.5, 0.5 - local.y);
    let atlas_uv = mix(input.region.xy, input.region.zw, local_uv);
    let sampled = textureSample(atlas, atlas_sampler, atlas_uv);

    // Surface normal from the reconstructed position's screen derivatives:
    // decals fade out on surfaces the projection hits at a glancing angle so
    // they do not smear down walls.
    let normal = normalize(cross(dpdx(world), dpdy(world)));
    let alignment = abs(dot(normal, input.axis));
    let cutoff = input.params.y;
    let softness = max(input.params.z, 0.0001);
    let angle_fade = smoothstep(cutoff - softness, cutoff, alignment);
    let z_fade = 1.0 - smoothstep(0.5 - max(input.params.w, 0.0001) * 0.5, 0.5, abs(local.z));

    let alpha = sampled.a * input.tint.a * input.params.x * angle_fade * z_fade;
    return vec4<f32>(sampled.rgb * input.tint.rgb, alpha);
}
