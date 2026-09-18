# Runtime lifecycle

`RuntimeLoop` is Vapour's renderer-independent browser lifecycle. It owns
`requestAnimationFrame`, elapsed time, delta clamping, fixed-step accumulation,
catch-up limits, start/stop hooks, and frame error handling.

```ts
const loop = new RuntimeLoop({
  start: () => loadGame(),
  update: (time) => {
    for (let step = 0; step < time.fixedSteps; step++) {
      physics.update(time.fixedDeltaSeconds);
    }
    presentation.update(time.deltaSeconds);
  },
  stop: () => saveAndRelease(),
  error: (error) => showCrashReport(error),
});
await loop.start();
```

The loop is deliberately separate from the renderer. Direct Vapour games can
use `GameRuntime`, which couples this lifecycle concept to binary frame
submission. Editor play mode, migration bridges, dedicated simulation hosts,
and games with an existing presentation adapter use `RuntimeLoop` directly.

`GameContext.frame` records the world layer. `GameContext.overlay` records a
second camera layer for HUDs, menus, subtitles, and debug panels. When overlay
draws exist, `GameRuntime` submits both layers atomically: the world clears
colour and depth, while the overlay preserves both and renders afterward.

```ts
game.frame.setCamera(worldCamera, 70, 0.1, 500);
game.frame.draw("terrain", terrainMatrix);
game.overlay.setOrthographicCamera(uiCamera, game.height / 100, 0.1, 100);
game.overlay.draw("hud:batch", identity, { material: "hud" });
```

`step(timestamp)` supports deterministic tests, editor single-frame stepping,
and replay tooling. A resumed background tab cannot inject an unbounded delta,
and catch-up is capped so simulation never enters a fixed-update death spiral.

CubeGame now uses this lifecycle and has removed its own `Time` singleton and
manual animation-frame scheduling.
