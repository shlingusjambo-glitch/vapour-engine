// One entry of the frame's light rig. The layout is four vec4s so the array
// stride matches the uniform address space's alignment rules exactly, and so a
// new light type can claim reserved lanes without moving the existing ones.
struct GpuLight {
    // xyz: direction of travel for directional and spot lights, world position
    // for point and spot lights. w: the light kind.
    vector_kind: vec4<f32>,
    // rgb: linear colour. w: intensity.
    color_intensity: vec4<f32>,
    // xyz: hemisphere ground colour, or a spot light's direction of travel.
    // w: range in metres for point and spot lights; 0 means unbounded.
    secondary_range: vec4<f32>,
    // x: cosine of the inner cone angle. y: cosine of the outer cone angle.
    cone: vec4<f32>,
}

const LIGHT_KIND_AMBIENT: f32 = 0.0;
const LIGHT_KIND_DIRECTIONAL: f32 = 1.0;
const LIGHT_KIND_POINT: f32 = 2.0;
const LIGHT_KIND_HEMISPHERE: f32 = 3.0;
const LIGHT_KIND_SPOT: f32 = 4.0;
const MAX_LIGHTS: u32 = 64u;

struct FrameUniforms {
    view_projection: mat4x4<f32>,
    inverse_view_projection: mat4x4<f32>,
    camera_position: vec3<f32>,
    exposure: f32,
    camera_forward: vec4<f32>,
    // x: how many entries of `lights` are live. y: time in seconds.
    light_count: f32,
    time: f32,
    reserved_0: f32,
    reserved_1: f32,
    // rgb: linear fog colour. w: 0 disabled, 1 linear, 2 exponential.
    fog_color_mode: vec4<f32>,
    // x: near, y: far, z: exponential density.
    fog_params: vec4<f32>,
    sky_zenith_mode: vec4<f32>,
    sky_horizon_curve: vec4<f32>,
    sky_ground_sun_size: vec4<f32>,
    lights: array<GpuLight, MAX_LIGHTS>,
    shadow_matrices: array<mat4x4<f32>, 4>,
    shadow_splits: vec4<f32>,
    // x: cascade count, y: map size, z: constant depth bias.
    shadow_params: vec4<f32>,
    // One view-projection per point/spot atlas slot; a point light claims 6
    // consecutive slots (its cube faces), a spot light claims 1. A light's
    // `cone.z` carries its base slot, or a negative value if it has none.
    point_spot_matrices: array<mat4x4<f32>, 12>,
    // x: slots in use, y: atlas face size, z: constant depth bias.
    point_spot_params: vec4<f32>,
    // x: 1 when an environment map is live, y: highest prefiltered specular
    // mip, z: intensity multiplier.
    ibl_params: vec4<f32>,
}

