import { describe, expect, it } from "vitest";
import { DEFAULT_GRAB_OPTIONS, GrabController, PhysicsDoor, holdPointInFront, throwImpulse, } from "./interaction.js";
function pose(position, velocity = [0, 0, 0]) {
    return { position, rotation: [0, 0, 0, 1], linearVelocity: velocity, angularVelocity: [0, 0, 0] };
}
/** Runs the controller against a body that integrates the velocities it is given. */
function simulate(grab, bodyId, start, hold, steps, dt = 1 / 60) {
    let position = start;
    let velocity = [0, 0, 0];
    for (let step = 0; step < steps; step += 1) {
        grab.moveHold(bodyId, hold);
        const result = grab.update(new Map([[bodyId, pose(position, velocity)]]), dt);
        for (const command of result.commands) {
            if (command.type === "setLinearVelocity")
                velocity = [...command.velocity];
        }
        position = [position[0] + velocity[0] * dt, position[1] + velocity[1] * dt, position[2] + velocity[2] * dt];
        if (result.broken.length > 0)
            break;
    }
    return position;
}
describe("GrabController", () => {
    it("moves a held object toward the hold point", () => {
        const grab = new GrabController();
        grab.grab(1, [0, 0, 0]);
        const final = simulate(grab, 1, [2, 0, 0], [0, 0, 0], 120);
        expect(Math.hypot(...final)).toBeLessThan(0.2);
    });
    it("drives it with velocity, not position, so it can collide on the way", () => {
        // The controller only ever emits velocity commands; a position command
        // would teleport the object through walls.
        const grab = new GrabController();
        grab.grab(1, [1, 0, 0]);
        const result = grab.update(new Map([[1, pose([0, 0, 0])]]), 1 / 60);
        expect(result.commands).toHaveLength(1);
        expect(result.commands[0].type).toBe("setLinearVelocity");
    });
    it("caps the speed it will impart", () => {
        const grab = new GrabController();
        grab.grab(1, [0, 0, 0], { maxSpeed: 3, breakDistance: 100, stiffness: 100 });
        const result = grab.update(new Map([[1, pose([50, 0, 0])]]), 1 / 60);
        const command = result.commands[0];
        if (command.type !== "setLinearVelocity")
            throw new Error("expected a velocity command");
        expect(Math.hypot(...command.velocity)).toBeLessThanOrEqual(3 + 1e-6);
    });
    it("damps rather than oscillating around the hold point", () => {
        const grab = new GrabController();
        grab.grab(1, [0, 0, 0], { damping: 1 });
        // Sample the approach; a badly damped spring overshoots past the target.
        let position = [2, 0, 0];
        let velocity = [0, 0, 0];
        let overshoot = 0;
        for (let step = 0; step < 200; step += 1) {
            const result = grab.update(new Map([[1, pose(position, velocity)]]), 1 / 60);
            const command = result.commands[0];
            if (command.type === "setLinearVelocity")
                velocity = [...command.velocity];
            position = [position[0] + velocity[0] / 60, position[1], position[2]];
            overshoot = Math.min(overshoot, position[0]);
        }
        expect(overshoot).toBeGreaterThan(-0.35);
    });
    it("breaks when the object cannot keep up", () => {
        // Without this, an object wedged behind geometry stays "held" from across
        // the level, which reads as a bug even though the physics is correct.
        const grab = new GrabController();
        grab.grab(1, [0, 0, 0], { breakDistance: 2 });
        const result = grab.update(new Map([[1, pose([10, 0, 0])]]), 1 / 60);
        expect(result.broken).toEqual([1]);
        expect(grab.isHeld(1)).toBe(false);
        expect(result.commands).toHaveLength(0);
    });
    it("skips a body whose pose is missing rather than yanking it to the origin", () => {
        const grab = new GrabController();
        grab.grab(1, [1, 0, 0]);
        const result = grab.update(new Map(), 1 / 60);
        expect(result.commands).toEqual([]);
        expect(result.broken).toEqual([]);
        expect(grab.isHeld(1)).toBe(true);
    });
    it("holds several objects at once", () => {
        const grab = new GrabController();
        grab.grab(1, [0, 0, 0]);
        grab.grab(2, [1, 0, 0]);
        expect(grab.heldBodies).toEqual([1, 2]);
        const result = grab.update(new Map([[1, pose([0.5, 0, 0])], [2, pose([1.5, 0, 0])]]), 1 / 60);
        expect(result.commands).toHaveLength(2);
    });
    it("releases and throws", () => {
        const grab = new GrabController();
        grab.grab(1, [0, 0, 0]);
        expect(grab.release(1)).toBe(true);
        expect(grab.release(1)).toBe(false);
        grab.grab(2, [0, 0, 0]);
        const commands = grab.throwObject(2, [10, 2, 0]);
        // An impulse, not a velocity, so mass matters: a crate flies further than an anvil.
        expect(commands).toEqual([{ type: "applyImpulse", id: 2, impulse: [10, 2, 0] }]);
        expect(grab.isHeld(2)).toBe(false);
        expect(() => grab.throwObject(2, [1, 0, 0])).toThrow(/not held/);
    });
    it("rotates a held object toward a target orientation", () => {
        const grab = new GrabController();
        grab.grab(1, [0, 0, 0], { angularStiffness: 5 });
        grab.moveHold(1, [0, 0, 0], [0, 0.7071068, 0, 0.7071068]);
        const result = grab.update(new Map([[1, pose([0, 0, 0])]]), 1 / 60);
        const angular = result.commands.find((command) => command.type === "setAngularVelocity");
        expect(angular).toBeDefined();
        if (angular?.type !== "setAngularVelocity")
            throw new Error("expected an angular command");
        expect(Math.hypot(...angular.velocity)).toBeGreaterThan(0);
    });
    it("emits no angular command when the object may spin freely", () => {
        const grab = new GrabController();
        grab.grab(1, [0, 0, 0]);
        grab.moveHold(1, [0, 0, 0], [0, 0.7071068, 0, 0.7071068]);
        const result = grab.update(new Map([[1, pose([0, 0, 0])]]), 1 / 60);
        expect(result.commands.every((command) => command.type !== "setAngularVelocity")).toBe(true);
    });
    it("validates its arguments", () => {
        const grab = new GrabController();
        expect(() => grab.grab(0, [0, 0, 0])).toThrow(/positive whole number/);
        grab.grab(1, [0, 0, 0]);
        expect(() => grab.grab(1, [0, 0, 0])).toThrow(/already held/);
        expect(() => grab.moveHold(9, [0, 0, 0])).toThrow(/not held/);
        expect(() => grab.update(new Map(), 0)).toThrow(/positive, finite delta/);
        expect(() => grab.grab(2, [0, 0, 0], { stiffness: 0 })).toThrow(/stiffness must be positive/);
        expect(() => grab.grab(3, [0, 0, 0], { maxSpeed: 0 })).toThrow(/max speed must be positive/);
        expect(() => grab.grab(4, [0, 0, 0], { breakDistance: 0 })).toThrow(/break distance must be positive/);
        grab.releaseAll();
        expect(grab.heldBodies).toEqual([]);
    });
    it("exposes its defaults", () => {
        expect(DEFAULT_GRAB_OPTIONS.damping).toBe(1);
        const grab = new GrabController();
        expect(grab.grab(1, [0, 0, 0]).options).toEqual(DEFAULT_GRAB_OPTIONS);
    });
});
describe("PhysicsDoor", () => {
    it("drives its hinge motor open, then holds position", () => {
        const door = new PhysicsDoor({ jointId: 7, speed: 2, force: 400, travelSeconds: 0.5 });
        expect(door.state).toBe("closed");
        door.open();
        expect(door.state).toBe("opening");
        const first = door.update(0.1)[0];
        expect(first).toEqual({ type: "setJointMotor", id: 7, targetVelocity: 2, maxForce: 400 });
        door.update(0.5);
        expect(door.state).toBe("open");
        // Holding with the motor, not releasing it: a door pushed by a crate would
        // otherwise drift shut on its own.
        expect(door.update(0.1)).toEqual([]);
    });
    it("closes by driving the motor the other way", () => {
        const door = new PhysicsDoor({ jointId: 1, travelSeconds: 0.2 });
        door.open();
        door.update(0.3);
        door.close();
        const command = door.update(0.05)[0];
        if (command.type !== "setJointMotor")
            throw new Error("expected a motor command");
        expect(command.targetVelocity).toBeLessThan(0);
        door.update(0.3);
        expect(door.state).toBe("closed");
    });
    it("toggles between states", () => {
        const door = new PhysicsDoor({ jointId: 1, travelSeconds: 0.1 });
        door.toggle();
        expect(door.state).toBe("opening");
        door.update(0.2);
        door.toggle();
        expect(door.state).toBe("closing");
    });
    it("ignores a redundant open or close", () => {
        const door = new PhysicsDoor({ jointId: 1, travelSeconds: 1 });
        door.open();
        door.update(0.5);
        door.open();
        // Still mid-travel, not restarted.
        door.update(0.6);
        expect(door.state).toBe("open");
    });
    it("closes itself after a delay", () => {
        const door = new PhysicsDoor({ jointId: 1, travelSeconds: 0.1, autoCloseSeconds: 1 });
        door.open();
        door.update(0.2);
        expect(door.state).toBe("open");
        door.update(0.5);
        expect(door.state).toBe("open");
        door.update(0.6);
        expect(door.state).toBe("closing");
    });
    it("validates its options", () => {
        expect(() => new PhysicsDoor({ jointId: 0 })).toThrow(/positive joint id/);
        expect(() => new PhysicsDoor({ jointId: 1, speed: 0 })).toThrow(/speed must be positive/);
        expect(() => new PhysicsDoor({ jointId: 1, force: 0 })).toThrow(/motor force must be positive/);
        expect(() => new PhysicsDoor({ jointId: 1, travelSeconds: 0 })).toThrow(/travel time must be positive/);
        expect(() => new PhysicsDoor({ jointId: 1, autoCloseSeconds: 0 })).toThrow(/auto-close time must be positive/);
        expect(() => new PhysicsDoor({ jointId: 1 }).update(-1)).toThrow(/non-negative delta/);
    });
});
describe("hold and throw helpers", () => {
    it("places the hold point in front of the viewer", () => {
        expect(holdPointInFront([0, 2, 0], [0, 0, -1], 2)).toEqual([0, 2, -2]);
        // Direction is normalized, so its magnitude does not affect the distance.
        expect(holdPointInFront([0, 0, 0], [0, 0, -5], 2)).toEqual([0, 0, -2]);
    });
    it("builds a throw impulse along the aim", () => {
        expect(throwImpulse([0, 0, -2], 10)).toEqual([0, 0, -10]);
    });
    it("rejects degenerate directions and distances", () => {
        expect(() => holdPointInFront([0, 0, 0], [0, 0, 0], 1)).toThrow(/zero-length/);
        expect(() => holdPointInFront([0, 0, 0], [0, 0, -1], 0)).toThrow(/must be positive/);
        expect(() => throwImpulse([0, 0, 0], 1)).toThrow(/zero-length/);
        expect(() => throwImpulse([0, 0, -1], 0)).toThrow(/must be positive/);
    });
});
//# sourceMappingURL=interaction.test.js.map