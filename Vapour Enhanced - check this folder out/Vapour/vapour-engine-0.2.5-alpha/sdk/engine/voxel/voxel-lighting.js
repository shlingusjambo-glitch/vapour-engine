/** Voxel lighting: block-light propagation, top-down skylight, and bounded
 * incremental relight after an edit.
 *
 * Light is stored per chunk, one byte per voxel, nibble-packed (`sky << 4 |
 * block`) — 4 bits is exactly enough range for the 0..15 attenuation levels
 * both channels use, and packing halves storage against two byte arrays. This
 * mirrors `VoxelChunk`'s own dense `Uint16Array` layout so a light chunk and a
 * block chunk always agree on which coordinates exist.
 *
 * Both channels are a breadth-first flood fill from their sources — emissive
 * blocks for block light, every column open to the sky for skylight — losing
 * one level per step through a non-opaque block and stopping at an opaque
 * one. That is the whole algorithm; the only real design decision is *how
 * much of the world* a relight has to touch.
 */
import { chunkKey, floorDiv, floorMod } from "./voxel-world.js";
export const MAX_LIGHT_LEVEL = 15;
/**
 * Block-light and skylight for a `VoxelWorld`, recomputed on demand.
 *
 * This does not subscribe to the world's edits automatically — call
 * `relight(x, y, z)` after `world.setBlock(...)`, the same way a mesher is
 * told to remesh the dirtied chunks. That keeps lighting an explicit,
 * synchronous step a game can budget per frame rather than a hidden cost of
 * every block edit.
 */