struct MaterialUniforms {
    base_color: vec4<f32>,
    emission: vec3<f32>,
    metallic: f32,
    uv_scale: vec2<f32>,
    uv_offset: vec2<f32>,
    roughness: f32,
    normal_scale: f32,
    occlusion_strength: f32,
    coverage_mode: f32,
    atlas_size: vec2<f32>,
    atlas_inset: f32,
    atlas_origin_top_left: f32,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var directional_shadow: texture_depth_2d_array;
@group(0) @binding(2) var shadow_sampler: sampler_comparison;
@group(0) @binding(3) var point_spot_shadow: texture_depth_2d_array;
// Every skinned instance's bone palette this frame, concatenated; an
// instance's `skin.x` names its first bone here. See `pack_bone_palette`.
@group(0) @binding(4) var<storage, read> bone_matrices: array<mat4x4<f32>>;
// Image-based lighting (see environment.rs): GGX-prefiltered specular chain,
// cosine-weighted irradiance, and the split-sum BRDF lookup.
@group(0) @binding(5) var environment_specular: texture_cube<f32>;
@group(0) @binding(6) var environment_irradiance: texture_cube<f32>;
@group(0) @binding(7) var environment_brdf: texture_2d<f32>;
@group(0) @binding(8) var environment_sampler: sampler;
@group(1) @binding(0) var<uniform> material: MaterialUniforms;
@group(1) @binding(1) var base_color_texture: texture_2d<f32>;
@group(1) @binding(2) var normal_texture: texture_2d<f32>;
@group(1) @binding(3) var metallic_roughness_texture: texture_2d<f32>;
@group(1) @binding(4) var occlusion_texture: texture_2d<f32>;
@group(1) @binding(5) var emission_texture: texture_2d<f32>;
@group(1) @binding(6) var material_sampler: sampler;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) tangent: vec4<f32>,
    // Per-vertex tint, multiplied into the surface colour. Generated geometry
    // uses it for baked ambient occlusion and per-face tint.
    @location(4) color: vec4<f32>,
    @location(5) texture_layer: f32,
    @location(6) model_0: vec4<f32>,
    @location(7) model_1: vec4<f32>,
    @location(8) model_2: vec4<f32>,
    @location(9) model_3: vec4<f32>,
    @location(10) instance_base_color: vec4<f32>,
    // [metallic, roughness, emissive strength, alpha cutoff]
    @location(11) instance_material: vec4<f32>,
    // x: this instance's bone-palette offset, or negative if unskinned.
    @location(12) skin: vec4<f32>,
    @location(13) bone_indices: vec4<u32>,
    @location(14) bone_weights: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) world_position: vec3<f32>,
    @location(1) world_normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) world_tangent: vec4<f32>,
    @location(4) instance_base_color: vec4<f32>,
    @location(5) instance_material: vec4<f32>,
    @location(6) vertex_color: vec4<f32>,
    @location(7) @interpolate(flat) texture_layer: f32,
}

const PI: f32 = 3.141592653589793;

// Inverse-transpose of the model's upper 3x3, which carries normals through
// non-uniform scale correctly. The cofactor matrix over the determinant is
// exactly that; a degenerate (flattened) model falls back to the identity,
// matching the CPU extraction this replaced.
fn normal_matrix_of(model: mat4x4<f32>) -> mat3x3<f32> {
    let c0 = model[0].xyz;
    let c1 = model[1].xyz;
    let c2 = model[2].xyz;
    let cofactor = mat3x3<f32>(cross(c1, c2), cross(c2, c0), cross(c0, c1));
    let determinant = dot(c0, cross(c1, c2));
    if abs(determinant) <= 1.1920929e-7 {
        return mat3x3<f32>(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0, 0.0, 1.0));
    }
    return cofactor * (1.0 / determinant);
}

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
    let model = mat4x4<f32>(input.model_0, input.model_1, input.model_2, input.model_3);
    let normal_matrix = normal_matrix_of(model);

    // Skinning happens in local space, before the instance's model matrix:
    // blend up to 4 bone matrices by (normalised) weight, matching
    // `skin_vertex_position` in `crates/vapour-render/src/mesh.rs` exactly, so
    // that CPU-side test is a faithful reference for what this shader does.
    // `skin.x < 0` (unskinned) and a zero total weight both leave the vertex
    // in its authored local pose.
    var local_position = vec4<f32>(input.position, 1.0);
    var local_normal = input.normal;
    var local_tangent = input.tangent.xyz;
    let total_weight = input.bone_weights.x + input.bone_weights.y + input.bone_weights.z + input.bone_weights.w;
    if input.skin.x >= 0.0 && total_weight > 0.0001 {
        let base = u32(input.skin.x);
        var skin_matrix = mat4x4<f32>(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
        skin_matrix = skin_matrix + bone_matrices[base + input.bone_indices.x] * (input.bone_weights.x / total_weight);
        skin_matrix = skin_matrix + bone_matrices[base + input.bone_indices.y] * (input.bone_weights.y / total_weight);
        skin_matrix = skin_matrix + bone_matrices[base + input.bone_indices.z] * (input.bone_weights.z / total_weight);
        skin_matrix = skin_matrix + bone_matrices[base + input.bone_indices.w] * (input.bone_weights.w / total_weight);
        local_position = skin_matrix * local_position;
        local_normal = normalize((skin_matrix * vec4<f32>(input.normal, 0.0)).xyz);
        local_tangent = normalize((skin_matrix * vec4<f32>(input.tangent.xyz, 0.0)).xyz);
    }

    let world = model * local_position;
    var output: VertexOutput;
    output.clip_position = frame.view_projection * world;
    output.world_position = world.xyz;
    output.world_normal = normalize(normal_matrix * local_normal);
    output.world_tangent = vec4<f32>(normalize((model * vec4<f32>(local_tangent, 0.0)).xyz), input.tangent.w);
    output.uv = input.uv * material.uv_scale + material.uv_offset;
    output.instance_base_color = input.instance_base_color;
    output.instance_material = input.instance_material;
    output.vertex_color = input.color;
    output.texture_layer = input.texture_layer;
    return output;
}

