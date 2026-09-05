# 2D rendering

Vapour's 2D pipeline uses WebGPU directly. It is not a DOM overlay and it does
not emulate an orthographic camera with a narrow perspective lens. Authored
`vapour.Camera` components accept `projection: "orthographic"` and
`orthographicSize`; the same projection is available to binary game frames via
`FrameBuilder.setOrthographicCamera`.

## Runtime sprites

`SpriteBatch2D` converts atlas-backed sprites into combined indexed meshes. It
groups compatible sprites by material and sorting layer, preserves stable order
inside a layer, and emits one `MeshUpload` per group. Upload these meshes through
`GameContext.uploadMesh`, then draw them using their returned batch IDs and
materials. Rebuild and replace a batch only when its contents change; animation
frames should normally change UV/source rectangles at the sprite-system level,
not upload unrelated geometry every frame.

Each `SpriteAsset` declares a stable ID, material ID, texture dimensions, pixel
source rectangle, pixels per unit, pivot, and optional nine-slice borders. Each
draw supplies position, size, rotation, tint, flips, sorting layer, and order.
Invalid rectangles, borders, dimensions, pivots, colors, and non-integer sort
keys fail with the sprite or field named.

Authored scenes can attach `vapour.SpriteRenderer`. It serializes a stable
material ID, tint, sorting layer, and order; extraction emits a quad and the
Rust renderer resolves the actual material pipeline. Older
`builtin:standard` references migrate to `builtin:default`, and old render
snapshots with no material deserialize to the default. Custom materials must be
defined before submitting the scene; automatic editor project-asset loading is
still a release gate.

```ts
import { FrameBuilder, SpriteBatch2D } from "@vapour/engine";

const sprites = new SpriteBatch2D("dialogue-ui");
sprites.add({
  sprite: {
    id: "ui:panel",
    material: "material:ui-atlas",
    textureSize: [1024, 1024],
    rect: [0, 0, 256, 128],
    border: [24, 24, 24, 24],
    pixelsPerUnit: 100,
  },
  position: [0, -3],
  size: [16, 3],
  sortingLayer: 100,
});

for (const batch of sprites.build()) {
  game.uploadMesh(batch.id, batch.mesh);
}

const frame = new FrameBuilder();
frame.setOrthographicCamera(cameraWorldMatrix, 10, 0.1, 100);
for (const batch of sprites.build()) {
  frame.draw(batch.id, identityMatrix, { material: batch.material });
}
```

Keep the result of `build()` rather than calling it twice as the shortened
example does; building allocates combined geometry intentionally.

## Pixel-perfect coordinates

`OrthographicCamera2D` centralizes reference-resolution policy for rendering,
pointer hit testing, and editor tools. `fixed-height` preserves vertical extent,
`expand` reveals additional world space without cropping, and `crop` preserves
the reference frame by cropping one axis. `snap` maps world positions to physical
pixel boundaries and `screenToWorld` converts top-left browser coordinates.

## Text

`layoutText2D` consumes a serializable `FontAtlas` and produces the same
`MeshUpload` shape as sprites. Glyph metrics, pair kerning, explicit newlines,
maximum-width wrapping, left/center/right alignment, font scaling, and tint are
applied before upload. Segmentation uses Unicode grapheme clusters, so a
multi-code-point emoji or combining sequence is treated as one visible glyph.
Fonts may declare a fallback glyph; without one, a missing character fails with
the font ID and missing grapheme instead of silently rendering nothing.

The atlas material uses a blended standard material whose base-color texture
carries glyph coverage in alpha or signed-distance coverage.

`importBrowserFont` now performs that import in the editor or browser build
environment. It waits for browser fonts, measures Unicode graphemes, packs an
atlas, rasterizes coverage, and optionally converts alpha to a signed-distance
field. The result includes the stable texture ID, RGBA8 upload, material
definition, and serializable glyph metrics. Upload `textureId`/`texture`, define
`font.material` with the returned material, then pass `font` to text/UI layout.
SDF materials use derivative-aware smoothing in the standard WGSL shader.

## Current limits

The runtime batching, real orthographic GPU projection, camera math, and basic
scene-authored sprite components are implemented and tested. MSDF importing,
tilemaps, 2D lighting, 2D physics, and visual sprite import/editing are still
release gates. Atlas batching and UI composition remain runtime APIs while the
editor asset loader is unfinished. The editor does not expose controls that
pretend those unfinished integrations exist.

