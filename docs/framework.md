# Game framework utilities

The systems every real game eventually writes for itself: signals, timers,
coroutines, tweens, pools, classification, settings, localization, saves,
storage, and application lifecycle.

Two conventions run through the whole subsystem.

**Time is explicit.** Nothing here uses `setTimeout` or `performance.now`.
Timers, coroutines, and tweens are advanced by the caller, so they pause when
the game pauses, follow slow motion, and reproduce exactly under a replay or a
server tick. Determinism is not a bonus feature — networked prediction and
reproducible tests both require it.

**Mistakes throw.** Releasing a pooled object twice, using an undefined layer,
or tweening mismatched value shapes reports the problem at the call site instead
of corrupting state that surfaces somewhere else entirely.

## Signals and the event bus

`EventTarget` is right at the engine's browser boundary and wrong for gameplay:
payloads are untyped, listener order is unspecified in practice, and every
dispatch allocates. Signals are typed, ordered, and safe to mutate during
emission.

```ts
import { Signal, EventBus } from "@vapour/engine";

const damaged = new Signal<{ amount: number }>();
const off = damaged.on(({ amount }) => health.apply(amount));
damaged.on(updateHud, 10);   // higher order runs later
damaged.emit({ amount: 12 });
off();

interface GameEvents {
  "player.died": { cause: string };
  "item.picked": { id: string; count: number };
}
const bus = new EventBus<GameEvents>();
bus.on("player.died", ({ cause }) => respawn(cause));
bus.emit("player.died", { cause: "fall" });
```

Subscribing or unsubscribing during an emit is safe — the emit iterates a
snapshot, so a listener that removes itself does not skip its neighbour. A
listener added during an emit runs from the *next* emit.

`signal.next({ signal })` awaits one emission, which composes with coroutines
and async code.

## Timers and coroutines

```ts
import { Scheduler, waitSeconds, waitFrames, waitUntil, waitFor } from "@vapour/engine";

const scheduler = new Scheduler();

scheduler.after(2, () => spawnWave());
const tick = scheduler.every(0.25, () => regenerate());

scheduler.run(function* () {
  door.play("opening");
  yield waitSeconds(1.2);
  door.open = true;
  yield waitUntil(() => player.isInside);
  yield waitFrames(1);
  door.play("closing");
});

// once per fixed step, only while unpaused
runtimeLoop.onFixedStep((dt) => scheduler.advance(dt));
```

A coroutine runs to its first yield immediately. Cancelling one runs its
`finally` block, which is where gameplay cleanup belongs. Overshoot is carried
between waits, so a chain of timed waits does not drift behind the clock, and a
repeating timer catches up across a hitch rather than losing ticks.

`waitFor(promise)` is the one escape hatch to wall time — loading and network
genuinely are asynchronous — and a coroutine that uses it is no longer
deterministic.

### Vapour Script

```vapour
use framework

fn on_lever_pulled() {
  framework.run(fn() {
    yield framework.wait_seconds(0.5)
    self.bridge.extend()
  })
}
```

## Tweens

```ts
import { TweenRunner } from "@vapour/engine";

const tweens = new TweenRunner();
tweens.to({
  from: [0, 0, 0], to: [0, 3, 0],
  durationSeconds: 0.4, easing: "outBack",
  onUpdate: (position) => platform.setPosition(position),
  onComplete: () => platform.lock(),
});
tweens.advance(deltaSeconds);
```

Values interpolate component-wise, so one tween drives a number, a position, or
a colour. One `TweenRunner` per timeline is the usual arrangement: gameplay
tweens on the paused-with-the-game clock, UI tweens on an unpaused one, so menus
still animate while the world is frozen.

## Pools

Garbage collection is the dominant source of frame-time spikes in a browser
game. Pools trade a little bookkeeping for a flat allocation profile.

