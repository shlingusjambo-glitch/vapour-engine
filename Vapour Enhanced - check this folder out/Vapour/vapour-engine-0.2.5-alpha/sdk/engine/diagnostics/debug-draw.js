/** Default colours, so subsystems agree on what a shape's colour means. */
export const DEBUG_COLORS = {
    white: [1, 1, 1, 1],
    red: [1, 0.2, 0.2, 1],
    green: [0.2, 1, 0.3, 1],
    blue: [0.3, 0.5, 1, 1],
    yellow: [1, 0.9, 0.2, 1],
    cyan: [0.2, 0.9, 1, 1],
    magenta: [1, 0.3, 0.9, 1],
    orange: [1, 0.6, 0.1, 1],
};
/** Categories the engine's own subsystems draw under, so they can be toggled
 * independently. */
export const DEBUG_CATEGORIES = {
    physics: "physics",
    navigation: "navigation",
    culling: "culling",
    audio: "audio",
    network: "network",
    ai: "ai",
    xr: "xr",
    general: "general",
};
/**
 * A frame's worth of queued debug primitives.
 *
 * Categories can be enabled independently, and a disabled category costs one
 * set lookup per call — cheap enough that debug drawing can stay in shipping
 * gameplay code behind a switch rather than being deleted.
 */
