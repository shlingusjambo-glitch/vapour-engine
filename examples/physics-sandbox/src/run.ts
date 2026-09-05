/** Runs the sandbox headlessly and reports what happened. */
import { PhysicsSandbox } from "./sandbox.js";

const sandbox = new PhysicsSandbox({ propCount: 12 });
sandbox.look([0, 1.7, 4], [0, 0, -1]);

/** Presses an action for one step, then releases it. */
function tap(code: string): void {
  sandbox.input.system.setKey(code, true);
  sandbox.update(1 / 60);
  sandbox.input.system.setKey(code, false);
  sandbox.update(1 / 60);
}

const started = Date.now();
for (let step = 0; step < 120; step += 1) sandbox.update(1 / 60);   // let the props settle

tap("KeyR");                                                        // open the door
for (let step = 0; step < 60; step += 1) sandbox.update(1 / 60);

sandbox.look([0, 1.7, 4], [0, -0.2, -1]);
tap("KeyE");                                                        // grab
const carried = sandbox.heldId;
for (let step = 0; step < 30; step += 1) sandbox.update(1 / 60);
tap("KeyF");                                                        // throw
for (let step = 0; step < 60; step += 1) sandbox.update(1 / 60);

tap("KeyQ");                                                        // spawn one more
for (let step = 0; step < 60; step += 1) sandbox.update(1 / 60);

const stats = sandbox.stats();
const step = sandbox.diagnostics.counter("sandbox.step").sample();

const rows: readonly [string, string][] = [
  ["bodies", `${sandbox.world.bodies.length}`],
  ["props", `${stats.props} (${stats.spawned} spawned)`],
  ["joints", `${stats.joints} (hinged door, ball pendulum)`],
  ["door", stats.doorState],
  ["carried", carried === undefined ? "nothing" : `body ${carried}`],
  ["thrown", `${stats.thrown}`],
  ["grabs broken", `${stats.grabsBroken}`],
  ["step time", `${step.mean.toFixed(3)} ms mean, ${step.p95.toFixed(3)} ms p95`],
  ["wall clock", `${Date.now() - started} ms for ~5.5 s simulated`],
];

console.log("\nPhysics sandbox — composed from Mirage systems\n");
for (const [label, value] of rows) console.log(`  ${label.padEnd(14)} ${value}`);
console.log();
