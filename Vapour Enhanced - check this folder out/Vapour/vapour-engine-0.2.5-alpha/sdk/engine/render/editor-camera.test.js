import { describe, expect, it } from "vitest";
import { EditorCamera, boundsOfInstances } from "./editor-camera.js";
function transformVector(matrix, vector) {
    return [0, 1, 2].map((row) => matrix[row] * vector[0] +
        matrix[4 + row] * vector[1] +
        matrix[8 + row] * vector[2]);
}
function length(vector) {
    return Math.hypot(vector[0], vector[1], vector[2]);
}
describe("EditorCamera", () => {
    it("looks at its pivot down the renderer's -Z convention", () => {
        const camera = new EditorCamera({ target: [2, 1, -3], distance: 6 });
        const matrix = camera.worldMatrix();
        const position = camera.position();
        const forward = transformVector(matrix, [0, 0, -1]);
        const toTarget = [2 - position[0], 1 - position[1], -3 - position[2]];
        const scale = length(toTarget);
        for (let axis = 0; axis < 3; axis += 1) {
            expect(forward[axis]).toBeCloseTo(toTarget[axis] / scale, 6);
        }
        expect(scale).toBeCloseTo(6, 6);
    });
    it("keeps an orthonormal basis at every orbit angle", () => {
        const camera = new EditorCamera();
        for (let step = 0; step < 24; step += 1) {
            camera.orbit(37, 19);
            const matrix = camera.worldMatrix();
            const right = matrix.slice(0, 3);
            const up = matrix.slice(4, 7);
            const back = matrix.slice(8, 11);
            expect(length(right)).toBeCloseTo(1, 6);
            expect(length(up)).toBeCloseTo(1, 6);
            expect(length(back)).toBeCloseTo(1, 6);
            expect(right[0] * up[0] + right[1] * up[1] + right[2] * up[2]).toBeCloseTo(0, 6);
            expect(right[0] * back[0] + right[1] * back[1] + right[2] * back[2]).toBeCloseTo(0, 6);
        }
    });
    it("clamps pitch short of the poles so the basis never collapses", () => {
        const camera = new EditorCamera();
        camera.orbit(0, 100_000);
        expect(camera.state.pitch).toBeLessThan(Math.PI / 2);
        expect(camera.state.pitch).toBeGreaterThan(Math.PI / 2 - 0.01);
        expect(() => camera.worldMatrix()).not.toThrow();
        camera.orbit(0, -200_000);
        expect(camera.state.pitch).toBeGreaterThan(-Math.PI / 2);
        expect(() => camera.worldMatrix()).not.toThrow();
    });
    it("dollies multiplicatively and clamps to a usable range", () => {
        const camera = new EditorCamera({ distance: 10 });
        camera.dolly(1);
        expect(camera.state.distance).toBeCloseTo(11.5, 6);
        camera.dolly(-1);
        expect(camera.state.distance).toBeCloseTo(10, 6);
        camera.dolly(-10_000);
        expect(camera.state.distance).toBeGreaterThan(0);
        camera.dolly(10_000);
        expect(Number.isFinite(camera.state.distance)).toBe(true);
    });
    it("pans the pivot along the view plane without changing distance", () => {
        const camera = new EditorCamera({ target: [0, 0, 0], distance: 10 });
        const before = camera.state.distance;
        camera.pan(120, -60, 800);
        expect(camera.state.distance).toBeCloseTo(before, 6);
        expect(camera.state.target).not.toEqual([0, 0, 0]);
        // Panning moves the pivot within the plane facing the camera, so the
        // offset must stay perpendicular to the view direction.
        const back = camera.worldMatrix().slice(8, 11);
        const moved = camera.state.target;
        expect(moved[0] * back[0] + moved[1] * back[1] + moved[2] * back[2]).toBeCloseTo(0, 6);
    });
    it("frames bounds so the sphere fits inside the field of view", () => {
        const camera = new EditorCamera({ fieldOfView: 60 });
        camera.focus({ center: [4, 0, 0], radius: 2 });
        expect(camera.state.target).toEqual([4, 0, 0]);
        expect(camera.state.distance).toBeGreaterThan(2);
        const halfHeightAtPivot = camera.state.distance * Math.tan((60 * Math.PI) / 180 / 2);
        expect(halfHeightAtPivot).toBeGreaterThan(2);
    });
    it("rejects non-finite focus bounds instead of producing a broken matrix", () => {
        expect(() => new EditorCamera().focus({ center: [Number.NaN, 0, 0], radius: 1 })).toThrow(/non-finite/);
    });
    it("emits a snapshot the render world validates as a camera", () => {
        const snapshot = new EditorCamera().snapshot();
        expect(snapshot.worldMatrix).toHaveLength(16);
        expect(snapshot.worldMatrix.every((value) => Number.isFinite(value))).toBe(true);
        expect(snapshot.far).toBeGreaterThan(snapshot.near);
        expect(snapshot.near).toBeGreaterThan(0);
    });
});
describe("boundsOfInstances", () => {
    const identityAt = (x, y, z) => [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        x,
        y,
        z,
        1,
    ];
    it("returns undefined when nothing is drawn", () => {
        expect(boundsOfInstances([])).toBeUndefined();
    });
    it("encloses a single unit cube", () => {
        const bounds = boundsOfInstances([
            { entityId: "a", modelMatrix: identityAt(0, 0, 0) },
        ]);
        expect(bounds?.center).toEqual([0, 0, 0]);
        expect(bounds?.radius).toBeCloseTo(Math.hypot(0.5, 0.5, 0.5), 6);
    });
    it("encloses several instances", () => {
        const bounds = boundsOfInstances([
            { entityId: "a", modelMatrix: identityAt(-4, 0, 0) },
            { entityId: "b", modelMatrix: identityAt(4, 0, 0) },
        ]);
        expect(bounds?.center[0]).toBeCloseTo(0, 6);
        expect(bounds?.radius).toBeGreaterThan(4);
    });
    it("accounts for scale in the model matrix", () => {
        const scaled = [10, 0, 0, 0, 0, 10, 0, 0, 0, 0, 10, 0, 0, 0, 0, 1];
        const bounds = boundsOfInstances([{ entityId: "a", modelMatrix: scaled }]);
        expect(bounds?.radius).toBeCloseTo(Math.hypot(5, 5, 5), 6);
    });
});
describe("boundsOfInstances with meshes", () => {
    const identityAt = (x, y, z) => [
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        x,
        y,
        z,
        1,
    ];
    it("frames a flat plane tightly instead of as a cube", () => {
        const plane = boundsOfInstances([
            {
                entityId: "a",
                modelMatrix: identityAt(0, 0, 0),
                mesh: "builtin:plane",
            },
        ]);
        const cube = boundsOfInstances([
            { entityId: "a", modelMatrix: identityAt(0, 0, 0), mesh: "builtin:cube" },
        ]);
        expect(plane.radius).toBeLessThan(cube.radius);
    });
    it("uses a capsule's narrower footprint", () => {
        const capsule = boundsOfInstances([
            {
                entityId: "a",
                modelMatrix: identityAt(0, 0, 0),
                mesh: "builtin:capsule",
            },
        ]);
        const cube = boundsOfInstances([
            { entityId: "a", modelMatrix: identityAt(0, 0, 0), mesh: "builtin:cube" },
        ]);
        expect(capsule.radius).toBeLessThan(cube.radius);
    });
    it("treats an instance with no mesh as a unit box, for framing empties", () => {
        const empty = boundsOfInstances([
            { entityId: "a", modelMatrix: identityAt(0, 0, 0) },
        ]);
        expect(empty.radius).toBeCloseTo(Math.hypot(0.5, 0.5, 0.5), 6);
    });
});
//# sourceMappingURL=editor-camera.test.js.map