export class DebugDraw {
    #primitives = [];
    #disabled = new Set();
    #enabled = true;
    #maxPrimitives;
    #dropped = 0;
    constructor(options = {}) {
        const max = options.maxPrimitives ?? 100_000;
        if (!Number.isInteger(max) || max < 1)
            throw new Error("DebugDraw requires a positive whole primitive budget.");
        this.#maxPrimitives = max;
    }
    get enabled() {
        return this.#enabled;
    }
    set enabled(value) {
        this.#enabled = value;
    }
    /** Primitives dropped because the budget was hit, so a runaway debug loop is
     * visible as a number instead of as a frozen tab. */
    get dropped() {
        return this.#dropped;
    }
    get count() {
        return this.#primitives.length;
    }
    setCategoryEnabled(category, enabled) {
        if (enabled)
            this.#disabled.delete(category);
        else
            this.#disabled.add(category);
    }
    isCategoryEnabled(category) {
        return this.#enabled && !this.#disabled.has(category);
    }
    get disabledCategories() {
        return [...this.#disabled].sort();
    }
    line(from, to, options = {}) {
        const category = options.category ?? DEBUG_CATEGORIES.general;
        if (!this.isCategoryEnabled(category))
            return;
        if (this.#primitives.length >= this.#maxPrimitives) {
            this.#dropped += 1;
            return;
        }
        this.#primitives.push({
            kind: "line",
            category,
            from: [from[0] ?? 0, from[1] ?? 0, from[2] ?? 0],
            to: [to[0] ?? 0, to[1] ?? 0, to[2] ?? 0],
            color: options.color ?? DEBUG_COLORS.white,
            duration: options.duration ?? 0,
            depthTest: options.depthTest ?? true,
        });
    }
    text(position, text, options = {}) {
        const category = options.category ?? DEBUG_CATEGORIES.general;
        if (!this.isCategoryEnabled(category))
            return;
        if (this.#primitives.length >= this.#maxPrimitives) {
            this.#dropped += 1;
            return;
        }
        this.#primitives.push({
            kind: "text",
            category,
            position: [position[0] ?? 0, position[1] ?? 0, position[2] ?? 0],
            text,
            color: options.color ?? DEBUG_COLORS.white,
            duration: options.duration ?? 0,
            depthTest: options.depthTest ?? true,
        });
    }
    /** Connects a sequence of points; `close` joins the last back to the first. */
    polyline(points, options = {}) {
        for (let index = 0; index + 1 < points.length; index += 1) {
            this.line(points[index], points[index + 1], options);
        }
        if (options.close && points.length > 2)
            this.line(points[points.length - 1], points[0], options);
    }
    /** Wireframe axis-aligned box, the workhorse for bounds and colliders. */
    box(min, max, options = {}) {
        const [x0, y0, z0] = [min[0] ?? 0, min[1] ?? 0, min[2] ?? 0];
        const [x1, y1, z1] = [max[0] ?? 0, max[1] ?? 0, max[2] ?? 0];
        const corners = [
            [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
            [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
        ];
        const edges = [
            [0, 1], [1, 2], [2, 3], [3, 0],
            [4, 5], [5, 6], [6, 7], [7, 4],
            [0, 4], [1, 5], [2, 6], [3, 7],
        ];
        for (const [a, b] of edges)
            this.line(corners[a], corners[b], options);
    }
    /** Three orthogonal rings approximating a sphere. */
    sphere(center, radius, options = {}) {
        if (!(radius > 0))
            throw new Error("A debug sphere requires a positive radius.");
        const segments = options.segments ?? 24;
        if (!Number.isInteger(segments) || segments < 3)
            throw new Error("A debug sphere requires at least three segments.");
        const [cx, cy, cz] = [center[0] ?? 0, center[1] ?? 0, center[2] ?? 0];
        for (const axis of [0, 1, 2]) {
            const points = [];
            for (let step = 0; step <= segments; step += 1) {
                const angle = (step / segments) * Math.PI * 2;
                const [a, b] = [Math.cos(angle) * radius, Math.sin(angle) * radius];
                points.push(axis === 0 ? [cx, cy + a, cz + b] : axis === 1 ? [cx + a, cy, cz + b] : [cx + a, cy + b, cz]);
            }
            this.polyline(points, options);
        }
    }
    /** A ray with a small arrowhead, for directions and normals. */
    arrow(origin, direction, options = {}) {
        const [ox, oy, oz] = [origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0];
        const [dx, dy, dz] = [direction[0] ?? 0, direction[1] ?? 0, direction[2] ?? 0];
        const tip = [ox + dx, oy + dy, oz + dz];
        this.line([ox, oy, oz], tip, options);
        const length = Math.hypot(dx, dy, dz);
        if (length < 1e-6)
            return;
        const head = options.headSize ?? length * 0.15;
        const unit = [dx / length, dy / length, dz / length];
        // Any perpendicular pair; the arrowhead only has to read as an arrow.
        const reference = Math.abs(unit[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const side = [
            unit[1] * reference[2] - unit[2] * reference[1],
            unit[2] * reference[0] - unit[0] * reference[2],
            unit[0] * reference[1] - unit[1] * reference[0],
        ];
        const sideLength = Math.hypot(side[0], side[1], side[2]) || 1;
        for (const sign of [1, -1]) {
            this.line(tip, [
                tip[0] - unit[0] * head + (side[0] / sideLength) * head * sign,
                tip[1] - unit[1] * head + (side[1] / sideLength) * head * sign,
                tip[2] - unit[2] * head + (side[2] / sideLength) * head * sign,
            ], options);
        }
    }
    /** Three coloured axes showing a transform's orientation. */
    axes(origin, scale = 1, options = {}) {
        this.arrow(origin, [scale, 0, 0], { ...options, color: DEBUG_COLORS.red });
        this.arrow(origin, [0, scale, 0], { ...options, color: DEBUG_COLORS.green });
        this.arrow(origin, [0, 0, scale], { ...options, color: DEBUG_COLORS.blue });
    }
    /** Everything queued, for a renderer to consume. */
    primitives() {
        return this.#primitives;
    }
    /**
     * Drops one frame's primitives, keeping those with time remaining.
     *
     * Timed primitives are what make a single-frame event — a raycast hit, a
     * collision — visible at all: they persist long enough to see without the
     * caller having to redraw them.
     */
    clear(deltaSeconds = 0) {
        if (deltaSeconds < 0)
            throw new Error("DebugDraw.clear requires a non-negative delta.");
        let write = 0;
        for (const primitive of this.#primitives) {
            const remaining = primitive.duration - deltaSeconds;
            if (remaining > 0) {
                this.#primitives[write++] = { ...primitive, duration: remaining };
            }
        }
        this.#primitives.length = write;
        this.#dropped = 0;
    }
    /** Removes everything, timed primitives included. */
    reset() {
        this.#primitives.length = 0;
        this.#dropped = 0;
    }
}
//# sourceMappingURL=debug-draw.js.map