```ts
import { Pool, numberArrayPool } from "@vapour/engine";

const projectiles = new Pool<Projectile>({
  create: () => new Projectile(),
  reset: (p) => p.reset(),
  prewarm: 256,
  maxIdle: 1024,
});

const shot = projectiles.acquire();
// ...later
projectiles.release(shot);
```

Releasing twice, or releasing something the pool never handed out, throws —
that bug otherwise manifests as two unrelated entities sharing state. `use()`
releases even if the body throws.

## Tags, layers, and groups

Three ways to classify entities, deliberately not interchangeable:

| | Shape | Answers | Cost |
| --- | --- | --- | --- |
| **Layers** | 32 slots in a bitmask | "should these interact?" | one bitwise AND |
| **Tags** | open set of strings | "what kind of thing is this?" | set lookup |
| **Groups** | named collections | "which things belong to this?" | set lookup |

```ts
import { LayerRegistry, TagIndex, GroupRegistry, masksOverlap } from "@vapour/engine";

const layers = new LayerRegistry();
layers.define("player", 1);
layers.define("enemy", 2);
const hitMask = layers.mask("enemy");
if (masksOverlap(bullet.layerMask, hitMask)) applyDamage();

const tags = new TagIndex();
tags.add(barrelId, "flammable", "destructible");
for (const id of tags.entitiesWithAll("flammable", "destructible")) ignite(id);
tags.forget(barrelId);   // on destroy, or the index keeps it alive
```

`entitiesWithAll` starts from the rarest tag, so cost scales with the smallest
set rather than the largest.

## Storage, settings, saves

Browser storage is unusually failure-prone: `localStorage` throws in private
windows, is disabled by cookie-blocking settings, and has a hard quota a save
file can exceed.

```ts
import { createPersistentStore, Settings, SaveProfile } from "@vapour/engine";

const { store, persistent, reason } = createPersistentStore("my-game");
if (!persistent) showNotice(`Settings will not be saved: ${reason}`);

const settings = new Settings({
  masterVolume: { kind: "number", default: 0.8, min: 0, max: 1, step: 0.05 },
  invertY: { kind: "boolean", default: false },
  quality: { kind: "string", default: "high", options: ["low", "medium", "high"] },
}, { store, onInvalid: (key, value, why) => console.warn(key, value, why) });

settings.changed.on(({ key, value }) => audio.applySetting(key, value));
```

Settings are declared as a **schema**, and stored values are validated against
it on read. A corrupt or out-of-date value degrades to the default with a
report rather than feeding `NaN` into the renderer; an option removed in a later
build is ignored.

Saves are versioned with a migration chain, because a shipped game's save files
outlive the code that wrote them:

```ts
const saves = new SaveProfile<SaveData>({
  store,
  version: 3,
  migrations: {
    1: (data) => ({ ...data, level: 1 }),
    2: (data) => ({ ...data, skills: [] }),
  },
  validate: (data) => assertSaveData(data),
});

saves.save("slot1", state);
const loaded = saves.load("slot1");   // migrated forward automatically
```

A save from a *newer* build throws `SaveVersionError` rather than being
misread — silently dropping unknown fields is how a downgrade corrupts a
playthrough. Unreadable data throws `SaveCorruptError` with the reason, so the
game can distinguish "empty slot", "corrupt", and "too new" in its UI.

## Localization

```ts
import { Localization } from "@vapour/engine";

const strings = new Localization({ sourceLocale: "en", onMissing: reportMissingKey });
strings.register("en", {
  "menu.play": "Play",
  "hud.greeting": "Hello, {name}!",
  "inventory.items": { one: "{count} item", other: "{count} items" },
});
strings.setLocale(strings.selectLocale(navigator.languages));

strings.t("hud.greeting", { name: player.name });
strings.t("inventory.items", { count: 3 });
```

- A missing key returns the key itself and reports it: a blank label in a
  shipped build is worse than an obviously wrong one in development.
- Fallback is a chain — `pt-BR` → `pt` → source locale — which is how partially
  translated games ship.