---

# Tilemaps (Alpha 0.2.5)

A tilemap is a grid of small integers, and the design follows from taking that
literally. Layers are flat `Uint32Array`s; tile definitions are held once per
map rather than per tile, because a map with a hundred thousand tiles has
perhaps fifty distinct kinds. Storing tiles as objects costs an order of
magnitude more memory and turns every lookup into two pointer chases.

```ts
import { Tilemap, moveInTilemap, visibleTiles } from "@vapour/engine";

const map = new Tilemap({
  tileSize: 16,
  tiles: [
    { id: 1, name: "stone", atlasIndex: 0, collision: { kind: "solid" } },
    { id: 2, name: "plank", atlasIndex: 1, collision: { kind: "platform" } },
    { id: 3, name: "ramp",  atlasIndex: 2, collision: { kind: "slope", left: 0, right: 1 } },
    { id: 4, name: "grass", atlasIndex: 3 },
  ],
});

const ground = map.addLayer({ name: "ground", width: 512, height: 128 });
const far = map.addLayer({ name: "far", width: 512, height: 128, order: -10, parallax: [0.5, 1], collides: false });
```

Tile id **0 is always empty**, so a zeroed buffer is an empty map.

Reading out of bounds returns empty rather than throwing — collision and
rendering both sample beyond the edges constantly, and making that an error
would mean a bounds check at every call site. *Writing* out of bounds does
throw, because that is a real mistake.

Each layer tracks a `revision` that increments only on actual change, so a
renderer can skip rebuilding a layer that did not move.

## Collision

```ts
const result = moveInTilemap(map, playerBox, [velocityX * dt, velocityY * dt], { wasGrounded });
player.position = result.position;
player.grounded = result.grounded;
```

Three decisions here, each guarding a specific bug:

**Axes resolve separately, horizontal first.** Resolving both at once from a
single overlap is the classic source of a character snagging on the seams
between adjacent floor tiles — the solver cannot tell whether to push out
sideways or upward, and picks wrong on alternate frames. There is a test that
walks forty steps along a flat floor and asserts the mover is never blocked
horizontally.

**Both axes sweep, rather than testing the destination.** Testing only where the
mover would end up lets a fast body tunnel straight through one-tile-thick
geometry. A falling character passing through the floor is the canonical
symptom, and it appears only at high speed or low frame rate — which is to say,
in play and not in testing. The suite checks speeds up to 1,000 units per step.

**One-way platforms are solid only from above**, and only when the mover started
clear of them. That is what lets a player jump up through a platform and land on
it, without being shoved up onto one they were standing beneath.

Slopes are resolved by sampling the surface height under the mover, so a
character walks smoothly up a ramp rather than stepping. Without slopes, every
hill in a tile grid is a staircase and players feel it immediately.

## Rendering

```ts
for (const layer of map.layers) {
  for (const tile of visibleTiles(map, layer, camera.viewRect, { margin: 1 })) {
    batch.draw(tile.atlasIndex, tile.x * map.tileSize, tile.y * map.tileSize);
  }
}
```

Culling to the view is **not an optimization here but a requirement**: a
thousand-by-thousand map is a million tiles, and submitting all of them per
frame is not survivable at any tile size.

`parallax` shifts which part of a layer the camera sees, so a distant background
scrolls slower with no extra bookkeeping. `margin` keeps tiles from popping in at
the edge.

`map.tileAt(x, y)` takes the **topmost** colliding tile, matching what the player
sees. Layers marked `collides: false` are ignored by collision entirely, which is
what a decorative background wants.

## API reference

| Export | Purpose |
| ------ | ------- |
| `Tilemap` | `define`, `addLayer`, `layer`, `removeLayer`, `tileAt`, `worldToTile`, `tileToWorld`, `stats` |
| `TilemapLayer` | `get`, `set`, `fill`, `load`, `snapshot`, `inBounds`, `revision` |
| `moveInTilemap` | Swept AABB movement with slopes and one-way platforms |
| `visibleTiles` | View-culled, parallax-aware render instances |
| `EMPTY_TILE` | Tile id 0 |

## Performance considerations

- A layer is one `Uint32Array`. A 512×128 layer is 256 KB, and lookups are a
  single indexed read.
- `visibleTiles` allocates one array per call. Call it once per layer per frame
  and reuse the result across passes.
- `stats()` scans every tile, so it is for diagnostics rather than per-frame use.
