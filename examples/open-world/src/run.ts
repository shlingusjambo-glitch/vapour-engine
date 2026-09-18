/** Runs the open world headlessly and reports what happened. */
import { OpenWorld } from "./world.js";

const started = Date.now();
const world = new OpenWorld({ seed: 7, samples: 65, extent: 512 });
world.sendAgent();
for (let step = 0; step < 2400; step += 1) {
  world.step(1 / 30);
  const agent = world.crowd.agent(1)!;
  world.stream([agent.position[0], agent.position[1], agent.position[2]]);
}
const report = world.raiseHill(48, 48, 4);
const stats = world.stats();
const stepTime = world.diagnostics.counter("world.step").sample();

const rows: readonly [string, string][] = [
  ["terrain", `${String(stats.chunks)} chunks, ${String(stats.terrainTriangles)} triangles`],
  ["vegetation", `${String(stats.vegetation)} instances`],
  ["navmesh", `${String(stats.navSpans)} spans`],
  ["streaming", `${String(stats.residentCells)} resident cells, ${String(stats.originShifts)} origin shift(s)`],
  ["agent", `${stats.agentState}, ${stats.agentDistance.toFixed(1)} m travelled`],
  ["rebake", `${String(report.spansRebaked)} of ${String(report.spansTotal)} spans (+${String(report.spansAdded)} -${String(report.spansRemoved)} ~${String(report.spansModified)})`],
  ["step time", `${stepTime.mean.toFixed(3)} ms mean, ${stepTime.p95.toFixed(3)} ms p95`],
  ["wall clock", `${String(Date.now() - started)} ms`],
];
console.log("Open world — composed from Mirage systems\n");
for (const [label, value] of rows) console.log(`  ${label.padEnd(12)} ${value}`);