fn surface_uv(local_uv: vec2<f32>, texture_layer: f32) -> vec2<f32> {
    if material.atlas_size.x < 1.0 || material.atlas_size.y < 1.0 {
        return local_uv;
    }
    let columns = material.atlas_size.x;
    let rows = material.atlas_size.y;
    let safe_layer = max(0.0, floor(texture_layer + 0.5));
    let cell = vec2<f32>(safe_layer % columns, floor(safe_layer / columns));
    let inset = clamp(material.atlas_inset, 0.0, 0.4999);
    let repeated_uv = clamp(fract(local_uv), vec2<f32>(inset), vec2<f32>(1.0 - inset));
    if material.atlas_origin_top_left > 0.5 {
        // WebGPU uploads row zero at the top of the image. Atlas row zero is
        // therefore already at v=0; only flip the local, bottom-origin mesh UV
        // within that cell. Applying a whole-texture OpenGL flip here samples
        // the opposite end of tall atlases (usually transparent padding).
        return vec2<f32>(
            (cell.x + repeated_uv.x) / columns,
            (cell.y + (1.0 - repeated_uv.y)) / rows,
        );
    }
    // A bottom-left atlas numbers row zero from the bottom of the source.
    return vec2<f32>(
        (cell.x + repeated_uv.x) / columns,
        1.0 - ((cell.y + repeated_uv.y) / rows),
    );
}

fn distribution_ggx(normal: vec3<f32>, halfway: vec3<f32>, roughness: f32) -> f32 {
    let alpha = roughness * roughness;
    let alpha2 = alpha * alpha;
    let n_dot_h = max(dot(normal, halfway), 0.0);
    let denominator = n_dot_h * n_dot_h * (alpha2 - 1.0) + 1.0;
    return alpha2 / max(PI * denominator * denominator, 0.0001);
}

fn geometry_schlick_ggx(n_dot_v: f32, roughness: f32) -> f32 {
    let radius = roughness + 1.0;
    let k = radius * radius / 8.0;
    return n_dot_v / max(n_dot_v * (1.0 - k) + k, 0.0001);
}

fn geometry_smith(normal: vec3<f32>, view: vec3<f32>, light: vec3<f32>, roughness: f32) -> f32 {
    return geometry_schlick_ggx(max(dot(normal, view), 0.0), roughness)
        * geometry_schlick_ggx(max(dot(normal, light), 0.0), roughness);
}

fn fresnel_schlick(cosine: f32, reflectance: vec3<f32>) -> vec3<f32> {
    return reflectance + (vec3<f32>(1.0) - reflectance) * pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
}

fn fresnel_schlick_roughness(cosine: f32, reflectance: vec3<f32>, roughness: f32) -> vec3<f32> {
    return reflectance + (max(vec3<f32>(1.0 - roughness), reflectance) - reflectance)
        * pow(clamp(1.0 - cosine, 0.0, 1.0), 5.0);
}

