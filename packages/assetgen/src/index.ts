/** `@vapour/assetgen` — declarative, AI-authorable asset generation.
 *
 * The problem this solves: an AI agent building a game cannot open Blender. It
 * can write text. So Vapour needs a representation in which a building is
 * described as floors, walls, openings, and a roof — tens of numbers — rather
 * than as the hundreds of thousands of triangles those things become.
 *
 * The design is a small set of composable layers rather than a catalogue of
 * shape functions:
 *
 * - **Mesh** — flat typed arrays, the one representation everything speaks.
 * - **Primitives** — parametric solids, all closed and correctly wound so they
 *   work as CSG operands and as physics colliders.
 * - **Transform** — placement and repetition operators.
 * - **Profile** — 2D outlines with extrude, revolve, sweep, and loft. This is
 *   the layer that makes real assets describable in text.
 * - **Describe** — the JSON form of all of it: a versioned document that names
 *   generators, composes them with groups, refs, and shape grammars, carries
 *   material graphs, and draws components from reusable libraries.
 *
 * Everything is deterministic and pure: the same description always produces
 * the same geometry, which is what makes generated assets reviewable in version
 * control and reproducible across a network.
 */
export * from "./mesh.js";
export * from "./primitives.js";
export * from "./transform.js";
export * from "./profile.js";
export * from "./csg.js";
export * from "./architecture.js";
export * from "./skeleton.js";
export * from "./character.js";
export * from "./nature.js";
export * from "./hull.js";
export * from "./compile.js";
export * from "./describe.js";
export * from "./material.js";
export * from "./props.js";
export * from "./grammar.js";
export * from "./sprites-2d.js";
export * from "./library.js";
