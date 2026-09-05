# Combat and health

`Combatant<TSource>` owns health, maximum health, damage, healing, death,
revival, invulnerability windows, and deterministic damage modifiers. It has no
dependency on a renderer, physics engine, item catalog, or particular genre.

```ts
const player = new Combatant<EntityId>({
  maxHealth: 100,
  invulnerabilitySeconds: 0.15,
});

player.addModifier({
  id: "game:blocking",
  priority: 10,
  applies: ({ kind }) => kind === "melee" && controls.blocking,
  modify: ({ amount }) => amount * 0.35,
});

player.addModifier(armorDamageModifier({
  points: () => equipment.armorPoints,
  bypassKinds: new Set(["void"]),
}));

const result = player.damage({ amount: 12, kind: "melee", source: attacker });
```

Modifiers run by priority and stable ID. They can reduce, increase, or cancel a
hit. The result records requested/applied damage, health before and after,
cancellation reason, source, and whether the hit killed the target. Damage and
death events are separate, so drops, particles, sounds, achievements, network
replication, and UI remain clean adapters.

`StatusEffectSet` owns simulation-clock durations and periodic ticks. It exposes
Map-like `has`, `get`, `keys`, and `entries` reads for gameplay and UI while
requiring updates through its observable API.

```ts
const effects = new StatusEffectSet([
  { id: "poison", tickInterval: 2 },
  { id: "regeneration", tickInterval: 1 },
]);

effects.subscribe((event) => {
  if (event.type === "tick" && event.effect.id === "poison")
    player.damage({ amount: 1, kind: "poison" });
});

effects.set("poison", 30);
effects.update(fixedDeltaSeconds);
```

Large frame deltas catch up all ticks that occurred before expiration. Applying
an existing effect refreshes it; clearing, removal, refresh, tick, and expiry
all produce explicit events.

CubeGame's player now uses both APIs, and every locally spawned mob exposes its
legacy health fields as accessors over a Vapour `Combatant`. Vapour owns health/death transition,
modifier ordering, armor equation, effect duration, periodic tick scheduling,
and expiry. CubeGame retains armor item scoring, blocking controls, hardcore
world deletion, sound/particle choices, drops, and death-screen presentation.
