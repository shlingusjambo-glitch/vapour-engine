import { describe, expect, it } from "vitest";
import { ENVIRONMENT_STRIDE, FOG_EXPONENTIAL, FOG_LINEAR, packEnvironment, } from "./environment.js";
describe("packEnvironment", () => {
    it("packs a linear clear-and-fog environment into aligned lanes", () => {
        const packed = packEnvironment({
            clearColor: [0.1, 0.2, 0.3, 1],
            fog: { mode: "linear", color: [0.4, 0.5, 0.6], near: 10, far: 200 },
        });
        expect(packed.slice(0, 12)).toEqual(new Float32Array([
            0.1,
            0.2,
            0.3,
            1,
            0.4,
            0.5,
            0.6,
            FOG_LINEAR,
            10,
            200,
            0,
            0,
        ]));
        expect(packed).toHaveLength(ENVIRONMENT_STRIDE);
    });
    it("packs a validated HDR procedural sky", () => {
        const packed = packEnvironment({
            clearColor: [0.1, 0.2, 0.3, 1],
            sky: {
                mode: "procedural",
                zenithColor: [0.08, 0.22, 0.8],
                horizonColor: [0.9, 0.5, 0.2],
                groundColor: [0.04, 0.03, 0.02],
                horizonCurve: 0.8,
                sunAngularRadius: 0.01,
            },
        });
        expect(packed.slice(12, 16)).toEqual(new Float32Array([0.08, 0.22, 0.8, 1]));
        expect(packed.slice(16, 20)).toEqual(new Float32Array([0.9, 0.5, 0.2, 0.8]));
        expect(packed.slice(20, 24)).toEqual(new Float32Array([0.04, 0.03, 0.02, 0.01]));
        expect(() => packEnvironment({
            clearColor: [0, 0, 0, 1],
            sky: {
                mode: "procedural",
                zenithColor: [-1, 0, 0],
                horizonColor: [0, 0, 0],
                groundColor: [0, 0, 0],
            },
        })).toThrow(/zenith color/);
    });
    it("packs exponential density and validates unsafe ranges", () => {
        const packed = packEnvironment({
            clearColor: [0, 0, 0, 1],
            fog: { mode: "exponential", color: [0.2, 0.3, 0.4], density: 0.025 },
        });
        expect(packed[7]).toBe(FOG_EXPONENTIAL);
        expect(packed[10]).toBeCloseTo(0.025);
        expect(() => packEnvironment({
            clearColor: [0, 0, 0, 1],
            fog: { mode: "linear", color: [1, 1, 1], near: 20, far: 10 },
        })).toThrow(/near < far/);
        expect(() => packEnvironment({
            clearColor: [0, 0, 0, 1],
            fog: { mode: "exponential", color: [1, 1, 1], density: -1 },
        })).toThrow(/non-negative/);
    });
});
//# sourceMappingURL=environment.test.js.map