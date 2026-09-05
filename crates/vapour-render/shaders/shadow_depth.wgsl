struct ShadowPass { view_projection: mat4x4<f32>, far: f32, padding: vec3<f32> }
@group(0) @binding(0) var<uniform> shadow: ShadowPass;
struct Input {
  @location(0) position: vec3<f32>,
  @location(6) model_0: vec4<f32>, @location(7) model_1: vec4<f32>,
  @location(8) model_2: vec4<f32>, @location(9) model_3: vec4<f32>,
}
@vertex fn vertex_main(input: Input) -> @builtin(position) vec4<f32> {
  let model = mat4x4<f32>(input.model_0, input.model_1, input.model_2, input.model_3);
  return shadow.view_projection * model * vec4<f32>(input.position, 1.0);
}
