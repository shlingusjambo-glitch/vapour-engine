# Physics sandbox

A Mirage showcase. Its job is to prove the systems **compose**, not to be a game
— so every part of it is real engine API, with no private hooks and no
sample-only shortcuts. A demo that needs either is not evidence the engine
works.

```sh
pnpm --filter @vapour/example-physics-sandbox run
```

```
Physics sandbox — composed from Mirage systems

  bodies         18
  props          13 (13 spawned)
  joints         2 (hinged door, ball pendulum)
  door           open
  carried        body 9
  thrown         1
  grabs broken   0
  step time      0.016 ms mean, 0.020 ms p95
  wall clock     13 ms for ~5.5 s simulated
```

## What it exercises together

| System | Used for |
| ------ | -------- |
| [Physics joints](../../docs/physics.md) | A hinged door with limits and a motor; a ball-jointed pendulum |
| [Grab, carry, throw](../../docs/physics.md) | The velocity-spring hold controller |
| [Input actions](../../docs/input.md) | Controls are `Grab`, `Throw`, `Spawn`, `ToggleDoor` — never key codes |
| [Asset generation](../../docs/asset-generation.md) | Prop collision geometry |
| [Diagnostics](../../docs/diagnostics.md) | The sandbox reports its own step cost |

## Why the simulation is injected

The sandbox drives a small `SimpleWorld` — gravity, integration, a ground plane,
and nothing else — rather than the WASM physics world. That is deliberate: it
lets the *composition* be tested without a browser, and it means the commands
the sandbox emits are exercised end to end rather than merely constructed.
`SimpleWorld` accepts the same `PhysicsCommand3d` shapes the real bridge does,
so swapping it changes one function.

## What building it found

**The default grab break distance was wrong for a first-person reach.** A
90-degree turn moves the hold point by `reach × √2`; with the default 3 m break
distance and a 2.2 m reach that is 3.1 m, so simply looking around dropped
whatever you were carrying. The sandbox now scales break distance to reach, and
the reasoning is in the code where the next person will find it.

That is the kind of thing only a showcase surfaces. Both halves — the grab
controller and its defaults — were individually correct and tested; the mismatch
lived between them.

## Tests

`sandbox.test.ts` covers the composition rather than the parts: that a grab
follows a turning viewer, that throwing imparts momentum proportional to mass,
that the door holds its position with the motor rather than releasing it, and
that removing a jointed body drops its joint.
