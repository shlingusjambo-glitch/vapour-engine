/** Tilemaps: storage, collision, and rendering data for 2D games.
 *
 * A tilemap is a grid of small integers, and the design follows from taking
 * that literally: layers are flat `Uint32Array`s, tile definitions are held once
 * per map rather than per tile, and everything else is indexing arithmetic.
 *
 * The parts that need real care are the ones games get wrong — collision that
 * matches what the player sees, and a renderer feed that culls to the view
 * instead of submitting a million tiles.
 */
export * from "./tilemap.js";
export * from "./nav-2d.js";
export * from "./parallax-2d.js";
export * from "./particles-2d.js";
export * from "./atlas-2d.js";
