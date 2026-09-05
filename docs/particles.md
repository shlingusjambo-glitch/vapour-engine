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
| Types | `ParticleEmitterOptions`, `ParticleBuffers`, `EmitterShape`, `ParticleStats`, `ParticleCollisionOptions`, `ParticleCollisionHit` |

## Performance considerations

- Capacity is a **hard budget**: pick it from what the effect needs at its peak,
  not from what it usually needs, because the overflow is silently dropped.
- `buffers()` evaluates the size curve and colour gradient per particle per
  call. Call it once per frame, after `update`.
- Ten thousand particles in one emitter is tested and fine on the CPU. Far
  beyond that belongs on the GPU, which is what `render.instances` and a compute
  path are for.
- CPU collision invokes one query per moving particle per update. Use collision
  layers and simple broad-phase queries, reduce collision-enabled capacity, or
  move very large effects to the GPU path.

## Multiplayer considerations

Do not replicate particles. Replicate the **event** — "explosion at this point
with this seed" — and let each client run the same deterministic simulation.
That is a few dozen bytes instead of thousands of positions per frame.
