// Split-sum environment BRDF lookup: for (n_dot_v, roughness) the integral of
// the GGX specular BRDF over the hemisphere factors into a scale and a bias
// on F0. Rendered once at startup into a small 2D texture; the material pass
// samples it as `F0 * scale + bias`.
const PI: f32 = 3.141592653589793;
const SAMPLES: u32 = 256u;

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
    output.uv = vec2<f32>(xy.x, -xy.y) * 0.5 + vec2<f32>(0.5);
    return output;
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

// Smith-Schlick geometry with the IBL remapping k = a^2 / 2.
fn geometry_smith_ibl(n_dot_v: f32, n_dot_l: f32, roughness: f32) -> f32 {
    let alpha = roughness * roughness;
    let k = alpha / 2.0;
    let g_v = n_dot_v / (n_dot_v * (1.0 - k) + k);
    let g_l = n_dot_l / (n_dot_l * (1.0 - k) + k);
    return g_v * g_l;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    // u runs along n_dot_v, v (texel row 0 at the top) along roughness, with
    // row 0 being roughness 0. Clamp n_dot_v away from zero: the grazing
    // column would otherwise divide by zero.
    let n_dot_v = max(input.uv.x, 0.001);
    let roughness = input.uv.y;
    let view = vec3<f32>(sqrt(1.0 - n_dot_v * n_dot_v), 0.0, n_dot_v);
    let alpha = roughness * roughness;
    var scale = 0.0;
    var bias = 0.0;
    for (var index = 0u; index < SAMPLES; index = index + 1u) {
        let xi = hammersley(index, SAMPLES);
        let phi = 2.0 * PI * xi.x;
        let cos_theta = sqrt((1.0 - xi.y) / (1.0 + (alpha * alpha - 1.0) * xi.y));
        let sin_theta = sqrt(max(1.0 - cos_theta * cos_theta, 0.0));
        let halfway = vec3<f32>(sin_theta * cos(phi), sin_theta * sin(phi), cos_theta);
        let light = 2.0 * dot(view, halfway) * halfway - view;
        let n_dot_l = max(light.z, 0.0);
        let n_dot_h = max(halfway.z, 0.0);
        let v_dot_h = max(dot(view, halfway), 0.0);
        if n_dot_l <= 0.0 { continue; }
        let geometry = geometry_smith_ibl(n_dot_v, n_dot_l, roughness);
        let visibility = geometry * v_dot_h / max(n_dot_h * n_dot_v, 0.0001);
        let fresnel = pow(1.0 - v_dot_h, 5.0);
        scale = scale + (1.0 - fresnel) * visibility;
        bias = bias + fresnel * visibility;
    }
    return vec4<f32>(scale / f32(SAMPLES), bias / f32(SAMPLES), 0.0, 1.0);
}
