struct Settings {
    // exposure, tone mapper id, bloom intensity, bloom threshold
    exposure_tone_bloom: vec4<f32>,
    // bloom scatter, saturation, contrast, vignette
    bloom_color: vec4<f32>,
    // chromatic aberration, FXAA enabled, debug view id, reserved
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
fn luma(color: vec3<f32>) -> f32 { return dot(color, vec3(0.2126, 0.7152, 0.0722)); }
fn sample_fxaa(uv: vec2<f32>, texel: vec2<f32>) -> vec3<f32> {
    let center = textureSample(hdr_scene, hdr_sampler, uv).rgb;
    let nw = textureSample(hdr_scene, hdr_sampler, uv + vec2(-texel.x, -texel.y)).rgb;
    let ne = textureSample(hdr_scene, hdr_sampler, uv + vec2(texel.x, -texel.y)).rgb;
    let sw = textureSample(hdr_scene, hdr_sampler, uv + vec2(-texel.x, texel.y)).rgb;
    let se = textureSample(hdr_scene, hdr_sampler, uv + texel).rgb;
    let range_min = min(luma(center), min(min(luma(nw), luma(ne)), min(luma(sw), luma(se))));
    let range_max = max(luma(center), max(max(luma(nw), luma(ne)), max(luma(sw), luma(se))));
    if range_max - range_min < max(0.0312, range_max * 0.125) { return center; }
    var direction = vec2(-((luma(nw) + luma(ne)) - (luma(sw) + luma(se))),
                          (luma(nw) + luma(sw)) - (luma(ne) + luma(se)));
    let reduce = max((luma(nw) + luma(ne) + luma(sw) + luma(se)) * 0.03125, 0.0078125);
    direction = clamp(direction / (min(abs(direction.x), abs(direction.y)) + reduce), vec2(-8.0), vec2(8.0)) * texel;
    let a = 0.5 * (textureSample(hdr_scene, hdr_sampler, uv + direction * (1.0 / 3.0 - 0.5)).rgb + textureSample(hdr_scene, hdr_sampler, uv + direction * (2.0 / 3.0 - 0.5)).rgb);
    let b = a * 0.5 + 0.25 * (textureSample(hdr_scene, hdr_sampler, uv + direction * -0.5).rgb + textureSample(hdr_scene, hdr_sampler, uv + direction * 0.5).rgb);
    return select(b, a, luma(b) < range_min || luma(b) > range_max);
}
@fragment fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let dimensions = vec2<f32>(textureDimensions(hdr_scene));
    let texel = 1.0 / dimensions;
    let aberration = settings.lens.x * 3.0 * texel;
    var center = textureSample(hdr_scene, hdr_sampler, input.uv).rgb;
    if settings.lens.y > 0.5 { center = sample_fxaa(input.uv, texel); }
    var hdr = vec3<f32>(textureSample(hdr_scene, hdr_sampler, input.uv + vec2(aberration.x, 0.0)).r, center.g, textureSample(hdr_scene, hdr_sampler, input.uv - vec2(aberration.x, 0.0)).b);
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
    let vignette = (1.0 - smoothstep(0.35, 1.35, length(centered)));
    mapped *= mix(1.0, vignette, settings.bloom_color.w);
    if settings.lens.z > 0.5 && settings.lens.z < 1.5 { mapped = vec3(luma(hdr)); }
    if settings.lens.z > 1.5 {
        let stops = clamp(log2(max(luma(hdr), 0.000001)) + 6.0, 0.0, 12.0) / 12.0;
        mapped = clamp(vec3(1.5 - abs(4.0 * stops - 3.0), 1.5 - abs(4.0 * stops - 2.0), 1.5 - abs(4.0 * stops - 1.0)), vec3(0.0), vec3(1.0));
    }
    return vec4(mapped, 1.0);
}
