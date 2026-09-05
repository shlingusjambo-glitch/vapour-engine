# Saves and persistence

`SaveDatabase<Store>` is Vapour's versioned IndexedDB service. It creates named
stores during schema upgrades and provides typed `put`, `get`, `delete`, `keys`,
`values`, `clear`, `clearAll`, and namespace-prefix deletion operations.

```ts
const saves = new SaveDatabase({
  name: "MyGame",
  version: 2,
  stores: ["worlds", "chunks", "inventory"] as const,
  diagnostic: (message, error) => console.warn(message, error),
});
await saves.open();
await saves.put("chunks", `${worldId}::4,0,-2`, changedBlocks);
```

Every write reaches a session-memory mirror first. Missing IndexedDB support,
blocked upgrades, open timeouts, or transaction failures therefore do not stop
the game or lose subsequent writes within the current session. A diagnostic is
reported once per failure class instead of errors being silently ignored.

World-scoped keys should use a stable prefix. `deletePrefix` deletes one world
without scanning or interpreting another world's values. Version numbers belong
to the database schema; individual structured save payloads should also carry
their own format version when they need migrations.

CubeGame's worlds, chunk diffs (including blocks changed to air), inventories,
settings, chests, and machine state now pass through this service. Its
`StorageManager` is a compatibility facade containing only game namespaces and
validation rules rather than raw IndexedDB transactions.
