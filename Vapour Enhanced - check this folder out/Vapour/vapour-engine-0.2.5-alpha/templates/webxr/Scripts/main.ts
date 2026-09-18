import type { ScriptContext } from "@vapour/engine";

export function start(context: ScriptContext): void {
  console.info("Vapour XR project ready", context);
}

export function update(context: ScriptContext, deltaSeconds: number): void {
  void context;
  void deltaSeconds;
}
