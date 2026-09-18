/** The world-space position a parallax layer's content should be drawn at,
 * given the camera's position. Pure function — no rendering, no state. */
export function parallaxOffset(layer, cameraPosition) {
    const raw = [
        cameraPosition[0] * layer.factor[0] + (layer.offset?.[0] ?? 0),
        cameraPosition[1] * layer.factor[1] + (layer.offset?.[1] ?? 0),
    ];
    const wrap = layer.wrap;
    return [
        wrap?.[0] ? wrapValue(raw[0], wrap[0]) : raw[0],
        wrap?.[1] ? wrapValue(raw[1], wrap[1]) : raw[1],
    ];
}
function wrapValue(value, size) {
    if (!(size > 0))
        throw new Error("Parallax wrap size must be positive.");
    return ((value % size) + size) % size;
}
//# sourceMappingURL=parallax-2d.js.map