import { describe, expect, it } from "vitest";
import { GradientNoise, SeededRandom, SinePermutationNoise, hashProceduralSeed } from "./procedural-noise.js";
describe("SeededRandom", () => {
    it("replays the same cross-platform sequence from the same seed", () => {
        const first = new SeededRandom("vapour-world");
        const second = new SeededRandom("vapour-world");
        expect(Array.from({ length: 16 }, () => first.nextUint32()))
            .toEqual(Array.from({ length: 16 }, () => second.nextUint32()));
    });
    it("keeps independent named systems independent", () => {
        const root = new SeededRandom(42);
        const terrain = root.fork("terrain");
        root.next();
        root.next();
        const replay = new SeededRandom(42).fork("terrain");
        expect(Array.from({ length: 4 }, () => terrain.next()))
            .toEqual(Array.from({ length: 4 }, () => replay.next()));
    });
    it("provides bounded float and inclusive integer ranges", () => {
        const random = new SeededRandom(8);
        for (let index = 0; index < 200; index += 1) {
            expect(random.range(-4, 7)).toBeGreaterThanOrEqual(-4);
            expect(random.range(-4, 7)).toBeLessThan(7);
            expect(random.integer(-3, 3)).toBeGreaterThanOrEqual(-3);
            expect(random.integer(-3, 3)).toBeLessThanOrEqual(3);
        }
    });
    it("rejects invalid seeds and ranges instead of producing NaN", () => {
        expect(() => hashProceduralSeed(Number.NaN)).toThrow(/finite/);
        expect(() => new SeededRandom(1).range(2, 1)).toThrow(/ordered/);
        expect(() => new SeededRandom(1).integer(0.5, 3)).toThrow(/safe integers/);
    });
});
describe("GradientNoise", () => {
    it("is deterministic by seed and changes with another seed", () => {
        const points = [[0.2, 1.7], [-81.25, 34.125], [9001.2, -77.8]];
        const first = new GradientNoise("seed-a");
        const again = new GradientNoise("seed-a");
        const other = new GradientNoise("seed-b");
        expect(points.map(([x, y]) => first.noise2D(x, y))).toEqual(points.map(([x, y]) => again.noise2D(x, y)));
        expect(points.map(([x, y]) => first.noise2D(x, y))).not.toEqual(points.map(([x, y]) => other.noise2D(x, y)));
    });
    it("samples chunk boundaries from global coordinates without seams", () => {
        const noise = new GradientNoise(77);
        const fromLeftChunk = noise.fbm2D((15 + 1) * 0.03125, 4 * 0.03125);
        const fromRightChunk = noise.fbm2D(16 * 0.03125, 4 * 0.03125);
        expect(fromLeftChunk).toBe(fromRightChunk);
    });
    it("supports coherent 3D density fields", () => {
        const noise = new GradientNoise(991);
        const a = noise.noise3D(10.125, -2.5, 8.75);
        const nearby = noise.noise3D(10.126, -2.5, 8.75);
        expect(Number.isFinite(a)).toBe(true);
        expect(Math.abs(a - nearby)).toBeLessThan(0.02);
    });
    it("normalizes fractal layers and validates their configuration", () => {
        const noise = new GradientNoise(5);
        const value = noise.fbm3D(0.2, 0.4, 0.6, { octaves: 8, frequency: 0.01, lacunarity: 2.1, gain: 0.48 });
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
        expect(() => noise.fbm2D(0, 0, { octaves: 0 })).toThrow(/octaves/);
        expect(() => noise.fbm2D(0, 0, { gain: -1 })).toThrow(/positive/);
    });
    it("rejects non-finite coordinates", () => {
        const noise = new GradientNoise(5);
        expect(() => noise.noise2D(Infinity, 0)).toThrow(/finite/);
        expect(() => noise.noise3D(0, Number.NaN, 0)).toThrow(/finite/);
    });
});
describe("SinePermutationNoise", () => {
    it("locks the version-one compatibility sequence for existing world seeds", () => {
        const noise = new SinePermutationNoise("CubeGame");
        expect(noise.algorithm).toBe("sine-permutation-v1");
        expect(noise.noise2D(0.2, 1.7)).toBe(-0.2941844224000001);
        expect(noise.noise3D(-2.5, 0.25, 9.75)).toBe(0.604102611541748);
        expect(noise.fbm2D(12.25, -8.5, 5)).toBe(-0.055569556451612906);
    });
});
//# sourceMappingURL=procedural-noise.test.js.map