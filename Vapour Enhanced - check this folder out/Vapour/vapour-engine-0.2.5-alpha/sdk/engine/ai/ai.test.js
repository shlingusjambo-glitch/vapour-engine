import { describe, expect, it } from "vitest";
import { BehaviorTree, StateMachine, steerArrive, steerSeek, steerSeparation } from "./ai.js";
describe("StateMachine", () => {
    it("runs lifecycle hooks and atomic transitions", () => {
        const events = [];
        const context = { seesTarget: false };
        const machine = new StateMachine("idle", {
            idle: { enter: () => events.push("enter idle"), update: (c) => c.seesTarget ? "chase" : undefined, exit: (_, next) => events.push(`exit idle -> ${next}`) },
            chase: { enter: (_, previous) => events.push(`enter chase <- ${String(previous)}`), update: () => undefined },
        });
        machine.update(context, 0.016);
        context.seesTarget = true;
        machine.update(context, 0.016);
        expect(machine.state).toBe("chase");
        expect(machine.transitionCount).toBe(1);
        expect(events).toEqual(["enter idle", "exit idle -> chase", "enter chase <- idle"]);
    });
    it("reports unknown states with available choices", () => expect(() => new StateMachine("missing", { idle: { update: () => undefined } })).toThrow("Available states: idle"));
});
describe("BehaviorTree", () => {
    it("resumes a running sequence without replaying completed actions", () => {
        const calls = [];
        let progress = 0;
        const tree = new BehaviorTree({ id: "root", type: "sequence", children: [
                { id: "notice", type: "action", run: () => { calls.push("notice"); return "success"; } },
                { id: "walk", type: "action", run: () => { calls.push("walk"); return ++progress === 2 ? "success" : "running"; } },
                { id: "attack", type: "action", run: () => { calls.push("attack"); return "success"; } },
            ] });
        expect(tree.tick({}, 0.1)).toBe("running");
        expect(tree.tick({}, 0.1)).toBe("success");
        expect(calls).toEqual(["notice", "walk", "walk", "attack"]);
    });
    it("selects a fallback and enforces a successful-child cooldown", () => {
        let visible = false;
        let attacks = 0;
        const tree = new BehaviorTree({ id: "root", type: "selector", children: [
                { id: "combat", type: "sequence", children: [
                        { id: "visible", type: "condition", test: () => visible },
                        { id: "rate", type: "cooldown", seconds: 1, child: { id: "attack", type: "action", run: () => { attacks++; return "success"; } } },
                    ] },
                { id: "wander", type: "action", run: () => "success" },
            ] });
        expect(tree.tick({}, 0.1)).toBe("success");
        visible = true;
        expect(tree.tick({}, 0.1)).toBe("success");
        expect(attacks).toBe(1);
        expect(tree.tick({}, 0.2)).toBe("success");
        expect(attacks).toBe(1);
        tree.tick({}, 0.8);
        expect(attacks).toBe(2);
    });
    it("rejects malformed shared definitions", () => {
        expect(() => new BehaviorTree({ id: "empty", type: "selector", children: [] })).toThrow("requires at least one child");
        expect(() => new BehaviorTree({ id: "bad", type: "repeat", count: 0, child: { id: "act", type: "action", run: () => "success" } })).toThrow("positive integer");
    });
});
describe("steering", () => {
    it("seeks and arrives without allocating output", () => {
        const output = { x: 99, y: 99, z: 99 };
        expect(steerSeek(output, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }, 10)).toBe(output);
        expect(output).toEqual({ x: 6, y: 0, z: 8 });
        steerArrive(output, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 10, 4);
        expect(output).toEqual({ x: 5, y: 0, z: 0 });
    });
    it("separates from neighbours inside the radius", () => {
        const output = { x: 0, y: 0, z: 0 };
        steerSeparation(output, { x: 0, y: 0, z: 0 }, [{ x: 1, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], 2, 3);
        expect(output).toEqual({ x: -3, y: 0, z: 0 });
    });
});
//# sourceMappingURL=ai.test.js.map