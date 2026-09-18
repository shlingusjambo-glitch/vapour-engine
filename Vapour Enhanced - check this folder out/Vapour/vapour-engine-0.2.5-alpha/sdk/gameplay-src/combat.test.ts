import { describe, expect, it, vi } from "vitest";
import { armorDamageModifier, Combatant } from "./combat.js";

describe("Combatant", () => {
  it("applies ordered modifiers and emits damage/death once", () => {
    const target = new Combatant({ maxHealth: 20 });
    const events = vi.fn();
    target.subscribe(events);
    target.addModifier({ id: "shield", priority: 10, modify: ({ amount }) => amount * 0.5 });
    target.addModifier(armorDamageModifier({ points: () => 10, minimumDamage: 0.5 }));
    const first = target.damage({ amount: 10, kind: "combat" });
    expect(first.applied).toBe(3);
    expect(target.health).toBe(17);
    const lethal = target.damage({ amount: 100, kind: "combat" });
    expect(lethal.killed).toBe(true);
    expect(target.health).toBe(0);
    expect(events.mock.calls.map((call) => call[0].type)).toEqual(["damaged", "damaged", "died"]);
  });

  it("supports cancellation and invulnerability windows", () => {
    let now = 5;
    const target = new Combatant({ maxHealth: 10, invulnerabilitySeconds: 1, clock: () => now });
    target.damage({ amount: 2, kind: "hit" });
    expect(target.damage({ amount: 2, kind: "hit" }).reason).toBe("invulnerable");
    now = 6;
    expect(target.damage({ amount: 2, kind: "hit" }).accepted).toBe(true);
    expect(target.damage({ amount: 2, kind: "void", tags: ["bypass-invulnerability"] }).accepted).toBe(true);
  });

  it("heals, clamps, kills, and revives", () => {
    const target = new Combatant({ maxHealth: 20, health: 5 });
    expect(target.heal(50)).toBe(15);
    target.kill();
    expect(target.alive).toBe(false);
    expect(target.heal(2)).toBe(0);
    target.revive(7);
    expect(target.health).toBe(7);
    target.setMaxHealth(40, true);
    expect(target.health).toBe(14);
  });

  it("can bypass armor by damage kind", () => {
    const target = new Combatant({ maxHealth: 20 });
    target.addModifier(armorDamageModifier({ points: () => 20, bypassKinds: new Set(["void"]) }));
    expect(target.damage({ amount: 10, kind: "hit" }).applied).toBeCloseTo(2);
    target.setHealth(20);
    expect(target.damage({ amount: 10, kind: "void" }).applied).toBe(10);
  });

  it("rejects invalid values and duplicate modifiers", () => {
    expect(() => new Combatant({ maxHealth: 0 })).toThrow(/positive/);
    const target = new Combatant({ maxHealth: 10 });
    target.addModifier({ id: "x", modify: ({ amount }) => amount });
    expect(() => target.addModifier({ id: "x", modify: ({ amount }) => amount })).toThrow(/already/);
    expect(() => target.damage({ amount: -1, kind: "bad" })).toThrow(/non-negative/);
  });
});
