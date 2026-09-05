struct Settings {
    // exposure, tone mapper id, bloom intensity, bloom threshold
    exposure_tone_bloom: vec4<f32>,
    // bloom scatter, saturation, contrast, vignette
    bloom_color: vec4<f32>,
    // chromatic aberration, reserved...
    lens: vec4<f32>,
}
@group(0) @binding(0) var hdr_scene: texture_2d<f32>;
@group(0) @binding(1) var hdr_sampler: sampler;
@group(0) @binding(2) var<uniform> settings: Settings;
struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vertex_main(@builtin(vertex_index) index: u32) -> VertexOutput {
    let position = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    var output: VertexOutput;
    output.position = vec4(position[index], 0.0, 1.0);
    output.uv = position[index] * vec2(0.5, -0.5) + vec2(0.5);
    return output;
}
fn aces(color: vec3<f32>) -> vec3<f32> {
    let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3(0.0), vec3(1.0));
}
@fragment fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let dimensions = vec2<f32>(textureDimensions(hdr_scene));
    let texel = 1.0 / dimensions;
    let aberration = settings.lens.x * 3.0 * texel;
    var hdr = vec3<f32>(textureSample(hdr_scene, hdr_sampler, input.uv + vec2(aberration.x, 0.0)).r, textureSample(hdr_scene, hdr_sampler, input.uv).g, textureSample(hdr_scene, hdr_sampler, input.uv - vec2(aberration.x, 0.0)).b);
    if settings.exposure_tone_bloom.z > 0.0 {
        let radius = mix(1.0, 8.0, settings.bloom_color.x) * texel;
        let offsets = array<vec2<f32>, 12>(vec2(1.,0.),vec2(-1.,0.),vec2(0.,1.),vec2(0.,-1.), vec2(.707,.707),vec2(-.707,.707),vec2(.707,-.707),vec2(-.707,-.707), vec2(2.,0.),vec2(-2.,0.),vec2(0.,2.),vec2(0.,-2.));
        var bloom = vec3(0.0);
        for (var i = 0u; i < 12u; i += 1u) {
            let sample_color = textureSample(hdr_scene, hdr_sampler, input.uv + offsets[i] * radius).rgb;
            let brightness = max(max(sample_color.r, sample_color.g), sample_color.b);
            bloom += sample_color * max(brightness - settings.exposure_tone_bloom.w, 0.0) / max(brightness, 0.0001);
        }
        hdr += bloom / 12.0 * settings.exposure_tone_bloom.z;
    }
    hdr = max(hdr * settings.exposure_tone_bloom.x, vec3(0.0));
    var mapped = hdr;
    let tone_mapping = u32(settings.exposure_tone_bloom.y);
    if tone_mapping == 1u { mapped = hdr / (vec3(1.0) + hdr); }
    if tone_mapping == 2u { mapped = aces(hdr); }
    let luminance = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
    mapped = mix(vec3(luminance), mapped, settings.bloom_color.y);
    mapped = (mapped - vec3(0.5)) * settings.bloom_color.z + vec3(0.5);
    let centered = input.uv * 2.0 - vec2(1.0);
    let vignette = smoothstep(1.35, 0.35, length(centered));
    mapped *= mix(1.0, vignette, settings.bloom_color.w);
    return vec4(mapped, 1.0);
}
