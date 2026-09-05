import type { ScriptContext } from "@vapour/engine";

/** Runs once when the scene finishes loading. */
export function start(context: ScriptContext): void {
  console.info("Vapour 3D project ready", context);
}

/** Runs every frame. `deltaSeconds` is the time since the previous frame. */
export function update(context: ScriptContext, deltaSeconds: number): void {
  void context;
  void deltaSeconds;
}