export class VoxelLightField {
    #world;
    #palette;
    #chunks = new Map();
    constructor(world, palette) {
        this.#world = world;
        this.#palette = palette;
    }
    get(x, y, z) {
        if (y < 0)
            return { block: 0, sky: 0 };
        if (y >= this.#world.height)
            return { block: 0, sky: MAX_LIGHT_LEVEL };
        const packed = this.#chunks.get(chunkKey(floorDiv(x, this.#world.chunkSize), floorDiv(z, this.#world.chunkSize)));
        if (packed === undefined)
            return { block: 0, sky: 0 };
        const value = packed[this.#localIndex(x, y, z)];
        return { block: value & 0xf, sky: (value >> 4) & 0xf };
    }
    /**
     * Fully recomputes every currently-loaded chunk from scratch: a top-down
     * skylight pass per column, then a combined BFS flood for both channels
     * across every loaded chunk. Call this once after bulk-loading a region
     * (e.g. a freshly generated or deserialized area); after that, prefer the
     * far cheaper `relight`.
     */
    recomputeAll() {
        this.#chunks.clear();
        const skyQueue = [];
        const blockQueue = [];
        for (const chunk of this.#world.chunks()) {
            const worldX = chunk.x * this.#world.chunkSize;
            const worldZ = chunk.z * this.#world.chunkSize;
            for (let localZ = 0; localZ < this.#world.chunkSize; localZ += 1) {
                for (let localX = 0; localX < this.#world.chunkSize; localX += 1) {
                    let sky = MAX_LIGHT_LEVEL;
                    for (let y = this.#world.height - 1; y >= 0; y -= 1) {
                        const x = worldX + localX, z = worldZ + localZ;
                        const opaque = this.#palette.isOpaque(this.#world.getBlock(x, y, z));
                        sky = opaque ? 0 : sky;
                        if (sky > 0) {
                            this.#setSky(x, y, z, sky);
                            skyQueue.push({ x, y, z, level: sky });
                        }
                        const emission = this.#palette.get(chunk.block(localX, y, localZ))?.emission ?? 0;
                        if (emission > 0) {
                            this.#setBlock(x, y, z, emission);
                            blockQueue.push({ x, y, z, level: emission });
                        }
                    }
                }
            }
        }
        this.#floodSky(skyQueue);
        this.#floodBlock(blockQueue);
    }
    /**
     * Recomputes light in a padded box around one changed voxel.
     *
     * Light can travel at most `MAX_LIGHT_LEVEL` blocks from any source, so a
     * source further than that from the edit cannot be affected by it, and
     * nothing inside the box can be lit from further than that either. The
     * box's outer shell therefore keeps whatever light it already holds — that
     * value was computed correctly by an earlier call and the edit cannot have
     * changed it — and doubles as the fixed boundary condition the interior
     * reflood reads from, exactly like a Dirichlet boundary.
     *
     * ponytail: this reflood does not itself widen the box when a very bright,
     * newly-exposed source sits right at the boundary and would have thrown
     * light past it — call `relight` again centred further out (or
     * `recomputeAll`) if a change near a chunk boundary looks under-lit. A
     * region larger than `MAX_LIGHT_LEVEL` on every axis removes the gap
     * entirely at the cost of relighting more voxels.
     */
    relight(x, y, z, radius = MAX_LIGHT_LEVEL) {
        const minX = x - radius, maxX = x + radius;
        const minY = Math.max(0, y - radius), maxY = Math.min(this.#world.height - 1, y + radius);
        const minZ = z - radius, maxZ = z + radius;
        // Clear every interior column's full height (Y has no shell — each
        // column is fully recomputed below) so stale light cannot survive a
        // decrease, e.g. a torch removed or a light path blocked. Only X/Z are
        // shrunk to exclude the shell, whose existing values are kept as fixed
        // boundary conditions rather than recomputed.
        for (let vy = minY; vy <= maxY; vy += 1) {
            for (let vz = minZ + 1; vz <= maxZ - 1; vz += 1) {
                for (let vx = minX + 1; vx <= maxX - 1; vx += 1)
                    this.#setLight(vx, vy, vz, 0, 0);
            }
        }
        const blockQueue = [];
        const skyQueue = [];
        // Seed skylight from the top of the box down each interior column, and
        // from the shell's already-correct values feeding inward.
        for (let vz = minZ; vz <= maxZ; vz += 1) {
            for (let vx = minX; vx <= maxX; vx += 1) {
                const onShellXZ = vx === minX || vx === maxX || vz === minZ || vz === maxZ;
                if (onShellXZ) {
                    for (let vy = minY; vy <= maxY; vy += 1) {
                        const sample = this.get(vx, vy, vz);
                        if (sample.sky > 0)
                            skyQueue.push({ x: vx, y: vy, z: vz, level: sample.sky });
                        if (sample.block > 0)
                            blockQueue.push({ x: vx, y: vy, z: vz, level: sample.block });
                    }
                    continue;
                }
                let sky = MAX_LIGHT_LEVEL;
                for (let vy = maxY; vy >= minY; vy -= 1) {
                    const opaque = this.#palette.isOpaque(this.#world.getBlock(vx, vy, vz));
                    sky = opaque ? 0 : sky;
                    if (sky > 0) {
                        this.#setSky(vx, vy, vz, sky);
                        skyQueue.push({ x: vx, y: vy, z: vz, level: sky });
                    }
                    const emission = this.#palette.get(this.#world.getBlock(vx, vy, vz))?.emission ?? 0;
                    if (emission > 0) {
                        this.#setBlock(vx, vy, vz, emission);
                        blockQueue.push({ x: vx, y: vy, z: vz, level: emission });
                    }
                }
            }
        }
        // The box's own top/bottom shell also feeds inward.
        for (let vz = minZ + 1; vz <= maxZ - 1; vz += 1) {
            for (let vx = minX + 1; vx <= maxX - 1; vx += 1) {
                for (const vy of [minY, maxY]) {
                    const sample = this.get(vx, vy, vz);
                    if (sample.sky > 0)
                        skyQueue.push({ x: vx, y: vy, z: vz, level: sample.sky });
                    if (sample.block > 0)
                        blockQueue.push({ x: vx, y: vy, z: vz, level: sample.block });
                }
            }
        }
        this.#flood(skyQueue, "sky", { minX, maxX, minY, maxY, minZ, maxZ });
        this.#flood(blockQueue, "block", { minX, maxX, minY, maxY, minZ, maxZ });
    }
    #floodSky(queue) {
        this.#flood(queue, "sky");
    }
    #floodBlock(queue) {
        this.#flood(queue, "block");
    }
    #flood(queue, channel, bounds) {
        let head = 0;
        while (head < queue.length) {
            const current = queue[head];
            head += 1;
            if (current.level <= 1)
                continue;
            const nextLevel = current.level - 1;
            for (const [dx, dy, dz] of NEIGHBOUR_OFFSETS) {
                const nx = current.x + dx, ny = current.y + dy, nz = current.z + dz;
                if (ny < 0 || ny >= this.#world.height)
                    continue;
                if (bounds !== undefined && (nx < bounds.minX || nx > bounds.maxX || ny < bounds.minY || ny > bounds.maxY || nz < bounds.minZ || nz > bounds.maxZ))
                    continue;
                if (this.#palette.isOpaque(this.#world.getBlock(nx, ny, nz)))
                    continue;
                const existing = channel === "sky" ? this.get(nx, ny, nz).sky : this.get(nx, ny, nz).block;
                if (existing >= nextLevel)
                    continue;
                if (channel === "sky")
                    this.#setSky(nx, ny, nz, nextLevel);
                else
                    this.#setBlock(nx, ny, nz, nextLevel);
                queue.push({ x: nx, y: ny, z: nz, level: nextLevel });
            }
        }
    }
    #setSky(x, y, z, sky) {
        const current = this.get(x, y, z);
        this.#setLight(x, y, z, current.block, sky);
    }
    #setBlock(x, y, z, block) {
        const current = this.get(x, y, z);
        this.#setLight(x, y, z, block, current.sky);
    }
    #setLight(x, y, z, block, sky) {
        if (y < 0 || y >= this.#world.height)
            return;
        const chunkX = floorDiv(x, this.#world.chunkSize);
        const chunkZ = floorDiv(z, this.#world.chunkSize);
        const key = chunkKey(chunkX, chunkZ);
        let packed = this.#chunks.get(key);
        if (packed === undefined) {
            packed = new Uint8Array(this.#world.chunkSize * this.#world.chunkSize * this.#world.height);
            this.#chunks.set(key, packed);
        }
        packed[this.#localIndex(x, y, z)] = ((sky & 0xf) << 4) | (block & 0xf);
    }
    #localIndex(x, y, z) {
        const localX = floorMod(x, this.#world.chunkSize);
        const localZ = floorMod(z, this.#world.chunkSize);
        return (y * this.#world.chunkSize + localZ) * this.#world.chunkSize + localX;
    }
}
const NEIGHBOUR_OFFSETS = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
//# sourceMappingURL=voxel-lighting.js.map