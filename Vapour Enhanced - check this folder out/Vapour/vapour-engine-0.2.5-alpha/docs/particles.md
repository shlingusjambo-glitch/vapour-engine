# Particles

Explosions, smoke, sparks, weather, dust, fire, magic — all of them are the same
thing: many short-lived points with a position, a velocity, and properties that
change over their lifetime.

## A data layout problem first

Particles live in **flat typed arrays**, not objects. Ten thousand particle
objects allocate ten thousand times, scatter across the heap, and hand the
garbage collector a frame-time spike exactly when the explosion goes off.

Buffers are allocated once at the emitter's capacity and reused forever. A
running system allocates nothing — there is a test asserting the same array
identity across frames.

When an emitter is full it **drops** rather than growing. Growing the buffer
mid-explosion is precisely the allocation spike the flat layout exists to avoid;
`stats().dropped` reports it so a budget can be tuned.

## Basic example

```ts
import { ParticleEmitter } from "@vapour/engine";
import { curve, gradientBetween } from "@vapour/math";

const sparks = new ParticleEmitter({
  capacity: 512,
  rate: 0,
  burst: 60,
  duration: 0.2,
  loop: false,
  lifetime: [0.3, 0.8],
  speed: [3, 8],
  shape: { kind: "cone", angle: 35 },
  gravity: [0, -9.81, 0],
  drag: 0.4,
  size: curve([{ time: 0, value: 0.08 }, { time: 1, value: 0 }]),
  color: gradientBetween([1, 0.8, 0.2, 1], [1, 0.2, 0, 0]),
});

sparks.setOrigin(impactPoint);
sparks.play();

// each frame
sparks.update(deltaSeconds);
renderer.drawParticles(sparks.buffers());
```

`buffers()` returns positions, sizes, colours, rotations, and normalized ages —
the last for texture-sheet animation. Only the first `count` entries are live.

## Trails

Enable bounded trail history without per-frame allocation:

```ts
const tracer = new ParticleEmitter({
  burst: 1,
  rate: 0,
  trail: { segments: 12, minDistance: 0.04 },
});
```

`buffers().trailPositions` stores `trailSegments * 3` floats per particle with
the newest point first; `trailCounts` says how many are valid. Renderers can
turn these points into ribbons, lines, or tube geometry. History is swap-moved
with live particles and follows the emitter in local space.

## Collision

Collision is deliberately query-driven, so an emitter can use the engine's 3D
physics world, 2D world, voxel collision, or a specialized GPU/height-field
query without coupling the simulation to one backend:

```ts
const sparks = new ParticleEmitter({
  collision: {
    query: (from, to) => physics.segmentCast(from, to),
    response: "bounce", // also "stop" or "kill"
    restitution: 0.65,
  },
});
```

The callback returns a hit `point` and surface `normal`. Invalid or zero normals
produce an actionable error rather than corrupting the particle buffers.
`stats().collisions` exposes contact volume for profiling.

Nothing here draws, which is what lets the same emitter feed the WebGPU
renderer, a 2D canvas, or a test.

## Details that matter

**Fractional emission accumulates.** A rate below one particle per frame must
not round to never emitting; the debt carries between frames so the average rate
is correct.

**Expiry uses swap-removal**, keeping the live range contiguous. Order does not
matter to a renderer, and shifting the whole array on every death would be
quadratic during a burst.

**Sphere sampling is uniform.** Normalizing three uniform components clusters
particles at the cube's corners; sampling `z` uniformly and `θ` around it does
not.

**Local versus world space** is what makes a torch flame stay attached rather
than trailing behind. In local space, moving the emitter carries existing
particles with it.

## Determinism

Simulation is deterministic given a seed, so an effect looks the same on every
machine and can be **replicated by seed** rather than by particle — thousands of
positions per frame is not traffic worth spending on a visual effect.

`reseed()` restarts the sequence for a reproducible replay.

## Pooling

```ts
const pool = new ParticleSystemPool(() => new ParticleEmitter(sparkPreset), { prewarm: 8, maxActive: 32 });

pool.spawn(impactPoint);      // undefined when at the limit
pool.update(deltaSeconds);    // retires finished systems back to the pool
for (const emitter of pool.active()) renderer.drawParticles(emitter.buffers());
```

Effects spawn at exactly the moments a game is already busy — an impact, a
death, a spell — which is the worst possible time to allocate a
thousand-particle buffer.

## API reference

| Export | Purpose |
| ------ | ------- |
| `ParticleEmitter` | `play`, `stop`, `clear`, `burst`, `emit`, `update`, `buffers`, `setOrigin`, `reseed`, `stats` |
| `ParticleSystemPool` | `spawn`, `update`, `active`, `clear` |
| `GpuParticleSystem` | `ParticleEmitter`'s API on the renderer's compute path; `mode`, `emitter` (fallback), `release` |
| `gpuParticleDescriptor`, `bakeParticleLuts` | The renderer's descriptor and 32-sample tables from emitter options |
| Types | `ParticleEmitterOptions`, `ParticleBuffers`, `EmitterShape`, `ParticleStats`, `ParticleCollisionOptions`, `ParticleCollisionHit` |

## Performance considerations

- Capacity is a **hard budget**: pick it from what the effect needs at its peak,
  not from what it usually needs, because the overflow is silently dropped.
