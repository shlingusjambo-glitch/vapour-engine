# Inventory containers

`InventoryContainer<TStack>` owns reusable slot and stack mechanics for player
inventories, chests, equipment, shops, crafting inputs, and machine storage. A
game supplies its item ID type and optional metadata on the stack.

```ts
interface Stack {
  id: string;
  count: number;
  durability?: number;
}

const inventory = new InventoryContainer<Stack>({
  slots: 40,
  maxStack: ({ id }) => itemCatalog.get(id).maxStack,
  canStack: (a, b) => a.id === b.id && a.durability === b.durability,
  accepts: (slot, stack) => slot < 36 || equipment.accepts(slot, stack.id),
});
```

The container provides metadata-aware stacking, overflow results, atomic
removal, slot/range queries, swaps, clearing, snapshot restoration, and batched
change notifications. Returned stacks and snapshots are defensive copies, so a
caller cannot mutate inventory state without producing a revision event.

Use ranges to keep automatic insertion out of armor, output, or reserved slots:

```ts
const leftover = inventory.add(drop, { start: 0, end: 36 });
const paid = inventory.remove("gold", 4, { start: 0, end: 36 });
```

`remove()` checks the total first and changes nothing when the complete amount
is unavailable. This makes purchases and crafting consumption safe without a
game-specific rollback path. Persistence and UI are deliberately adapters:
subscribe to revisions to save, animate changed slots, or replicate state.

CubeGame now uses this container for its 41-slot player inventory. Its local
class retains only item metadata rules, hotbar events, slot layout, and the save
namespace; allocation, stacking, removal, batching, and querying are Vapour
runtime behavior.
