import { describe, expect, it } from "vitest";
import { EMPTY_TILE, Tilemap, TilemapLayer, moveInTilemap, visibleTiles } from "./tilemap.js";
const SOLID = 1;
const PLATFORM = 2;
const SLOPE = 3;
const DECOR = 4;
function map() {
    return new Tilemap({
        tileSize: 1,
        tiles: [
            { id: SOLID, name: "stone", atlasIndex: 0, collision: { kind: "solid" } },
            { id: PLATFORM, name: "plank", atlasIndex: 1, collision: { kind: "platform" } },
            { id: SLOPE, name: "ramp", atlasIndex: 2, collision: { kind: "slope", left: 0, right: 1 } },
            { id: DECOR, name: "grass", atlasIndex: 3 },
        ],
    });
}
/** A map with a solid floor along y = 0. */
function withFloor(width = 20) {
    const tilemap = map();
    const ground = tilemap.addLayer({ name: "ground", width, height: 10 });
    ground.fill(SOLID, { x: 0, y: 0, width, height: 1 });
    return tilemap;
}
describe("TilemapLayer", () => {
    it("stores tiles in a flat grid", () => {
        const layer = new TilemapLayer({ name: "a", width: 4, height: 3 });
        expect(layer.tiles).toHaveLength(12);
        layer.set(2, 1, SOLID);
        expect(layer.get(2, 1)).toBe(SOLID);
        expect(layer.get(0, 0)).toBe(EMPTY_TILE);
    });
    it("reads out of bounds as empty rather than throwing", () => {
        // Collision and rendering both sample beyond the edges constantly.
        const layer = new TilemapLayer({ name: "a", width: 2, height: 2 });
        expect(layer.get(-1, 0)).toBe(EMPTY_TILE);
        expect(layer.get(99, 99)).toBe(EMPTY_TILE);
        expect(layer.inBounds(-1, 0)).toBe(false);
    });
    it("refuses to write out of bounds, which is a real mistake", () => {
        const layer = new TilemapLayer({ name: "a", width: 2, height: 2 });
        expect(() => layer.set(5, 0, SOLID)).toThrow(/outside layer "a" \(2x2\)/);
        expect(() => layer.set(0, 0, -1)).toThrow(/non-negative whole number/);
    });
    it("tracks a revision so a renderer can skip unchanged layers", () => {
        const layer = new TilemapLayer({ name: "a", width: 2, height: 2 });
        const start = layer.revision;
        layer.set(0, 0, SOLID);
        expect(layer.revision).toBeGreaterThan(start);
        const after = layer.revision;
        // Writing the same value is not a change.
        layer.set(0, 0, SOLID);
        expect(layer.revision).toBe(after);
    });
    it("fills whole layers and regions", () => {
        const layer = new TilemapLayer({ name: "a", width: 4, height: 4 });
        layer.fill(SOLID, { x: 1, y: 1, width: 2, height: 2 });
        expect(layer.get(1, 1)).toBe(SOLID);
        expect(layer.get(0, 0)).toBe(EMPTY_TILE);
        layer.fill(EMPTY_TILE);
        expect(layer.get(1, 1)).toBe(EMPTY_TILE);
    });
    it("loads and snapshots a grid", () => {
        const layer = new TilemapLayer({ name: "a", width: 2, height: 2 });
        layer.load([1, 2, 3, 4]);
        expect(layer.snapshot()).toEqual([1, 2, 3, 4]);
        expect(() => layer.load([1, 2])).toThrow(/holds 4 tiles but was given 2/);
    });
    it("validates its dimensions", () => {
        expect(() => new TilemapLayer({ name: " ", width: 1, height: 1 })).toThrow(/non-empty name/);
        expect(() => new TilemapLayer({ name: "a", width: 0, height: 1 })).toThrow(/width of at least 1/);
        expect(() => new TilemapLayer({ name: "a", width: 1, height: 0 })).toThrow(/height of at least 1/);
    });
});
describe("Tilemap", () => {
    it("orders layers back to front", () => {
        const tilemap = map();
        tilemap.addLayer({ name: "fg", width: 2, height: 2, order: 10 });
        tilemap.addLayer({ name: "bg", width: 2, height: 2, order: -10 });
        expect(tilemap.layers.map((layer) => layer.name)).toEqual(["bg", "fg"]);
    });
    it("names layers uniquely and reports what exists", () => {
        const tilemap = map();
        tilemap.addLayer({ name: "ground", width: 2, height: 2 });
        expect(() => tilemap.addLayer({ name: "ground", width: 2, height: 2 })).toThrow(/already exists/);
        expect(() => tilemap.layer("sky")).toThrow(/No tilemap layer named "sky".*Layers: ground/s);
        expect(tilemap.removeLayer("ground")).toBe(true);
        expect(tilemap.removeLayer("ground")).toBe(false);
    });
    it("reserves tile id 0 for empty", () => {
        const tilemap = map();
        expect(() => tilemap.define({ id: 0 })).toThrow(/reserved for empty/);
    });
    it("validates slope heights", () => {
        const tilemap = map();
        expect(() => tilemap.define({ id: 9, collision: { kind: "slope", left: 0, right: 2 } })).toThrow(/heights in \[0, 1\]/);
    });
    it("converts between world and tile coordinates", () => {
        const tilemap = new Tilemap({ tileSize: 16 });
        expect(tilemap.worldToTile(33, -1)).toEqual({ x: 2, y: -1 });
        expect(tilemap.tileToWorld(2, 3)).toEqual([32, 48]);
        expect(() => new Tilemap({ tileSize: 0 })).toThrow(/must be positive/);
    });
    it("takes the topmost colliding tile, matching what the player sees", () => {
        const tilemap = map();
        const back = tilemap.addLayer({ name: "back", width: 4, height: 4, order: 0 });
        const front = tilemap.addLayer({ name: "front", width: 4, height: 4, order: 5 });
        back.set(1, 1, SOLID);
        front.set(1, 1, PLATFORM);
        expect(tilemap.tileAt(1, 1).layer).toBe("front");
    });
    it("ignores decorative tiles and non-colliding layers", () => {
        const tilemap = map();
        const decor = tilemap.addLayer({ name: "decor", width: 4, height: 4 });
        decor.set(0, 0, DECOR);
        expect(tilemap.tileAt(0, 0)).toBeUndefined();
        const ignored = tilemap.addLayer({ name: "bg", width: 4, height: 4, collides: false, order: 9 });
        ignored.set(1, 1, SOLID);
        expect(tilemap.tileAt(1, 1)).toBeUndefined();
    });
    it("reports statistics", () => {
        const tilemap = withFloor(10);
        expect(tilemap.stats()).toMatchObject({ layers: 1, tiles: 100, nonEmpty: 10, definitions: 4 });
    });
});
describe("moveInTilemap", () => {
    const box = { x: 2, y: 1, width: 0.8, height: 1.8 };
    it("falls until it lands on the floor", () => {
        const tilemap = withFloor();
        const result = moveInTilemap(tilemap, box, [0, -5]);
        expect(result.grounded).toBe(true);
        expect(result.position[1]).toBeCloseTo(1, 5);
        expect(result.hits).toHaveLength(1);
    });
    it("moves freely when nothing is in the way", () => {
        const tilemap = withFloor();
        const result = moveInTilemap(tilemap, { ...box, y: 5 }, [1, -0.5]);
        expect(result.position[0]).toBeCloseTo(3, 5);
        expect(result.position[1]).toBeCloseTo(4.5, 5);
        expect(result.grounded).toBe(false);
    });
    it("stops against a wall without stopping vertical motion", () => {
        const tilemap = withFloor();
        tilemap.layer("ground").fill(SOLID, { x: 5, y: 0, width: 1, height: 5 });
        const result = moveInTilemap(tilemap, { ...box, x: 4, y: 2 }, [2, -0.5]);
        expect(result.blockedX).toBe(true);
        expect(result.position[0]).toBeCloseTo(5 - box.width, 5);
        expect(result.position[1]).toBeCloseTo(1.5, 5);
    });
    it("resolves axes separately, so a mover does not catch on floor seams", () => {
        // Resolving both at once from a single overlap is the classic source of a
        // character snagging between adjacent floor tiles.
        const tilemap = withFloor();
        let current = { ...box, y: 1 };
        for (let step = 0; step < 40; step += 1) {
            const result = moveInTilemap(tilemap, current, [0.25, -0.2]);
            current = { ...current, x: result.position[0], y: result.position[1] };
            expect(result.blockedX).toBe(false);
            expect(result.position[1]).toBeCloseTo(1, 5);
        }
        expect(current.x).toBeGreaterThan(10);
    });
    it("lets a mover jump up through a one-way platform and land on it", () => {
        const tilemap = withFloor();
        tilemap.layer("ground").set(3, 4, PLATFORM);
        // Rising: passes straight through.
        const rising = moveInTilemap(tilemap, { ...box, x: 3, y: 3 }, [0, 2]);
        expect(rising.blockedY).toBe(false);
        // Descending from above: lands.
        const landing = moveInTilemap(tilemap, { ...box, x: 3, y: 5.2 }, [0, -0.5]);
        expect(landing.grounded).toBe(true);
        expect(landing.position[1]).toBeCloseTo(5, 5);
    });
    it("does not let a mover below a platform be pushed up onto it", () => {
        const tilemap = withFloor();
        tilemap.layer("ground").set(3, 4, PLATFORM);
        const result = moveInTilemap(tilemap, { ...box, x: 3, y: 2.5 }, [0, -0.2]);
        expect(result.position[1]).toBeCloseTo(2.3, 5);
    });
    it("walks smoothly up a slope rather than stepping", () => {
        const tilemap = map();
        const ground = tilemap.addLayer({ name: "ground", width: 20, height: 10 });
        ground.fill(SOLID, { x: 0, y: 0, width: 20, height: 1 });
        ground.set(5, 1, SLOPE);
        const heights = [];
        let current = { ...box, x: 4.9, y: 1 };
        for (let step = 0; step < 6; step += 1) {
            const result = moveInTilemap(tilemap, current, [0.2, -0.1]);
            current = { ...current, x: result.position[0], y: result.position[1] };
            heights.push(result.position[1]);
        }
        // Rising continuously across the ramp, not in one step.
        expect(heights.at(-1)).toBeGreaterThan(heights[0]);
        for (let index = 1; index < heights.length; index += 1) {
            expect(heights[index] - heights[index - 1]).toBeLessThan(0.5);
        }
    });
    it("reports staying grounded while walking along flat ground", () => {
        const tilemap = withFloor();
        const result = moveInTilemap(tilemap, { ...box, y: 1 }, [0.3, 0], { wasGrounded: true });
        expect(result.grounded).toBe(true);
    });
    it("validates its arguments", () => {
        const tilemap = withFloor();
        expect(() => moveInTilemap(tilemap, { ...box, width: 0 }, [0, 0])).toThrow(/positive size/);
        expect(() => moveInTilemap(tilemap, box, [Number.NaN, 0])).toThrow(/must be finite/);
    });
});
describe("visibleTiles", () => {
    it("returns only tiles within the view", () => {
        // A thousand-by-thousand map is a million tiles; submitting all of them per
        // frame is not survivable at any tile size.
        const tilemap = new Tilemap({ tileSize: 1, tiles: [{ id: SOLID, atlasIndex: 7, collision: { kind: "solid" } }] });
        const layer = tilemap.addLayer({ name: "big", width: 500, height: 500 });
        layer.fill(SOLID);
        const visible = visibleTiles(tilemap, layer, { x: 100, y: 100, width: 10, height: 8 }, { margin: 0 });
        expect(visible.length).toBeLessThan(150);
        expect(visible.length).toBeGreaterThan(80);
        expect(visible[0].atlasIndex).toBe(7);
    });
    it("skips empty tiles and hidden layers", () => {
        const tilemap = withFloor(10);
        const layer = tilemap.layer("ground");
        const visible = visibleTiles(tilemap, layer, { x: 0, y: 0, width: 10, height: 10 }, { margin: 0 });
        expect(visible.every((tile) => tile.y === 0)).toBe(true);
        layer.visible = false;
        expect(visibleTiles(tilemap, layer, { x: 0, y: 0, width: 10, height: 10 })).toEqual([]);
    });
    it("shifts a parallax layer relative to the camera", () => {
        const tilemap = new Tilemap({ tileSize: 1, tiles: [{ id: SOLID, atlasIndex: 0 }] });
        const far = tilemap.addLayer({ name: "far", width: 200, height: 20, parallax: [0.5, 1] });
        far.fill(SOLID);
        const near = tilemap.addLayer({ name: "near", width: 200, height: 20, order: 1 });
        near.fill(SOLID);
        const view = { x: 100, y: 0, width: 8, height: 6 };
        const farTiles = visibleTiles(tilemap, far, view, { margin: 0 });
        const nearTiles = visibleTiles(tilemap, near, view, { margin: 0 });
        // The distant layer scrolls slower, so it shows an earlier column.
        expect(farTiles[0].x).toBeLessThan(nearTiles[0].x);
    });
    it("includes a margin so tiles do not pop in at the edge", () => {
        const tilemap = withFloor(30);
        const layer = tilemap.layer("ground");
        const tight = visibleTiles(tilemap, layer, { x: 5, y: 0, width: 5, height: 5 }, { margin: 0 });
        const padded = visibleTiles(tilemap, layer, { x: 5, y: 0, width: 5, height: 5 }, { margin: 2 });
        expect(padded.length).toBeGreaterThan(tight.length);
    });
    it("falls back to a sensible atlas index for undefined tiles", () => {
        const tilemap = new Tilemap({ tileSize: 1 });
        const layer = tilemap.addLayer({ name: "a", width: 2, height: 2 });
        layer.set(0, 0, 5);
        expect(visibleTiles(tilemap, layer, { x: 0, y: 0, width: 2, height: 2 }, { margin: 0 })[0].atlasIndex).toBe(4);
    });
});
describe("swept collision", () => {
    it("does not tunnel through a thin floor at speed", () => {
        // Testing only the destination row lets a fast body pass straight through
        // one-tile-thick geometry, which appears only at high speed or low frame rate.
        const tilemap = withFloor();
        // Speeds that carry the mover past the floor, not merely onto it: a fall
        // ending exactly flush is a separate boundary case.
        for (const speed of [-6, -20, -100, -1000]) {
            const result = moveInTilemap(tilemap, { x: 2, y: 6, width: 0.8, height: 1.8 }, [0, speed]);
            expect(result.grounded, `speed ${speed}`).toBe(true);
            expect(result.position[1], `speed ${speed}`).toBeCloseTo(1, 5);
        }
    });
    it("does not tunnel through a thin wall at speed", () => {
        const tilemap = withFloor(40);
        tilemap.layer("ground").fill(SOLID, { x: 20, y: 0, width: 1, height: 6 });
        const result = moveInTilemap(tilemap, { x: 2, y: 1, width: 0.8, height: 1.8 }, [500, 0]);
        expect(result.blockedX).toBe(true);
        expect(result.position[0]).toBeCloseTo(20 - 0.8, 5);
    });
    it("sweeps upward too, so a jump cannot pass through a ceiling", () => {
        const tilemap = withFloor();
        tilemap.layer("ground").fill(SOLID, { x: 0, y: 8, width: 20, height: 1 });
        const result = moveInTilemap(tilemap, { x: 2, y: 1, width: 0.8, height: 1.8 }, [0, 100]);
        expect(result.blockedY).toBe(true);
        expect(result.position[1]).toBeCloseTo(8 - 1.8, 5);
    });
});
//# sourceMappingURL=tilemap.test.js.map