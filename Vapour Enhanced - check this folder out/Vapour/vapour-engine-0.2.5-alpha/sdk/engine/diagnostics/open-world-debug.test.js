import { describe, expect, it } from "vitest";
import { Diagnostics } from "./counters.js";
import { DebugDraw } from "./debug-draw.js";
import { drawAiAgent, recordOpenWorldStats } from "./open-world-debug.js";
describe("open-world diagnostics", () => {
    it("draws an inspectable AI agent and its target", () => {
        const debug = new DebugDraw();
        drawAiAgent(debug, { id: "ped-1", position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: 1 }, state: "flee", visionRange: 10, fieldOfView: 90, targets: [{ id: "threat", position: { x: 2, y: 0, z: 2 }, distance: 3, score: 1 }] });
        expect(debug.primitives().some((item) => item.kind === "text" && item.text.includes("flee"))).toBe(true);
        expect(debug.primitives().filter((item) => item.kind === "line").length).toBeGreaterThanOrEqual(4);
    });
    it("records standard population and simulation counters", () => {
        const diagnostics = new Diagnostics();
        recordOpenWorldStats(diagnostics, { activeAi: 12, reducedAi: 40, dormantAi: 200, pedestrianCount: 180, trafficCount: 72, audioVoices: 24, audioRejected: 3 });
        expect(diagnostics.names).toContain("ai.active");
        expect(diagnostics.snapshot().find((sample) => sample.name === "world.traffic")?.value).toBe(72);
    });
});
//# sourceMappingURL=open-world-debug.test.js.map