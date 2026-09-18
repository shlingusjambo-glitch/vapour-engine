/** Large-world coordinates: floating origin and world partitioning.
 *
 * A 32-bit float has about seven significant decimal digits. Near the origin
 * that is nanometre precision; ten kilometres out it is roughly a millimetre,
 * and a hundred kilometres out roughly a centimetre. Vertices, matrices, and
 * physics all run in `f32` on the GPU and across the WASM boundary, so a world
 * larger than a few kilometres develops visible jitter: geometry shimmers,
 * physics contacts chatter, and a camera rotating in place appears to vibrate.
 *
 * The fix is not more precision — it is keeping the numbers small. A floating
 * origin stores world position in `f64` and periodically **rebases** everything
 * so the camera sits near zero, which is what makes an open world of any size
 * behave as well as a small one.
 *
 * This cannot be retrofitted cheaply: every system that caches a world position
 * has to learn about rebasing. So the shift is published as an event with the
 * delta, and systems subscribe.
 */
import { Signal } from "../framework/signal.js";
/**
 * Keeps rendered coordinates near zero for an arbitrarily large world.
 *
 * Absolute positions are held in `f64` here; everything downstream sees a local
 * position that never grows large.
 */
export class FloatingOrigin {
    /** Emitted after each rebase, so systems can move cached positions. */
    shifted = new Signal();
    #threshold;
    #snap;
    #origin = [0, 0, 0];
    #shiftCount = 0;
    constructor(options = {}) {
        this.#threshold = options.threshold ?? 1_000;
        this.#snap = options.snap ?? 1;
        if (!(this.#threshold > 0))
            throw new Error("A floating-origin threshold must be positive.");
        if (!(this.#snap > 0))
            throw new Error("A floating-origin snap must be positive.");
    }
    /** The current origin in absolute world space. */
    get origin() {
        return this.#origin;
    }
    get shiftCount() {
        return this.#shiftCount;
    }
    /** Converts an absolute world position into engine-local coordinates. */
    toLocal(world) {
        return [world[0] - this.#origin[0], world[1] - this.#origin[1], world[2] - this.#origin[2]];
    }
    /** Converts engine-local coordinates back to absolute world space. */
    toWorld(local) {
        return [local[0] + this.#origin[0], local[1] + this.#origin[1], local[2] + this.#origin[2]];
    }
    /**
     * Rebases if the viewer has strayed too far, returning the shift if so.
     *
     * Called with the viewer's **local** position, because that is what a camera
     * actually has after a previous rebase.
     */
    update(viewerLocal) {
        const distance = Math.hypot(viewerLocal[0], viewerLocal[1], viewerLocal[2]);
        if (distance < this.#threshold)
            return undefined;
        // Snap so the fractional part of every coordinate is preserved.
        const delta = [
            -Math.round(viewerLocal[0] / this.#snap) * this.#snap,
            -Math.round(viewerLocal[1] / this.#snap) * this.#snap,
            -Math.round(viewerLocal[2] / this.#snap) * this.#snap,
        ];
        if (delta[0] === 0 && delta[1] === 0 && delta[2] === 0)
            return undefined;
        this.#origin = [this.#origin[0] - delta[0], this.#origin[1] - delta[1], this.#origin[2] - delta[2]];
        this.#shiftCount += 1;
        const shift = { delta, origin: [...this.#origin], shiftCount: this.#shiftCount };
        this.shifted.emit(shift);
        return shift;
    }
    /** Applies a shift to a position, for systems handling the event. */
    static apply(position, shift) {
        return [(position[0] ?? 0) + shift.delta[0], (position[1] ?? 0) + shift.delta[1], (position[2] ?? 0) + shift.delta[2]];
    }
    /** Applies a shift in place across a packed position buffer. */
    static applyToBuffer(positions, shift, stride = 3) {
        if (!Number.isInteger(stride) || stride < 3)
            throw new Error("A position buffer stride must be a whole number of at least 3.");
        for (let index = 0; index + 2 < positions.length; index += stride) {
            positions[index] = positions[index] + shift.delta[0];
            positions[index + 1] = positions[index + 1] + shift.delta[1];
            positions[index + 2] = positions[index + 2] + shift.delta[2];
        }
    }
    /** Resets to absolute zero, for a level change. */
    reset(origin = [0, 0, 0]) {
        this.#origin = [origin[0], origin[1], origin[2]];
    }
    /**
     * Worst-case `f32` precision at a distance, in world units.
     *
     * Exposed so a game can assert its threshold is actually tight enough rather
     * than discovering the jitter in play.
     */
    static precisionAt(distance) {
        if (!(distance >= 0))
            throw new Error("A distance must not be negative.");
        if (distance === 0)
            return 0;
        // f32 has a 24-bit significand, so the gap between representable values is
        // 2^(exponent - 23).
        const exponent = Math.floor(Math.log2(distance));
        return 2 ** (exponent - 23);
    }
}
/**
 * A grid of world cells with hysteresis.
 *
 * Complements `ChunkStreamManager`, which owns the *loading*; this owns the
 * decision of what should be resident. Separating them means the policy can be
 * tested without any asynchronous loading at all.
 */
export class WorldPartition {
    #cellSize;
    #loadRadius;
    #unloadRadius;
    #resident = new Map();
    constructor(options = {}) {
        this.#cellSize = options.cellSize ?? 256;
        this.#loadRadius = options.loadRadius ?? 2;
        const padding = options.unloadPadding ?? 1;
        if (!(this.#cellSize > 0))
            throw new Error("A world partition cell size must be positive.");
        if (!Number.isInteger(this.#loadRadius) || this.#loadRadius < 0)
            throw new Error("A load radius must be a non-negative whole number of cells.");
        if (!Number.isInteger(padding) || padding < 0)
            throw new Error("An unload padding must be a non-negative whole number of cells.");
        this.#unloadRadius = this.#loadRadius + padding;
    }
    get cellSize() {
        return this.#cellSize;
    }
    get residentCells() {
        return [...this.#resident.values()];
    }
    /** The cell containing a position. */
    cellOf(position) {
        return { x: Math.floor(position[0] / this.#cellSize), z: Math.floor(position[2] / this.#cellSize) };
    }
    /** World-space centre of a cell, for placing and culling its contents. */
    centerOf(cell) {
        return [(cell.x + 0.5) * this.#cellSize, 0, (cell.z + 0.5) * this.#cellSize];
    }
    /** Updates residency for a viewer, returning what changed. */
    update(viewer) {
        const center = this.cellOf(viewer);
        const wanted = new Map();
        for (let dz = -this.#loadRadius; dz <= this.#loadRadius; dz += 1) {
            for (let dx = -this.#loadRadius; dx <= this.#loadRadius; dx += 1) {
                const ring = Math.max(Math.abs(dx), Math.abs(dz));
                if (ring > this.#loadRadius)
                    continue;
                const cell = { x: center.x + dx, z: center.z + dz, ring };
                wanted.set(cellKey(cell), cell);
            }
        }
        const toLoad = [];
        for (const [key, cell] of wanted) {
            if (!this.#resident.has(key))
                toLoad.push(cell);
        }
        // Nearest first: the cell the player is about to enter matters more than
        // one at the edge of the radius.
        toLoad.sort((a, b) => a.ring - b.ring || a.x - b.x || a.z - b.z);
        const toUnload = [];
        for (const [key, cell] of this.#resident) {
            const ring = Math.max(Math.abs(cell.x - center.x), Math.abs(cell.z - center.z));
            // Hysteresis: only unload past the larger radius, so a viewer on a
            // boundary does not thrash.
            if (ring > this.#unloadRadius)
                toUnload.push(cell);
            else if (!wanted.has(key))
                wanted.set(key, { ...cell, ring });
        }
        for (const cell of toUnload)
            this.#resident.delete(cellKey(cell));
        for (const cell of toLoad)
            this.#resident.set(cellKey(cell), cell);
        return { toLoad, toUnload, resident: this.#resident.size };
    }
    /** Shifts every resident cell after a floating-origin rebase. */
    applyOriginShift(shift) {
        const cellsX = Math.round(shift.delta[0] / this.#cellSize);
        const cellsZ = Math.round(shift.delta[2] / this.#cellSize);
        if (cellsX === 0 && cellsZ === 0)
            return;
        const moved = new Map();
        for (const cell of this.#resident.values()) {
            const shifted = { x: cell.x + cellsX, z: cell.z + cellsZ, ring: cell.ring };
            moved.set(cellKey(shifted), shifted);
        }
        this.#resident.clear();
        for (const [key, cell] of moved)
            this.#resident.set(key, cell);
    }
    clear() {
        this.#resident.clear();
    }
}
function cellKey(cell) {
    return `${cell.x}_${cell.z}`;
}
/**
 * Chooses a terrain chunk's mesh resolution by distance.
 *
 * Terrain LOD is by *ring*, not by screen size, because neighbouring chunks
 * must agree: two adjacent chunks at different resolutions leave a crack along
 * their shared edge, and a screen-size rule makes which pairs differ
 * unpredictable. Rings make adjacency predictable, so seams can be stitched.
 */
export function selectTerrainLod(levels, ring) {
    if (levels.length === 0)
        throw new Error("A terrain LOD chain needs at least one level.");
    let previous = 0;
    for (const [index, level] of levels.entries()) {
        if (!Number.isInteger(level.resolution) || level.resolution < 2) {
            throw new Error(`Terrain LOD level ${index} needs a resolution of at least 2.`);
        }
        if (index > 0 && level.resolution > previous) {
            throw new Error("Terrain LOD levels must descend in resolution from nearest to furthest.");
        }
        previous = level.resolution;
    }
    for (const level of levels) {
        if (ring <= level.ringRadius)
            return level;
    }
    return levels[levels.length - 1];
}
/**
 * Which edges of a chunk border a coarser neighbour.
 *
 * Those edges need their vertices collapsed to the neighbour's spacing, or the
 * height mismatch shows as a visible crack. Returning the set lets a mesher
 * stitch exactly the edges that need it and no others.
 */
export function terrainSeams(levels, cell, viewerCell) {
    const ringOf = (x, z) => Math.max(Math.abs(x - viewerCell.x), Math.abs(z - viewerCell.z));
    const own = selectTerrainLod(levels, cell.ring).resolution;
    const coarser = (x, z) => selectTerrainLod(levels, ringOf(x, z)).resolution < own;
    return {
        north: coarser(cell.x, cell.z - 1),
        south: coarser(cell.x, cell.z + 1),
        east: coarser(cell.x + 1, cell.z),
        west: coarser(cell.x - 1, cell.z),
    };
}
//# sourceMappingURL=large-world.js.map