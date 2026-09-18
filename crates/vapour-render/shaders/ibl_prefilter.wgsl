// Image-based-lighting convolution. One fullscreen pass writes one face of
// one mip: either a GGX-prefiltered specular level (mode 0, split-sum
// approximation with N = V = R) or the cosine-weighted diffuse irradiance
// (mode 1). Samples are importance-sampled and read from a source mip chosen
// by the sample's solid angle, which removes the fireflies a point-sampled
// convolution shows on a bright sun disc.
struct Params {
    // x: cube face (+X, -X, +Y, -Y, +Z, -Z), y: mode, z: roughness,
    // w: source face size in texels.
    face_mode_roughness_size: vec4<f32>,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var source: texture_cube<f32>;
@group(0) @binding(2) var source_sampler: sampler;

const PI: f32 = 3.141592653589793;
const SPECULAR_SAMPLES: u32 = 64u;
const IRRADIANCE_SAMPLES: u32 = 128u;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> VertexOutput {
    let xy = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0),
    )[index];
    var output: VertexOutput;
    output.position = vec4<f32>(xy, 0.0, 1.0);
    // Texel row 0 is the top of the image, where clip y is +1.
    output.uv = vec2<f32>(xy.x, -xy.y) * 0.5 + vec2<f32>(0.5);
    return output;
}

// The standard cubemap face parameterisation (mirrors `cube_face_direction`
// in environment.rs, which is tested against the sampling convention).
fn face_direction(face: u32, uv: vec2<f32>) -> vec3<f32> {
    let u = uv.x * 2.0 - 1.0;
    let v = uv.y * 2.0 - 1.0;
    switch face {
        case 0u: { return normalize(vec3<f32>(1.0, -v, -u)); }
        case 1u: { return normalize(vec3<f32>(-1.0, -v, u)); }
        case 2u: { return normalize(vec3<f32>(u, 1.0, v)); }
        case 3u: { return normalize(vec3<f32>(u, -1.0, -v)); }
        case 4u: { return normalize(vec3<f32>(u, -v, 1.0)); }
        default: { return normalize(vec3<f32>(-u, -v, -1.0)); }
    }
}

fn hammersley(index: u32, count: u32) -> vec2<f32> {
    var bits = index;
    bits = (bits << 16u) | (bits >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
    return vec2<f32>(f32(index) / f32(count), f32(bits) * 2.3283064365386963e-10);
}

fn tangent_frame(normal: vec3<f32>) -> mat3x3<f32> {
    var up = vec3<f32>(0.0, 0.0, 1.0);
    if abs(normal.z) > 0.999 { up = vec3<f32>(1.0, 0.0, 0.0); }
    let tangent = normalize(cross(up, normal));
    let bitangent = cross(normal, tangent);
    return mat3x3<f32>(tangent, bitangent, normal);
}

fn distribution_ggx(n_dot_h: f32, roughness: f32) -> f32 {
    let alpha = roughness * roughness;
    let alpha2 = alpha * alpha;
    let denominator = n_dot_h * n_dot_h * (alpha2 - 1.0) + 1.0;
    return alpha2 / max(PI * denominator * denominator, 0.0001);
}

// Mip level whose texel solid angle matches the sample's: the standard
// "filtered importance sampling" trick from GPU Gems 3.
fn sample_level(pdf: f32, sample_count: u32, source_size: f32) -> f32 {
    let texel_solid_angle = 4.0 * PI / (6.0 * source_size * source_size);
    let sample_solid_angle = 1.0 / max(f32(sample_count) * pdf, 0.0001);
    return max(0.5 * log2(sample_solid_angle / texel_solid_angle) + 1.0, 0.0);
}

fn prefilter_specular(normal: vec3<f32>, roughness: f32, source_size: f32) -> vec3<f32> {
    if roughness < 0.001 {
        return textureSampleLevel(source, source_sampler, normal, 0.0).rgb;
    }
    let frame = tangent_frame(normal);
    let alpha = roughness * roughness;
    var total = vec3<f32>(0.0);
    var weight = 0.0;
    for (var index = 0u; index < SPECULAR_SAMPLES; index = index + 1u) {
        let xi = hammersley(index, SPECULAR_SAMPLES);
        let phi = 2.0 * PI * xi.x;
        let cos_theta = sqrt((1.0 - xi.y) / (1.0 + (alpha * alpha - 1.0) * xi.y));
        let sin_theta = sqrt(max(1.0 - cos_theta * cos_theta, 0.0));
        let halfway = frame * vec3<f32>(sin_theta * cos(phi), sin_theta * sin(phi), cos_theta);
        let light = 2.0 * dot(normal, halfway) * halfway - normal;
        let n_dot_l = dot(normal, light);
        if n_dot_l <= 0.0 { continue; }
        let n_dot_h = max(dot(normal, halfway), 0.0);
        // With V = N, the PDF of the reflected direction is D * NdotH / (4 * VdotH) = D / 4.
        let pdf = distribution_ggx(n_dot_h, roughness) * 0.25;
        let level = sample_level(pdf, SPECULAR_SAMPLES, source_size);
        total = total + textureSampleLevel(source, source_sampler, light, level).rgb * n_dot_l;
        weight = weight + n_dot_l;
    }
    return total / max(weight, 0.0001);
}

fn irradiance(normal: vec3<f32>, source_size: f32) -> vec3<f32> {
    let frame = tangent_frame(normal);
    var total = vec3<f32>(0.0);
    for (var index = 0u; index < IRRADIANCE_SAMPLES; index = index + 1u) {
        let xi = hammersley(index, IRRADIANCE_SAMPLES);
        let phi = 2.0 * PI * xi.x;
        // Cosine-weighted hemisphere: the cosine term is baked into the
        // distribution, so every sample carries equal weight.
        let cos_theta = sqrt(1.0 - xi.y);
        let sin_theta = sqrt(xi.y);
        let light = frame * vec3<f32>(sin_theta * cos(phi), sin_theta * sin(phi), cos_theta);
        let pdf = cos_theta / PI;
        let level = sample_level(pdf, IRRADIANCE_SAMPLES, source_size);
        total = total + textureSampleLevel(source, source_sampler, light, level).rgb;
    }
    // The result is the cosine-weighted mean radiance: for a uniform
    // environment of radiance L it equals L, so the shader's diffuse term is
    // `albedo * irradiance` with no extra 1/pi.
    return total / f32(IRRADIANCE_SAMPLES);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let face = u32(params.face_mode_roughness_size.x + 0.5);
    let mode = params.face_mode_roughness_size.y;
    let roughness = params.face_mode_roughness_size.z;
    let source_size = params.face_mode_roughness_size.w;
    let direction = face_direction(face, input.uv);
    if mode > 0.5 {
        return vec4<f32>(irradiance(direction, source_size), 1.0);
    }
    return vec4<f32>(prefilter_specular(direction, roughness, source_size), 1.0);
}
