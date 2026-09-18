import { DEBUG_CATEGORIES, DEBUG_COLORS } from "./debug-draw.js";
/** Draws AI heading, state, vision cone, and current perceived targets. */
export function drawAiAgent(debug, agent) {
    const origin = tuple(agent.position);
    const length = Math.hypot(agent.forward.x, agent.forward.y, agent.forward.z);
    if (!(length > 1e-8))
        throw new Error(`AI debug agent '${agent.id}' has a zero forward vector.`);
    const direction = [agent.forward.x / length, agent.forward.y / length, agent.forward.z / length];
    debug.arrow(origin, direction, { category: DEBUG_CATEGORIES.ai, color: DEBUG_COLORS.blue, headSize: 0.16 });
    debug.text([origin[0], origin[1] + 1.8, origin[2]], `${agent.id} · ${agent.state}`, { category: DEBUG_CATEGORIES.ai, color: DEBUG_COLORS.white, depthTest: false });
    if (agent.visionRange !== undefined) {
        const range = positive(agent.visionRange, "AI debug vision range");
        const fov = agent.fieldOfView ?? 90;
        if (!Number.isFinite(fov) || fov <= 0 || fov > 360)
            throw new Error("AI debug field of view must be in (0, 360].");
        const heading = Math.atan2(direction[0], direction[2]);
        const half = fov * Math.PI / 360;
        const left = [Math.sin(heading - half) * range, 0, Math.cos(heading - half) * range];
        const right = [Math.sin(heading + half) * range, 0, Math.cos(heading + half) * range];
        debug.line(origin, [origin[0] + left[0], origin[1], origin[2] + left[2]], { category: DEBUG_CATEGORIES.ai, color: DEBUG_COLORS.yellow });
        debug.line(origin, [origin[0] + right[0], origin[1], origin[2] + right[2]], { category: DEBUG_CATEGORIES.ai, color: DEBUG_COLORS.yellow });
    }
    for (const target of agent.targets ?? []) {
        debug.line(origin, tuple(target.position), { category: DEBUG_CATEGORIES.ai, color: DEBUG_COLORS.red });
        debug.sphere(tuple(target.position), 0.15, { category: DEBUG_CATEGORIES.ai, color: DEBUG_COLORS.red, segments: 8 });
    }
}
/** Records standard open-world counters for the overlay and performance captures. */
export function recordOpenWorldStats(diagnostics, stats) {
    diagnostics.set("ai.active", count(stats.activeAi, "Active AI"));
    diagnostics.set("ai.reduced", count(stats.reducedAi, "Reduced AI"));
    diagnostics.set("ai.dormant", count(stats.dormantAi, "Dormant AI"));
    diagnostics.set("world.pedestrians", count(stats.pedestrianCount, "Pedestrians"));
    diagnostics.set("world.traffic", count(stats.trafficCount, "Traffic"));
    diagnostics.set("audio.voices", count(stats.audioVoices, "Audio voices"));
    if (stats.audioRejected !== undefined)
        diagnostics.set("audio.rejected", count(stats.audioRejected, "Rejected audio voices"));
}
function tuple(value) { if (![value.x, value.y, value.z].every(Number.isFinite))
    throw new Error("AI debug position must be finite."); return [value.x, value.y, value.z]; }
function positive(value, label) { if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be finite and positive.`); return value; }
function count(value, label) { if (!Number.isInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative integer.`); return value; }
//# sourceMappingURL=open-world-debug.js.map