// Low-frequency environment lighting from the authored procedural sky. This
// is deliberately probe-like rather than screen-space: it remains stable off
// screen, costs no extra texture memory, and gives metals/rough surfaces a
// believable response until per-district reflection probes are introduced.
fn environment_radiance(direction: vec3<f32>, roughness: f32) -> vec3<f32> {
    let up = clamp(direction.y, -1.0, 1.0);
    var color = mix(frame.sky_horizon_curve.rgb, frame.sky_zenith_mode.rgb,
        pow(max(up, 0.0), mix(0.35, 1.5, roughness)));
    if up < 0.0 {
        color = mix(frame.sky_horizon_curve.rgb, frame.sky_ground_sun_size.rgb,
            pow(-up, mix(0.5, 1.75, roughness)));
    }
    return color;
}

fn directional_shadow_visibility(world_position: vec3<f32>, normal: vec3<f32>, to_light: vec3<f32>) -> f32 {
    if frame.shadow_params.x < 0.5 { return 1.0; }
    let view_depth = dot(world_position - frame.camera_position, frame.camera_forward.xyz);
    var cascade = 0u;
    if view_depth > frame.shadow_splits.x { cascade = 1u; }
    if view_depth > frame.shadow_splits.y { cascade = 2u; }
    if view_depth > frame.shadow_splits.z { cascade = 3u; }
    if view_depth > frame.shadow_splits.w { return 1.0; }
    let clip = frame.shadow_matrices[cascade] * vec4<f32>(world_position, 1.0);
    let projected = clip.xyz / clip.w;
    let uv = projected.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
    if any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || projected.z < 0.0 || projected.z > 1.0 { return 1.0; }
    let slope_bias = max(frame.shadow_params.z * (1.0 - max(dot(normal, to_light), 0.0)), frame.shadow_params.z * 0.2);
    let texel = 1.0 / frame.shadow_params.y;
    var visibility = 0.0;
    for (var y = -1; y <= 1; y = y + 1) {
        for (var x = -1; x <= 1; x = x + 1) {
            visibility += textureSampleCompareLevel(directional_shadow, shadow_sampler, uv + vec2<f32>(f32(x), f32(y)) * texel, i32(cascade), projected.z - slope_bias);
        }
    }
    return visibility / 9.0;
}

