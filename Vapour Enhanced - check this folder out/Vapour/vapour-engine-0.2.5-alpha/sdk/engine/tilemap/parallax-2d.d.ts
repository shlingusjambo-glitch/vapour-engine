/** A general 2D parallax model, decoupled from tiles.
 *
 * `TilemapLayer.parallax` already scrolls tile *layers* at a fraction of
 * camera speed — fine when everything on screen is tiles, but a background
 * sky, a sprite-based mountain range, or a UI-space vignette isn't a
 * `TilemapLayer` and shouldn't need to become one just to parallax. This is
 * the same one-line idea (`scrollOffset = cameraPosition * factor`) applied
 * to any 2D layer, with optional wrapping for an infinitely-tiling backdrop.
 */
export interface ParallaxLayer2D {
    /** Scroll speed relative to the camera, per axis. `1` moves with the
     * camera (no parallax); `0` is fixed to the screen; values below 1 scroll
     * slower, suggesting distance. */
    readonly factor: readonly [number, number];
    /** Constant offset applied after the factor, e.g. to align a background. */
    readonly offset?: readonly [number, number];
    /** Wraps the result into `[0, size)` per axis, for a backdrop that repeats
     * seamlessly instead of running out. `0` or omitted disables wrapping on
     * that axis. */
    readonly wrap?: readonly [number, number];
}
/** The world-space position a parallax layer's content should be drawn at,
 * given the camera's position. Pure function — no rendering, no state. */
export declare function parallaxOffset(layer: ParallaxLayer2D, cameraPosition: readonly [number, number]): [number, number];
//# sourceMappingURL=parallax-2d.d.ts.map