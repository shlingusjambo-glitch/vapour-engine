import { describe, expect, it, vi } from "vitest";
import { ScriptExecutionError, ScriptScheduler, type ScriptContext } from "./scripting.js";

function context(entityId = "player"): ScriptContext { return { entityId, scene: {} as ScriptContext["scene"], input: {} as ScriptContext["input"] }; }

describe("ScriptScheduler language-neutral modules", () => {
  it("runs the same complete lifecycle for VS-compiled and TypeScript modules", () => {
    const calls: string[] = []; const scheduler = new ScriptScheduler();
    const script = scheduler.addModule({
      initialize: (ctx) => calls.push(`initialize:${ctx.entityId}`), start: () => calls.push("start"),
      update: (_, delta) => calls.push(`update:${delta}`), fixedUpdate: () => calls.push("fixed"), lateUpdate: () => calls.push("late"),
      collisionEnter: (_, other) => calls.push(`collision:${other}`), triggerExit: (_, other) => calls.push(`trigger-exit:${other}`), destroy: () => calls.push("destroy"),
    }, context());
    scheduler.update(0.25); scheduler.fixedUpdate(0.02); scheduler.lateUpdate(0.25);
    scheduler.collisionEnter("player", "wall"); scheduler.triggerExit("player", "water");
    scheduler.remove(script); scheduler.update(0.1);
    expect(calls).toEqual(["initialize:player", "start", "update:0.25", "fixed", "late", "collision:wall", "trigger-exit:water", "destroy"]);
  });
  it("adds entity and lifecycle context to script failures", () => {
    const scheduler = new ScriptScheduler(); scheduler.addModule({ update: () => { throw new Error("bad movement"); } }, context("hero"));
    expect(() => scheduler.update(0.1)).toThrow("Script on entity 'hero' failed during update: bad movement");
    try { scheduler.update(0.1); } catch (error) { expect(error).toMatchObject<Partial<ScriptExecutionError>>({ entityId: "hero", phase: "update" }); }
  });
  it("rejects events for entities without scripts", () => {
    const scheduler = new ScriptScheduler(); const spy = vi.fn(); scheduler.addModule({ collisionEnter: spy }, context("hero"));
    expect(() => scheduler.collisionEnter("missing", "wall")).toThrow("has no active scripts"); expect(spy).not.toHaveBeenCalled();
  });
});