// Point lights sample the atlas slot that matches the fragment's direction
// from the light (dominant axis picks one of the 6 cube faces, in the same
// +X,-X,+Y,-Y,+Z,-Z order the cube-face view matrices were built in); spot
// lights sample their single slot directly. `base_slot` negative means the
// light was not granted a slot this frame (see `assign_shadow_slots`), and
// every fragment it lights is treated as unshadowed.
fn point_spot_shadow_visibility(world_position: vec3<f32>, normal: vec3<f32>, to_light: vec3<f32>, base_slot: i32, is_point: bool) -> f32 {
    if base_slot < 0 { return 1.0; }
    var slot = base_slot;
    if is_point {
        let direction = -to_light;
        let ax = abs(direction.x);
        let ay = abs(direction.y);
        let az = abs(direction.z);
        var face = 0u;
        if ax >= ay && ax >= az {
            face = select(1u, 0u, direction.x > 0.0);
        } else if ay >= ax && ay >= az {
            face = select(3u, 2u, direction.y > 0.0);
        } else {
            face = select(5u, 4u, direction.z > 0.0);
        }
        slot = base_slot + i32(face);
    }
    let clip = frame.point_spot_matrices[slot] * vec4<f32>(world_position, 1.0);
    let projected = clip.xyz / clip.w;
    let uv = projected.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
    if any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || projected.z < 0.0 || projected.z > 1.0 { return 1.0; }
    let slope_bias = max(frame.point_spot_params.z * (1.0 - max(dot(normal, to_light), 0.0)), frame.point_spot_params.z * 0.2);
    return textureSampleCompareLevel(point_spot_shadow, shadow_sampler, uv, slot, projected.z - slope_bias);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // Surface response is per instance: the shared material uniform supplies
    // the texture-driven terms, while metallic, roughness, emission, and the
    // alpha cutoff come from the entity being drawn.
    let instance_metallic = clamp(input.instance_material.x, 0.0, 1.0);
    let instance_roughness = clamp(input.instance_material.y, 0.045, 1.0);
    let instance_emissive = max(input.instance_material.z, 0.0);
    let alpha_cutoff = clamp(input.instance_material.w, 0.0, 1.0);

    let sampled_uv = surface_uv(input.uv, input.texture_layer);
    let sampled_texture = textureSample(base_color_texture, material_sampler, sampled_uv);
    let tint = material.base_color * input.instance_base_color * input.vertex_color;
    let sdf_width = max(fwidth(sampled_texture.a), 0.0001);
    let sdf_coverage = smoothstep(0.5 - sdf_width, 0.5 + sdf_width, sampled_texture.a);
    let coverage = select(sampled_texture.a, sdf_coverage, material.coverage_mode > 0.5);
    let sampled_base = vec4<f32>(sampled_texture.rgb * tint.rgb, coverage * tint.a);
    if sampled_base.a < alpha_cutoff {
        discard;
    }

    let tangent = normalize(input.world_tangent.xyz);
    let bitangent = normalize(cross(input.world_normal, tangent)) * input.world_tangent.w;
    let tangent_normal = textureSample(normal_texture, material_sampler, sampled_uv).xyz * 2.0 - vec3<f32>(1.0);
    let scaled_normal = normalize(vec3<f32>(tangent_normal.xy * material.normal_scale, tangent_normal.z));
    let normal = normalize(mat3x3<f32>(tangent, bitangent, input.world_normal) * scaled_normal);

    let metallic_roughness = textureSample(metallic_roughness_texture, material_sampler, sampled_uv);
    let metallic = clamp(instance_metallic * metallic_roughness.b, 0.0, 1.0);
    let roughness = clamp(instance_roughness * metallic_roughness.g, 0.045, 1.0);
    let occlusion_sample = textureSample(occlusion_texture, material_sampler, sampled_uv).r;
    let occlusion = mix(1.0, occlusion_sample, material.occlusion_strength);
    // Emission tints by the instance's own base colour, so a glowing object
    // needs one number rather than a second colour to keep in sync.
    let emission = textureSample(emission_texture, material_sampler, sampled_uv).rgb
        * material.emission
        * input.instance_base_color.rgb
        * instance_emissive;

    let view = normalize(frame.camera_position - input.world_position);
    let reflectance = mix(vec3<f32>(0.04), sampled_base.rgb, metallic);

    // Ambient and hemisphere terms light a surface without a direction to
    // shade from, so they accumulate separately from the punctual lights and
    // are the only terms baked occlusion applies to.
    var indirect = vec3<f32>(0.0);
    var direct = vec3<f32>(0.0);

    let count = min(u32(max(frame.light_count, 0.0)), MAX_LIGHTS);
    for (var index: u32 = 0u; index < count; index = index + 1u) {
        let entry = frame.lights[index];
        let kind = entry.vector_kind.w;
        let radiance = entry.color_intensity.rgb * entry.color_intensity.w;

        if kind < 0.5 {
            // Ambient: uniform from every direction.
            indirect = indirect + radiance;
            continue;
        }
        if kind > 2.5 && kind < 3.5 {
            // Hemisphere: sky above, ground below, blended by the normal.
            let blend = normal.y * 0.5 + 0.5;
            indirect = indirect + mix(entry.secondary_range.rgb, entry.color_intensity.rgb, blend) * entry.color_intensity.w;
            continue;
        }

        // Punctual lights: resolve an incident direction and an attenuation,
        // then run the same microfacet response for all of them.
        var to_light = vec3<f32>(0.0);
        var attenuation = 1.0;
        if kind < 1.5 {
            to_light = normalize(-entry.vector_kind.xyz);
            attenuation = directional_shadow_visibility(input.world_position, normal, to_light);
        } else {
            let offset = entry.vector_kind.xyz - input.world_position;
            let distance = length(offset);
            if distance < 0.0001 {
                continue;
            }
            to_light = offset / distance;
            // Inverse-square falloff, windowed so a light cannot influence
            // geometry past its authored range.
            attenuation = 1.0 / max(distance * distance, 0.0001);
            let range = entry.secondary_range.w;
            if range > 0.0 {
                let ratio = clamp(distance / range, 0.0, 1.0);
                let window = clamp(1.0 - ratio * ratio * ratio * ratio, 0.0, 1.0);
                attenuation = attenuation * window * window;
            }
            if kind > 3.5 {
                // Spot: fade between the inner and outer cone.
                let spot_direction = normalize(entry.secondary_range.xyz);
                let alignment = dot(-to_light, spot_direction);
                let cos_inner = entry.cone.x;
                let cos_outer = entry.cone.y;
                attenuation = attenuation
                    * clamp((alignment - cos_outer) / max(cos_inner - cos_outer, 0.0001), 0.0, 1.0);
                attenuation = attenuation * point_spot_shadow_visibility(input.world_position, normal, to_light, i32(entry.cone.z), false);
            } else {
                attenuation = attenuation * point_spot_shadow_visibility(input.world_position, normal, to_light, i32(entry.cone.z), true);
            }
        }

        let n_dot_l = max(dot(normal, to_light), 0.0);
        if n_dot_l <= 0.0 || attenuation <= 0.0 {
            continue;
        }
        let halfway = normalize(view + to_light);
        let fresnel = fresnel_schlick(max(dot(halfway, view), 0.0), reflectance);
        let distribution = distribution_ggx(normal, halfway, roughness);
        let geometry = geometry_smith(normal, view, to_light, roughness);
        let specular = distribution * geometry * fresnel
            / max(4.0 * max(dot(normal, view), 0.0) * n_dot_l, 0.0001);
        let diffuse = (vec3<f32>(1.0) - fresnel) * (1.0 - metallic) * sampled_base.rgb / PI;
        direct = direct + (diffuse + specular) * radiance * attenuation * n_dot_l;
    }

    let n_dot_v = max(dot(normal, view), 0.0);
    let environment_fresnel = fresnel_schlick_roughness(n_dot_v, reflectance, roughness);
    var ambient = vec3<f32>(0.0);
    if frame.ibl_params.x > 0.5 {
        // Split-sum image-based lighting. Ambient and hemisphere lights in
        // the rig still add on top, so a scene can tint its environment map.
        let reflection = reflect(-view, normal);
        let prefiltered = textureSampleLevel(environment_specular, environment_sampler,
            reflection, roughness * frame.ibl_params.y).rgb * frame.ibl_params.z;
        let brdf = textureSampleLevel(environment_brdf, environment_sampler,
            vec2<f32>(n_dot_v, roughness), 0.0).rg;
        let specular_ibl = prefiltered * (environment_fresnel * brdf.x + brdf.y);
        let irradiance = textureSampleLevel(environment_irradiance, environment_sampler,
            normal, 0.0).rgb * frame.ibl_params.z;
        let diffuse_ibl = (vec3<f32>(1.0) - environment_fresnel) * (1.0 - metallic)
            * sampled_base.rgb * irradiance;
        ambient = (sampled_base.rgb * indirect + diffuse_ibl + specular_ibl) * occlusion;
    } else {
        let environment_specular = environment_radiance(reflect(-view, normal), roughness)
            * environment_fresnel * mix(0.35, 1.0, 1.0 - roughness) * occlusion;
        ambient = sampled_base.rgb * indirect * occlusion + environment_specular;
    }
    // Preserve scene-referred linear light in the RGBA16F target. Exposure and
    // tone mapping happen once in the presentation pass after all scene layers.
    var output_color = ambient + direct + emission;
    let fog_mode = frame.fog_color_mode.w;
    if fog_mode > 0.5 {
        let distance_to_camera = distance(frame.camera_position, input.world_position);
        var fog_amount = 0.0;
        if fog_mode < 1.5 {
            fog_amount = smoothstep(frame.fog_params.x, frame.fog_params.y, distance_to_camera);
        } else {
            let falloff = frame.fog_params.z * distance_to_camera;
            fog_amount = clamp(1.0 - exp(-(falloff * falloff)), 0.0, 1.0);
        }
        output_color = mix(output_color, frame.fog_color_mode.rgb, fog_amount);
    }
    return vec4<f32>(output_color, sampled_base.a);
}