- Plurals use CLDR categories through `Intl.PluralRules`, because "one/other" is
  wrong for most of the world's languages.
- `missingKeys(locale)` reports the translation gap, checkable in CI.

## Application lifecycle

The browser is not a console: the page can be hidden, throttled, or discarded.
A game that ignores that keeps simulating in a background tab and returns from a
five-minute hide with a five-minute delta.

```ts
import { Application, captureScreenshot, copyText } from "@vapour/engine";

const app = new Application({ host: window, visibility: document });
app.paused.on(() => { audio.suspend(); });
app.resumed.on(() => { audio.resume(); });
app.willClose.on(() => saves.save("autosave", state));   // must be synchronous

const png = await captureScreenshot(canvas);
const result = await copyText(shareCode);
if (!result.ok) showNotice(result.reason);
```

Clipboard results are returned as data rather than thrown, because both the
user-gesture requirement and the permission refusal surface as opaque DOM
errors.

## API reference

| Module | Exports |
| ------ | ------- |
| `signal` | `Signal`, `EventBus`, `SignalListener`, `Unsubscribe` |
| `scheduler` | `Scheduler`, `waitSeconds`, `waitFrames`, `waitUntil`, `waitFor`, `Coroutine`, `CoroutineYield`, `TimerHandle`, `CoroutineHandle`, `SchedulerStats` |
| `tween` | `TweenRunner`, `TweenOptions`, `TweenHandle`, `TweenState`, `TweenLoopMode`, `TweenValue` |
| `pool` | `Pool`, `numberArrayPool`, `PoolOptions`, `PoolStats` |
| `tags` | `LayerRegistry`, `TagIndex`, `GroupRegistry`, `layerMask`, `maskHasLayer`, `maskWithLayer`, `maskWithoutLayer`, `masksOverlap`, `layersInMask`, `LAYER_COUNT`, `LAYER_MASK_ALL`, `LAYER_MASK_NONE` |
| `storage` | `MemoryStore`, `WebStorageStore`, `NamespacedStore`, `createPersistentStore`, `StorageQuotaError`, `KeyValueStore` |
| `settings` | `Settings`, `SettingsSchema`, `SettingDefinition`, `SettingChange`, `SettingsOptions` |
| `localization` | `Localization`, `LocaleTable`, `LocaleEntry`, `LocalizationVariables`, `LocalizationOptions` |
| `save` | `SaveProfile`, `SaveEnvelope`, `SaveSlotInfo`, `SaveMigration`, `SaveVersionError`, `SaveCorruptError` |
| `application` | `Application`, `copyText`, `readText`, `captureScreenshot`, `ClipboardLike`, `ScreenshotOptions` |

## Performance considerations

- Signals iterate a snapshot array per emit. For a signal fired tens of
  thousands of times a frame, prefer a direct call; signals are for gameplay
  events, not for the inner loop of the renderer.
- Tweens on numeric tuples reuse one scratch array per tween, so a tween running
  for a whole session allocates once, not per frame. **Do not retain the array
  passed to `onUpdate`** — copy it if you need to keep it.
- `Pool.prewarm` moves allocation out of the first frame, where it is most
  visible.
- Layer masks are the only classification cheap enough for a per-pair physics
  or raycast test. Tags and groups are for gameplay queries.
- `Settings.save()` serializes the whole snapshot on every `set`. Batch bulk
  changes through `apply()`.

## Multiplayer considerations

Given the same delta sequence, `Scheduler` produces the same callbacks in the
same order — which is what makes it usable inside a rollback or prediction loop.
`waitFor` breaks that guarantee, so keep it out of simulated gameplay.

## XR considerations

`Application` pauses on `visibilitychange`, which fires when an XR session takes
over presentation on some platforms. If your game must keep simulating during a
session, construct it with `runWhileHidden: true` and drive pausing from the XR
session state instead.
