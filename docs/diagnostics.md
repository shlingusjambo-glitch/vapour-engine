# Diagnostics

The Mirage audit's blunt finding was that nobody could tell why a Vapour game
was slow or broken. This subsystem is the shared surface that answers that:
every other subsystem reports counters into one registry, logs under one
category scheme, and visualizes its state through one debug-draw buffer.

## Concept

Two properties matter more than breadth:

**Cheap enough to leave on.** A counter is a number increment; a timer is two
clock reads; a disabled debug-draw category is one set lookup. Diagnostics that
must be switched off to get a fast build are diagnostics nobody has when they
need them. `diagnostics.enabled = false` and `debugDraw.enabled = false` make
every call a no-op without removing call sites.

**Honest about sampling.** Counters report a rolling window with mean, min, max,
and a 95th percentile. A mean frame time hides exactly the spikes that make a
game feel bad, so budgets are judged against p95, not the mean.

## Counters and timings

```ts
import { Diagnostics, COUNTERS } from "@vapour/engine";

const diagnostics = new Diagnostics();

// Gauges: one value per frame.
diagnostics.set(COUNTERS.drawCalls, renderer.drawCalls);
diagnostics.set(COUNTERS.resourceBytes, resources.stats().estimatedBytes, { unit: "bytes" });

// Accumulators: many adds, one sample per frame.
diagnostics.add(COUNTERS.triangles, batch.triangleCount);

// Timing regions.
diagnostics.measure("physics.step", () => world.step(fixedDelta));
diagnostics.begin("render.extract");
const world = extractRenderWorld(scene);
diagnostics.end("render.extract");

diagnostics.commitFrame();   // once at the end of the frame
```

Counter names are `subsystem.metric`, which is what grouping and the overlay
key off. The `COUNTERS` constant holds the engine's standard names so
subsystems and tooling agree on spelling.

`diagnostics.report()` produces a JSON dump for bug reports and automated
performance runs.

### Vapour Script

```vapour
use diagnostics

fn update(dt: f32) {
  diagnostics.set("game.enemies", self.enemies.len())
}
```

## Logging

A game engine logs from a dozen subsystems at once. Without categories the
output is either useless noise or switched off entirely, which is how real
warnings get missed.

```ts
import { Logger, MemorySink, LOG_CATEGORIES } from "@vapour/engine";

const logger = new Logger({ defaultLevel: "warn" });
logger.setLevel(LOG_CATEGORIES.navigation, "debug");   // debug one subsystem

const log = logger.category(LOG_CATEGORIES.navigation);
log.debug("path found", { corridor: 14, cost: 22.5 });
log.error("agent has no path", { agentId });
```

Prefer structured `data` over interpolating values into the message, so tooling
can filter and group on the values.

Output goes through a **sink**, not straight to `console`: the editor shows logs
in a panel, tests assert on them via `MemorySink`, and a shipped build can
forward warnings to error reporting.

## Debug drawing

Every later subsystem needs to show its own state — collider shapes, navmesh
polygons, path corridors, contacts, perception cones, culling bounds. They all
queue into one buffer, so there is one switch to turn them off, one set of
colour conventions, and one batch to render.

```ts
import { DebugDraw, DEBUG_CATEGORIES, DEBUG_COLORS } from "@vapour/engine";

const draw = new DebugDraw();

draw.box(bounds.min, bounds.max, { category: DEBUG_CATEGORIES.culling, color: DEBUG_COLORS.cyan });
draw.sphere(agent.position, agent.radius, { category: DEBUG_CATEGORIES.navigation });
draw.arrow(hit.point, hit.normal, { color: DEBUG_COLORS.green, duration: 2 });
draw.axes(transform.position, 0.5);
draw.text(spawn.position, "spawn", { category: DEBUG_CATEGORIES.ai });

draw.setCategoryEnabled(DEBUG_CATEGORIES.physics, false);

// each frame, after the renderer has consumed draw.primitives()
draw.clear(deltaSeconds);
```

The API is immediate mode — a call per frame, no handles to retain — because
that is what debugging code wants. `duration` keeps a primitive alive past the
frame, which is what makes a single-frame event like a raycast hit visible at
all.

Nothing here touches the GPU, so it works headless, in a worker, and in tests.

## The overlay

```ts
import { DiagnosticsOverlay, COUNTERS } from "@vapour/engine";

const overlay = new DiagnosticsOverlay(diagnostics, {
  budgets: {
    [COUNTERS.frameTime]: 16.6,
    [COUNTERS.drawCalls]: 2000,
  },
  sections: ["frame", "render", "physics"],
});
overlay.attach(document.getElementById("stats")!);

// in the frame loop
overlay.advance(deltaSeconds);
```

The overlay is split in two on purpose: `buildOverlayModel` turns the registry
into a plain formatted data structure, and `DiagnosticsOverlay` renders it. The
same model drives a DOM panel, a world-space XR panel, a canvas overlay, or a
test assertion, and `formatOverlayText` renders it for logs and headless runs.

A counter whose **p95** exceeds its budget is flagged, which turns the overlay
from a wall of numbers into an answer.

## API reference

| Module | Exports |
| ------ | ------- |
| `counters` | `Diagnostics`, `Counter`, `COUNTERS`, `CounterSample`, `CounterUnit`, `CounterOptions` |
| `logging` | `Logger`, `CategoryLogger`, `MemorySink`, `consoleSink`, `LOG_CATEGORIES`, `LogLevel`, `LogRecord`, `LogSink` |
| `debug-draw` | `DebugDraw`, `DEBUG_CATEGORIES`, `DEBUG_COLORS`, `DebugPrimitive`, `DebugLine`, `DebugText`, `DebugDrawOptions` |
| `overlay` | `DiagnosticsOverlay`, `buildOverlayModel`, `formatOverlayText`, `formatCounterValue`, `formatBytes`, `OverlayModel`, `OverlaySection`, `OverlayRow` |

## Performance considerations

- Counters use a fixed-size ring buffer, so a session running for hours does not
  grow its history. The default window is 120 samples (~2s at 60Hz).
- `sample()` sorts the window to compute p95. Call it when rendering the overlay
  (a few times a second), not every frame for every counter.
- `DebugDraw` has a primitive budget (100,000 by default). Exceeding it
  increments `dropped` rather than freezing the tab — a runaway debug loop shows
  up as a number instead of a hang.
- `MemorySink` is bounded, so logging alone cannot exhaust memory in a long
  session.
- The overlay refreshes at ~4Hz by default: fast enough to watch, slow enough to
  read, and cheap enough to leave on.

## Multiplayer considerations

Network counters (`network.bytesIn`, `network.bytesOut`, `network.rtt`) live in
the same registry as everything else, so a bandwidth problem and a frame-time
problem are diagnosed from one overlay. On a dedicated server, use
`diagnostics.report()` on an interval instead of the DOM overlay.

## XR considerations

A DOM overlay is invisible inside an immersive session. Build the model with
`buildOverlayModel` and render it into a world-space panel instead —
`formatOverlayText` gives you the text directly, and the model gives you rows if
you want to lay them out yourself.
