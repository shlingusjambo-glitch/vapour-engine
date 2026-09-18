import { describe, expect, it } from "vitest";
import { Crowd, bakeNavMesh } from "./index.js";
/** Flat ground, wound face-up. */
function ground(size) {
    const half = size / 2;
    return {
        positions: new Float32Array([-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half]),
        indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
    };
}
const navmesh = () => bakeNavMesh(ground(40), { cellSize: 0.5, agentRadius: 0.3, agentMaxClimb: 0.4 });
/** Steps a crowd for a fixed simulated duration. */
function run(crowd, seconds, step = 1 / 60) {
    for (let elapsed = 0; elapsed < seconds; elapsed += step)
        crowd.update(step);
}
describe("NavAgent", () => {
    it("walks to its destination and stops", () => {
        const crowd = new Crowd(navmesh());
        const agent = crowd.addAgent({ position: [-8, 0, 0], maxSpeed: 4 });
        expect(crowd.setDestination(agent, [8, 0, 0])).toBe(true);
        expect(agent.state).toBe("moving");
        run(crowd, 12);
        expect(agent.state).toBe("arrived");
        expect(Math.hypot(agent.position[0] - 8, agent.position[2])).toBeLessThan(1);
        expect(Math.hypot(agent.velocity[0], agent.velocity[2])).toBe(0);
    });
    it("reports an unreachable destination instead of walking toward it", () => {
        const crowd = new Crowd(navmesh());
        const agent = crowd.addAgent({ position: [0, 0, 0] });
        expect(crowd.setDestination(agent, [500, 0, 500])).toBe(false);
        expect(agent.state).toBe("unreachable");
        run(crowd, 2);
        // It stayed put rather than drifting toward somewhere it cannot reach.
        expect(Math.hypot(agent.position[0], agent.position[2])).toBeLessThan(0.1);
    });
    it("never exceeds its maximum speed", () => {
        const crowd = new Crowd(navmesh());
        const agent = crowd.addAgent({ position: [-10, 0, 0], maxSpeed: 2 });
        crowd.setDestination(agent, [10, 0, 0]);
        for (let step = 0; step < 300; step += 1) {
            crowd.update(1 / 60);
            expect(Math.hypot(agent.velocity[0], agent.velocity[2])).toBeLessThanOrEqual(2 + 1e-6);
        }
    });
    it("accelerates rather than snapping to full speed", () => {
        const crowd = new Crowd(navmesh());
        const agent = crowd.addAgent({ position: [-8, 0, 0], maxSpeed: 6, maxAcceleration: 4 });
        crowd.setDestination(agent, [8, 0, 0]);
        crowd.update(1 / 60);
        expect(Math.hypot(agent.velocity[0], agent.velocity[2])).toBeLessThan(6 * 0.5);
    });
    it("reports remaining distance and its path", () => {
        const crowd = new Crowd(navmesh());
        const agent = crowd.addAgent({ position: [-8, 0, 0] });
        crowd.setDestination(agent, [8, 0, 0]);
        const before = agent.remainingDistance;
        expect(before).toBeGreaterThan(14);
        expect(agent.path.length).toBeGreaterThan(0);
        run(crowd, 2);
        expect(agent.remainingDistance).toBeLessThan(before);
    });
    it("clears its path on request", () => {
        const crowd = new Crowd(navmesh());
        const agent = crowd.addAgent({ position: [-8, 0, 0] });
        crowd.setDestination(agent, [8, 0, 0]);
        agent.clearPath();
        expect(agent.state).toBe("idle");
        expect(agent.destination).toBeUndefined();
        run(crowd, 1);
        expect(agent.position[0]).toBeCloseTo(-8, 5);
    });
    it("repaths only when a moving destination has moved far enough", () => {
        const crowd = new Crowd(navmesh());
        const agent = crowd.addAgent({ position: [-8, 0, 0] });
        crowd.setDestination(agent, [8, 0, 0]);
        const baseline = crowd.stats().repaths;
        // A small drift is not worth a repath.
        expect(crowd.updateMovingDestination(agent, [8.2, 0, 0], 1.5)).toBe(false);
        expect(crowd.stats().repaths).toBe(baseline);
        // A large one is.
        expect(crowd.updateMovingDestination(agent, [0, 0, 8], 1.5)).toBe(true);
        expect(crowd.stats().repaths).toBeGreaterThan(baseline);
    });
    it("validates its options", () => {
        const crowd = new Crowd(navmesh());
        expect(() => crowd.addAgent({ position: [0, 0, 0], radius: 0 })).toThrow(/radius must be a positive/);
        expect(() => crowd.addAgent({ position: [0, 0, 0], maxSpeed: -1 })).toThrow(/max speed must be a positive/);
        expect(() => crowd.update(-1)).toThrow(/non-negative delta/);
    });
});
describe("Crowd avoidance", () => {
    it("keeps two agents from overlapping when they swap places", () => {
        const crowd = new Crowd(navmesh());
        const a = crowd.addAgent({ position: [-6, 0, 0], radius: 0.4, maxSpeed: 3 });
        const b = crowd.addAgent({ position: [6, 0, 0], radius: 0.4, maxSpeed: 3 });
        crowd.setDestination(a, [6, 0, 0]);
        crowd.setDestination(b, [-6, 0, 0]);
        let closest = Infinity;
        for (let step = 0; step < 600; step += 1) {
            crowd.update(1 / 60);
            closest = Math.min(closest, Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]));
        }
        // They passed each other without interpenetrating badly.
        expect(closest).toBeGreaterThan(0.4);
        // And both still made progress across the map.
        expect(a.position[0]).toBeGreaterThan(0);
        expect(b.position[0]).toBeLessThan(0);
    });
    it("resolves a head-on pair rather than deadlocking", () => {
        const crowd = new Crowd(navmesh());
        const a = crowd.addAgent({ position: [-4, 0, 0], radius: 0.35, maxSpeed: 3 });
        const b = crowd.addAgent({ position: [4, 0, 0], radius: 0.35, maxSpeed: 3 });
        crowd.setDestination(a, [4, 0, 0]);
        crowd.setDestination(b, [-4, 0, 0]);
        run(crowd, 20);
        // Neither is stuck where it started.
        expect(a.position[0]).toBeGreaterThan(-3);
        expect(b.position[0]).toBeLessThan(3);
    });
    it("lets a lone agent travel straight, unaffected by avoidance", () => {
        const crowd = new Crowd(navmesh());
        const agent = crowd.addAgent({ position: [-8, 0, 0], maxSpeed: 3 });
        crowd.setDestination(agent, [8, 0, 0]);
        run(crowd, 3);
        // No neighbours, so no lateral deviation.
        expect(Math.abs(agent.position[2])).toBeLessThan(0.3);
    });
    it("moves a group of agents to their destinations", () => {
        const crowd = new Crowd(navmesh());
        const agents = Array.from({ length: 8 }, (_, index) => crowd.addAgent({ position: [-9, 0, index * 0.9 - 3.5], radius: 0.3, maxSpeed: 3.5 }));
        for (const agent of agents)
            crowd.setDestination(agent, [9, 0, agent.position[2]]);
        run(crowd, 25);
        const arrived = agents.filter((agent) => agent.position[0] > 6).length;
        expect(arrived).toBeGreaterThanOrEqual(6);
    });
    it("never lets agents interpenetrate deeply in a dense group", () => {
        const crowd = new Crowd(navmesh());
        const agents = Array.from({ length: 10 }, (_, index) => crowd.addAgent({ position: [Math.cos((index / 10) * Math.PI * 2) * 6, 0, Math.sin((index / 10) * Math.PI * 2) * 6], radius: 0.35, maxSpeed: 2.5 }));
        // Everyone crosses the middle, the worst case for avoidance.
        for (const agent of agents)
            crowd.setDestination(agent, [-agent.position[0], 0, -agent.position[2]]);
        let worstOverlap = 0;
        for (let step = 0; step < 900; step += 1) {
            crowd.update(1 / 60);
            for (let i = 0; i < agents.length; i += 1) {
                for (let j = i + 1; j < agents.length; j += 1) {
                    const gap = Math.hypot(agents[i].position[0] - agents[j].position[0], agents[i].position[2] - agents[j].position[2]);
                    worstOverlap = Math.max(worstOverlap, 0.7 - gap);
                }
            }
        }
        // Some compression under pressure is expected; passing through is not.
        expect(worstOverlap).toBeLessThan(0.5);
    });
    it("is deterministic, which is what lets a client predict NPC motion", () => {
        const simulate = () => {
            const crowd = new Crowd(navmesh());
            const agents = Array.from({ length: 6 }, (_, index) => crowd.addAgent({ position: [-7, 0, index - 2.5], radius: 0.35, maxSpeed: 3 }));
            for (const agent of agents)
                crowd.setDestination(agent, [7, 0, -agent.position[2]]);
            run(crowd, 6);
            return agents.flatMap((agent) => [agent.position[0], agent.position[2]]);
        };
        expect(simulate()).toEqual(simulate());
    });
    it("bounds neighbour cost and reports crowd statistics", () => {
        const crowd = new Crowd(navmesh(), { maxNeighbours: 3 });
        const agents = Array.from({ length: 12 }, (_, index) => crowd.addAgent({ position: [index * 0.5 - 3, 0, 0], radius: 0.3 }));
        for (const agent of agents.slice(0, 6))
            crowd.setDestination(agent, [0, 0, 8]);
        crowd.update(1 / 60);
        const stats = crowd.stats();
        expect(stats.agents).toBe(12);
        expect(stats.moving).toBeGreaterThan(0);
        expect(stats.repaths).toBe(6);
    });
    it("adds and removes agents", () => {
        const crowd = new Crowd(navmesh());
        const agent = crowd.addAgent({ position: [0, 0, 0] });
        expect(crowd.agent(agent.id)).toBe(agent);
        expect(crowd.agents).toHaveLength(1);
        expect(crowd.removeAgent(agent.id)).toBe(true);
        expect(crowd.removeAgent(agent.id)).toBe(false);
        expect(crowd.agents).toHaveLength(0);
    });
    it("validates crowd options", () => {
        expect(() => new Crowd(navmesh(), { avoidanceHorizon: 0 })).toThrow(/horizon must be positive/);
        expect(() => new Crowd(navmesh(), { avoidanceSamples: 0 })).toThrow(/at least 1/);
    });
});
//# sourceMappingURL=nav-agent.test.js.map