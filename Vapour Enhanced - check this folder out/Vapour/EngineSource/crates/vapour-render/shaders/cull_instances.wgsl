// GPU-driven frustum culling and compaction.
//
// One thread per submitted instance: test its world bounding sphere against
// the layer's six frustum planes and, if it survives, claim a slot in its
// batch's run of the compacted instance buffer and bump that batch's indirect
// instance count. `cull_cpu` in culling.rs performs the identical test and
// produces the identical survivor set; a real-device test asserts that.
//
// Blended batches are drawn back-to-front, so their instances are copied
// through in their original slots untouched (their indirect count is preset
// to the full run) rather than compacted into a nondeterministic order.
struct CullInput {
    // xyz: world-space bounding sphere centre, w: radius.
    center_radius: vec4<f32>,
    // x: batch index, y: flags (bit 0 = pass through uncompacted).
    batch_flags: vec4<u32>,
}

// Mirrors `InstanceData` (7 × vec4).
struct Instance {
    rows: array<vec4<f32>, 7>,
}

// Mirrors `wgpu::util::DrawIndexedIndirectArgs`.
struct DrawArgs {
    index_count: u32,
    instance_count: atomic<u32>,
    first_index: u32,
    base_vertex: i32,
    first_instance: u32,
}

struct Params {
    planes: array<vec4<f32>, 6>,
    // x: first instance of this layer, y: instance count.
    range: vec4<u32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> inputs: array<CullInput>;
@group(0) @binding(2) var<storage, read> source: array<Instance>;
@group(0) @binding(3) var<storage, read_write> compacted: array<Instance>;
@group(0) @binding(4) var<storage, read_write> args: array<DrawArgs>;

const PASS_THROUGH: u32 = 1u;

fn sphere_inside(center: vec3<f32>, radius: f32) -> bool {
    for (var plane = 0u; plane < 6u; plane = plane + 1u) {
        let p = params.planes[plane];
        if dot(p.xyz, center) + p.w < -radius {
            return false;
        }
    }
    return true;
}

@compute @workgroup_size(64)
fn cull(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= params.range.y {
        return;
    }
    let index = params.range.x + id.x;
    let input = inputs[index];
    let batch = input.batch_flags.x;
    if (input.batch_flags.y & PASS_THROUGH) != 0u {
        compacted[index] = source[index];
        return;
    }
    if !sphere_inside(input.center_radius.xyz, input.center_radius.w) {
        return;
    }
    let slot = args[batch].first_instance + atomicAdd(&args[batch].instance_count, 1u);
    compacted[slot] = source[index];
}