- `buffers()` evaluates the size curve and colour gradient per particle per
  call. Call it once per frame, after `update`.
- Ten thousand particles in one emitter is tested and fine on the CPU. Far
  beyond that belongs on the GPU: `GpuParticleSystem` above.
- CPU collision invokes one query per moving particle per update. Use collision
  layers and simple broad-phase queries, reduce collision-enabled capacity, or
  move very large effects to the GPU path (which has no collision).

## GPU particles

`GpuParticleSystem` has `ParticleEmitter`'s shape — `play`, `stop`, `clear`,
`burst`, `emit`, `update`, `setOrigin`, `stats`, `aliveCount` — but the
particles never exist in JavaScript. The renderer (`vapour-render`'s
`surface/particles.rs`, `shaders/particles_sim.wgsl`, `shaders/particles.wgsl`)
simulates them in a compute pass and draws them as camera-facing soft discs
with one indirect draw per system, so ten thousand particles cost this side one
call per frame: "spawn N at this origin, advance by dt".

```ts
const host = new WebGpuRenderHost(canvas);
await host.initialize();

const embers = new GpuParticleSystem(host, {
  capacity: 20_000,
  rate: 4000,
  lifetime: [0.8, 1.6],
  speed: [0.5, 2],
  shape: { kind: "cone", angle: 20 },
  gravity: [0, 1.5, 0],
  drag: 0.6,
  size: curve([{ time: 0, value: 0.06 }, { time: 1, value: 0 }]),
  color: gradientBetween([1, 0.6, 0.1, 1], [0.4, 0, 0, 0]),
  blend: "additive",
});
embers.setOrigin(firePosition);
embers.play();

// each frame, before the host renders
embers.update(deltaSeconds);
```

Emission scheduling — rate, fractional debt, bursts, `duration`/`loop` — runs
here exactly as `ParticleEmitter` does it. Spawn *sampling* runs in the shader
and mirrors `ParticleEmitter.#spawn`: the same xorshift32 generator, the same
draw order per shape, so a seed produces the same burst on both. A real-device
test (`a_gpu_burst_matches_the_typescript_emitter`) checks one GPU step
against `crates/vapour-render/src/surface/particles_golden.json`, which
`gpu-particles.test.ts` regenerates from `ParticleEmitter`; the two are pinned
to each other.

**Buffer layout** (documented strides, asserted by
`buffer_layout_matches_the_shader_structs`):

| Buffer | Stride | Contents |
| ------ | ------ | -------- |
| Particle | 48 B (3 × vec4) | `position.xyz, age` · `velocity.xyz, lifetime` · `rotation, spin, 0, 0` |
| Draw args | 16 B | `DrawIndirectArgs`; `vertex_count` 6, `instance_count` = live count |
| Counters | 16 B | emitted, expired, dropped, reserved (cumulative) |
| Params | 736 B | gravity/dt, origin/decay, lifetime/speed, shape, angle/spin, counts, 32-sample size LUT, 32-sample RGBA LUT |

Each step: `spawn` appends new particles to the input buffer (claiming slots
with an atomic on its count; over capacity it gives the slot back and counts a
drop), then `update` ages, integrates, and compacts survivors into the output
buffer. The output is drawn and becomes the next input. Size and colour over
lifetime are baked into 32-sample tables (`bakeParticleLuts`) so the vertex
shader never evaluates a curve.

**CPU fallback.** `SurfaceRenderer::set_gpu_particles(false)` (host:
`setGpuParticles(false)`) makes systems created from then on step in Rust
(`step_cpu`) with the same arithmetic and upload the result; the draw is the
same. `gpu_steps_match_the_cpu_fallback_for_every_shape` runs three GPU steps
per shape on a real device and compares them with the CPU step particle for
particle (relative tolerance 1e-4), counters included; the over-capacity step
compares counts only, since *which* spawns the GPU drops depends on atomic
order. When the host cannot create systems at all — before `initialize()`, a
headless host, a stale WASM build — `GpuParticleSystem` falls back to an
ordinary `ParticleEmitter`, exposed as `emitter`, whose `buffers()` are the
caller's to draw.

**What the GPU path does not know.** The population never leaves the device,
so on the GPU path `stats()` reports `emitted`/`expired`/`dropped` as
`undefined` and `aliveCount` is an *upper bound*: everything spawned less than
the maximum lifetime ago, capped at capacity. It reaches zero exactly when the
system is certainly empty, which is what pooling needs. The Rust CPU path
reports all four exactly. Collision and trails are CPU-emitter features and
are not accepted by `GpuParticleSystemOptions`.

## Multiplayer considerations

Do not replicate particles. Replicate the **event** — "explosion at this point
with this seed" — and let each client run the same deterministic simulation.
That is a few dozen bytes instead of thousands of positions per frame.

## Vapour Script

The same API from Vapour Script — VS compiles to ESM and receives the same
engine objects as TypeScript, so nothing below is a binding layer.

```py
from "@vapour/engine" import ParticleEmitter

export func sparks(position):
    var emitter = new ParticleEmitter({ capacity: 256, rate: 200, lifetime: [0.3, 0.6], speed: [2, 4] })
    emitter.update(1 / 60)
    return emitter.aliveCount
```
