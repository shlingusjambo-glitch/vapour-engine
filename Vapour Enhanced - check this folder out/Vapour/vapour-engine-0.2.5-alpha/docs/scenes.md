# Scenes and prefabs

`SceneDocument` (in `core`) is the data model for *one* scene. This subsystem is
about having **many at once** — a persistent layer, a primary scene, and
streamed additive scenes — plus the reuse mechanism that keeps large worlds
authorable.

## Concept

A large game never has one scene. It has:

- a **persistent layer** that survives every transition (the player, managers,
  the audio listener),
- a **primary scene** that swaps as the player moves,
- any number of **additive scenes** streamed in around them (regions, sub-levels,
  a HUD scene).

`SceneManager` owns that arrangement, so the rest of the engine can ask one
question — *what is in the world right now?* — and get one answer from
`compose()`.

Scenes load through the [resource manager](resources.md) as the `scene` resource
type. That is deliberate: a scene loader declares its meshes, textures, and
audio with `context.require`, and those dependencies are reference counted and
released with the scene automatically. Unloading a level frees exactly what
nothing else still uses, with no bookkeeping in game code.

## Basic example

```ts
import { ResourceManager, SceneManager, SCENE_RESOURCE_TYPE } from "@vapour/engine";

const resources = new ResourceManager();
resources.register({
  type: SCENE_RESOURCE_TYPE,
  async load(id, context) {
    const data = await (await fetch(`/scenes/${id}.scene.json`)).json();
    // Dependencies declared here are released with the scene.
    for (const meshId of data.meshes ?? []) await context.require("mesh", meshId);
    return data;
  },
});

const scenes = new SceneManager(resources);
await scenes.load("village");
renderHost.submitScene(scenes.compose());
```

### Vapour Script

```vapour
use scenes

fn on_door_entered() {
  scenes.transition_to("interior", { mode: "single" })
}
```

## Typical usage

### Load modes

```ts
await scenes.load("village");                        // single: replaces everything
await scenes.load("village-north", { mode: "additive" });  // layered alongside
scenes.unload("village-north");
```

`single` unloads every other non-persistent scene — a level change. `additive`
layers a scene alongside what is loaded — streaming regions and sub-levels.

`load()` deduplicates: concurrent calls for the same scene share one load, and
loading an already-loaded scene returns the existing entry. A streaming system
can therefore call it whenever a region becomes relevant without tracking
whether it already did.

### Persistent entities

```ts
scenes.persistent.addEntity("Player");
await scenes.load("level-2");   // the player survives
```

### Transitions

```ts
await scenes.transitionTo("boss-arena", {
  transition: {
    out: () => fadeOut(400),
    in: () => fadeIn(400),
  },
  onProgress: (value) => loadingBar.set(value),
});
```

The engine does not own transition visuals — a loading screen is a game's
business — but it does own the ordering, which is the easy part to get wrong:
`out` completes before anything is unloaded, and `in` starts only once the new
scene is loaded and active.

### Lifecycle events

`SceneManager` is an `EventTarget` emitting `scenewillload`, `sceneloaded`,
`scenewillunload`, `sceneunloaded`, and `activescenechanged`. Each `detail` is
the scene id.

## Prefabs

A prefab is a reusable entity sub-tree: a streetlight, an enemy, a door, a whole
building produced by the AI asset system. Without prefabs a scene file is the
only unit of reuse, so a city of a thousand identical lamps is a thousand
hand-maintained copies.

```ts
import { PrefabLibrary, addInstanceToScene } from "@vapour/engine";

const prefabs = new PrefabLibrary();
prefabs.register({
  formatVersion: 1,
  id: "lamp",
  name: "Streetlight",
  root: "post",
  entities: [
    { id: "post", name: "Post", enabled: true, components: [/* ... */] },
    { id: "bulb", name: "Bulb", parent: "post", enabled: true, components: [/* ... */] },
  ],
});

const instance = prefabs.instantiate("lamp", {
  parent: streetEntityId,
  transform: { position: [12, 0, 4] },
  overrides: [{ entity: "bulb", component: "game.Light", field: "intensity", value: 4 }],
});

document.replace(addInstanceToScene(document.data, instance));
```

Two properties make prefabs usable for real games rather than a copy button:

**Nesting.** A prefab may contain instances of other prefabs, so a building is
composed of rooms which are composed of furniture. Nested parts are addressable
from outside through `instance.idMap` as `"child/local"`. Cycles are rejected
with the full path (`a -> b -> a`).

**Overrides.** An instance changes specific component fields without forking the
prefab — `field` is a dot path, so `color.g` works. An override that targets an
entity, component, or field the prefab does not define is an error, not a silent
no-op.

### Deterministic instantiation

```ts
const instance = prefabs.instantiate("lamp", { idFactory: (prefab, local, index) => `${seed}:${prefab}:${index}` });
```

Instantiation is deterministic given an id factory. That matters for
networking: a server and its clients instantiating the same prefab with the same
factory produce the same entity ids, so replication has stable targets. The
default factory is `crypto.randomUUID`, which guarantees uniqueness instead.

## API reference

| Export | Purpose |
| ------ | ------- |
| `SceneManager` | `load`, `transitionTo`, `unload`, `unloadAll`, `setActive`, `compose`, `scene`, `isLoaded`, `isLoading`, `stats`, `persistent`, `loaded`, `active` |
| `SCENE_RESOURCE_TYPE` | The resource type scenes load under (`"scene"`) |
| `PrefabLibrary` | `register`, `has`, `get`, `require`, `instantiate`, `ids` |
| `validatePrefab` | Validates authored prefab data |
| `addInstanceToScene` | Appends an instance's entities to scene data |
| Types | `SceneLoadMode`, `SceneLoadOptions`, `SceneTransition`, `LoadedScene`, `SceneManagerStats`, `PrefabData`, `PrefabChild`, `PrefabOverride`, `PrefabInstance`, `InstantiateOptions` |

## Performance considerations

- `compose()` clones and validates every entity, so call it when the set of
  loaded scenes changes, not once per frame. Cache the result.
- Loaded scenes are cloned from the cached resource value, so gameplay mutating
  a scene cannot corrupt the next load of it. That clone is per load, not per
  frame.
- Prefer additive scenes over one large scene for streaming: unloading a region
  is then an `unload` call rather than an entity-by-entity diff.
- Prefab instantiation clones entity data. For thousands of instances of the
  same prefab, prefer instanced rendering over thousands of scene entities.

## Multiplayer considerations

Scene ids and prefab ids are stable, serializable strings, so "load scene X" and
"instantiate prefab Y" are cheap to replicate. Combine a deterministic
`idFactory` with a server-assigned seed and clients reproduce the server's
entity ids exactly, which is what lets subsequent replication address entities
without an id table.

## XR considerations

Scene transitions are a comfort issue in VR: an abrupt swap is disorienting.
Use `transitionTo` with a fade, and prefer `additive` streaming so the world
never fully disappears.

## Vapour Script

The same API from Vapour Script — VS compiles to ESM and receives the same
engine objects as TypeScript, so nothing below is a binding layer.

```py
from "@vapour/engine" import SceneManager

var scenes = new SceneManager()

export async func go(name):
    await scenes.load(name, { mode: "additive" })
    return scenes.active
```
