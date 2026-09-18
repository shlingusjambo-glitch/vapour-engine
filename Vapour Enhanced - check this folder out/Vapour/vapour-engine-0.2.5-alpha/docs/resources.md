# Resources

The resource system answers one question the rest of the engine keeps asking:
**who owns this, and when is it freed?**

A Vapour game is a long-running browser session that streams content in and out
for hours. Loading is the easy half. Without a clear ownership model a streaming
world either leaks every chunk it ever visited, or frees something the renderer
is still drawing from. So `ResourceManager` is built around explicit reference
counts and an explicit dependency graph, not around a cache with a timeout.

## Concept

| Piece | What it is |
| ----- | ---------- |
| `ResourceLoader` | Knows how to turn an id of one *type* into a value. One loader per type. |
| `ResourceManager` | Loads, deduplicates, reference counts, tracks dependencies, and disposes. |
| `ResourceHandle<T>` | **One owned reference.** Whoever holds it must release it exactly once. |
| `ResourceBundle` | A named, serializable group loaded and released as a unit. |

A handle is deliberately *not* a freely copyable pointer. A second reference is
minted explicitly with `retain()`. Making sharing explicit is what lets the
manager know when a resource is genuinely unused.

Reading `handle.value` after `release()` throws, and releasing twice throws.
Both are bugs, and both are far cheaper to find at the call site than three
frames later inside the renderer.

## Basic example

```ts
import { ResourceManager } from "@vapour/engine";

const resources = new ResourceManager();

resources.register({
  type: "texture",
  async load(id) {
    const response = await fetch(`/textures/${id}.png`);
    const bitmap = await createImageBitmap(await response.blob());
    return { value: bitmap, byteEstimate: bitmap.width * bitmap.height * 4 };
  },
  dispose(bitmap) {
    bitmap.close();
  },
});

const grass = await resources.load<ImageBitmap>("texture", "grass");
draw(grass.value);
grass.release();
```

### Vapour Script

```vapour
use resources

fn start() {
  self.icon = resources.load("texture", "hud-icon")
}

fn destroy() {
  self.icon.release()
}
```

## Typical usage

### Dependencies

A loader declares what it needs with `context.require`. The resulting reference
is **owned by the parent** and released automatically when the parent is
disposed, so a loader never writes teardown code for what it required:

```ts
resources.register({
  type: "material",
  async load(id, context) {
    const definition = await context.require<MaterialData>("json", `materials/${id}`);
    const baseColor = await context.require<ImageBitmap>("texture", definition.baseColor);
    return buildMaterial(definition, baseColor);
  },
});
```

Releasing the material releases its textures — unless another material still
holds them, in which case they stay. Cycles are detected and reported with the
full path (`node:a -> node:b -> node:a`).

### Bundles

```ts
import { ResourceBundle } from "@vapour/engine";

const forest = new ResourceBundle(resources, {
  formatVersion: 1,
  name: "forest",
  resources: [
    { type: "texture", id: "bark" },
    { type: "texture", id: "leaf" },
    { type: "mesh", id: "pine" },
  ],
});

await forest.load({ onProgress: (value) => showLoadingBar(value) });
// ... play the level ...
forest.release();   // everything the bundle loaded goes with it
```

`load()` is idempotent, so a streaming system can call it whenever a region
becomes relevant without tracking whether it already did.

## Advanced usage

### Cache policy

```ts
const resources = new ResourceManager({ cachePolicy: "retain", maxCachedBytes: 256 * 1024 * 1024 });
```

- `dispose` (default) frees the moment the last handle is released. Right for
  streaming worlds, where memory pressure is the binding constraint.
- `retain` keeps unreferenced values cached so an immediate reload is free.
  Right for UI and menu assets that churn. Eviction is least-recently-released
  once `maxCachedBytes` is exceeded.

`unloadUnused()` disposes everything no handle references, cascading through
dependency chains, and returns how many resources went. That is how a level
transition reclaims memory under the `retain` policy.

### Cancellation

Each caller passes its own `signal`. Cancelling one caller rejects only that
caller — the shared load continues for everyone else, and the loader's own
`context.signal` aborts only once *every* waiter has cancelled.

### Failure handling

A failed load is **not** cached: the entry is removed so a retry can succeed,
and any dependencies already loaded for it are released. A transient network
error must not permanently poison a resource.

### Runtime-generated assets

A loader is just an async function, so procedurally generated content — meshes
from the AI asset system, generated textures, baked navigation data — registers
the same way as content fetched from a server, and gets the same ownership,
caching, and diagnostics for free.

## API reference

| Export | Purpose |
| ------ | ------- |
| `ResourceManager` | `register`, `load`, `preload`, `get`, `peek`, `isLoaded`, `isLoading`, `unloadUnused`, `stats`, `inspect`, `dispose`, `registeredTypes` |
| `ResourceHandle<T>` | `value`, `type`, `id`, `key`, `released`, `retain()`, `release()` |
| `ResourceBundle` | `load`, `release`, `state`, `name`, `resources`, `handles` |
| `validateBundle` | Validates authored bundle data before use |
| `releaseAll` | Releases a group of handles, skipping ones already released |
| `formatResourceKey` | `"type:id"` for logs and error messages |
| Types | `ResourceLoader`, `ResourceLoadContext`, `LoadedResource`, `LoadOptions`, `ResourceKey`, `ResourceStats`, `ResourceEntrySnapshot`, `ResourceManagerOptions`, `ResourceBundleData` |

Events on `ResourceManager` (an `EventTarget`): `resourceloaded`,
`resourceunloaded`, `resourcefailed`.

## Performance considerations

- `get()` and `peek()` never start a load, so they are safe to call every frame.
  `peek()` does not take a reference; use it only for diagnostics and debug
  rendering, never to hold onto a value.
- Report `byteEstimate` from loaders. Without it the cache budget cannot work
  and `stats().estimatedBytes` will under-report memory growth.
- `unloadUnused()` and cache eviction both scan every entry. Call them at
  transitions, not per frame.
- Deduplication is per resource key, so calling `load()` from many systems for
  the same asset costs one load and N reference counts.

## Multiplayer considerations

A dedicated server registers loaders only for the resources it actually needs —
collision meshes and navigation data, not textures — so the same scene and
bundle definitions drive both sides without loading render assets headlessly.

## XR considerations

XR sessions are especially sensitive to hitching, so prefer `preload` and
bundles over first-use loading: a load that stalls a frame is a comfort problem
in VR, not just a visual one.

## Vapour Script

The same API from Vapour Script — VS compiles to ESM and receives the same
engine objects as TypeScript, so nothing below is a binding layer.

```py
from "@vapour/engine" import ResourceManager

var resources = new ResourceManager()

export async func load_level(id):
    var handle = await resources.load("scene", id)
    return handle
```
