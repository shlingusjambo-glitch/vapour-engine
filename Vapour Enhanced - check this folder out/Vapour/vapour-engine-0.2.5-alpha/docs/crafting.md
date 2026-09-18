# Crafting recipes

`CraftingRegistry<TId, TOutput>` owns shaped and shapeless recipe matching while
letting each game define its own item identifiers, tags, recipe catalog, and
output data.

```ts
const recipes = new CraftingRegistry<string, { id: string; count: number }>();

recipes.register({
  id: "tools/axe",
  pattern: [["plank", "plank"], ["plank", "stick"], [null, "stick"]],
  output: { id: "axe", count: 1 },
});

recipes.register({
  id: "dyes/purple",
  pattern: [["red-dye", ["blue-dye", "lapis"]]],
  output: { id: "purple-dye", count: 2 },
  shapeless: true,
});
```

Ingredients can be one item ID, an array of interchangeable IDs, or `null`.
Shaped recipes can match at any valid grid offset and reject unexpected items
outside the pattern. Shapeless matching uses backtracking, so overlapping tags
cannot greedily consume an item required by a more restrictive ingredient.

`match()` returns the recipe, cloned output, offsets, and exact consumed slots.
`craft()` additionally returns a copied grid with one item removed from each
matched slot. It never mutates the caller's grid. UI can therefore check output
capacity first and commit the returned grid as one operation.

`planFromCounts()` performs the equivalent allocation against aggregate player
inventory counts without expanding large stacks into individual objects. This
supports recipe books, crafting availability, server validation, and automated
crafters with the same matching semantics.

CubeGame registers its existing recipe catalog with this API. Both its 2×2 and
3×3 crafting screens now use Vapour's exact consumption plan; the duplicated
UI-side ingredient-decrement loops have been removed.
