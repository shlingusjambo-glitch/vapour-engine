/** Runs the playground headlessly against synthetic headset frames. */
import { syntheticXrFrame } from "@vapour/engine";
import { XrPlayground, controller, trackedHand } from "./playground.js";

const playground = new XrPlayground();
const head = [0, 1.65, 0] as const;
const started = Date.now();
let time = 0;
const frame = (inputs: ReturnType<typeof controller>[]) => ({ ...syntheticXrFrame({ headPosition: head, time: (time += 1000 / 72) }), inputs });

for (let step = 0; step < 36; step += 1) await playground.frame(frame([controller("left", [-0.3, 1.2, -0.4], { stick: [0, 1] }), controller("right", [0.3, 1.2, -0.4])]), 1 / 72);
await playground.frame(frame([controller("right", [0.3, 1.0, -0.5], { squeeze: 1 })]), 1 / 72);
await playground.frame(frame([controller("right", [0.5, 1.3, -0.5], { squeeze: 1 })]), 1 / 72);
const held = playground.stats().held;
await playground.frame(frame([controller("right", [0.5, 1.3, -0.5])]), 1 / 72);
await playground.frame(frame([trackedHand("right", [-0.25, 1.65, -0.5], 0.01), trackedHand("left", [-0.3, 1.2, -0.4], 0.1)]), 1 / 72);
await playground.frame(frame([controller("right", [0.3, 1.2, -0.4], { stick: [1, 0] })]), 1 / 72);
for (let step = 0; step < 30; step += 1) await playground.frame(frame([controller("right", [0.3, 1.2, -0.4])]), 1 / 72); // snap commits mid-fade

const stats = playground.stats();
const frameTime = playground.diagnostics.counter("xr.frame").sample();
const rows: readonly [string, string][] = [
  ["head", `${stats.headHeight.toFixed(2)} m, ipd ${(stats.ipd * 1000).toFixed(0)} mm`],
  ["grab", `${held ?? "nothing"} carried to (${playground.crate.position.map((v) => v.toFixed(2)).join(", ")})`],
  ["hand poses", `left ${stats.leftPose ?? "none"}`],
  ["ui", `${String(stats.uiClicks)} click(s) by pinch on the world-space panel`],
  ["locomotion", `moved to (${stats.playerPosition.map((v) => v.toFixed(2)).join(", ")}), yaw ${(stats.playerYaw * 180 / Math.PI).toFixed(0)}°`],
  ["haptics", `${String(stats.hapticsPlayed)} pulse(s) played`],
  ["frames", `${String(stats.frames)} at ${frameTime.mean.toFixed(3)} ms mean`],
  ["wall clock", `${String(Date.now() - started)} ms`],
];
console.log("XR playground — composed from Mirage systems\n");
for (const [label, value] of rows) console.log(`  ${label.padEnd(12)} ${value}`);
