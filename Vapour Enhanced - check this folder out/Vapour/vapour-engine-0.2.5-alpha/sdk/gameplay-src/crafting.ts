export type CraftingIngredient<TId> = TId | readonly TId[] | null;

export interface CraftingRecipe<TId, TOutput> {
  readonly id: string;
  readonly pattern: readonly (readonly CraftingIngredient<TId>[])[];
  readonly output: TOutput;
  readonly shapeless?: boolean;
}

export interface CraftingGridStack<TId> {
  readonly id: TId;
  readonly count: number;
}

export interface CraftingMatch<TId, TOutput> {
  readonly recipe: CraftingRecipe<TId, TOutput>;
  readonly output: TOutput;
  readonly consumedSlots: readonly number[];
  readonly rowOffset: number;
  readonly columnOffset: number;
}

export interface CraftingResult<TId, TOutput, TStack extends CraftingGridStack<TId>> extends CraftingMatch<TId, TOutput> {
  readonly grid: readonly (TStack | null)[];
}

/** Renderer-independent shaped and shapeless recipe matcher. Recipes are data;
 * games retain their item catalog while Vapour owns matching and consumption. */
export class CraftingRegistry<TId, TOutput> {
  readonly #recipes: CraftingRecipe<TId, TOutput>[] = [];
  readonly #ids = new Set<string>();
  readonly #equals: (a: TId, b: TId) => boolean;
  readonly #cloneOutput: (output: TOutput) => TOutput;

  constructor(options: { equals?: (a: TId, b: TId) => boolean; cloneOutput?: (output: TOutput) => TOutput } = {}) {
    this.#equals = options.equals ?? Object.is;
    this.#cloneOutput = options.cloneOutput ?? ((output) => structuredClone(output));
  }

  register(recipe: CraftingRecipe<TId, TOutput>): void {
    const id = recipe.id.trim();
    if (!id) throw new Error("Crafting recipe ID must not be empty.");
    if (this.#ids.has(id)) throw new Error(`Crafting recipe ID '${id}' is already registered.`);
    if (recipe.pattern.length === 0) throw new Error(`Crafting recipe '${id}' has an empty pattern.`);
    const width = Math.max(...recipe.pattern.map((row) => row.length));
    if (width === 0) throw new Error(`Crafting recipe '${id}' has an empty pattern.`);
    const pattern = recipe.pattern.map((row) => Object.freeze([...row]));
    if (!pattern.some((row) => row.some((ingredient) => this.#options(ingredient).length > 0))) {
      throw new Error(`Crafting recipe '${id}' has no ingredients.`);
    }
    const stored = Object.freeze({ id, pattern: Object.freeze(pattern), output: this.#cloneOutput(recipe.output), shapeless: recipe.shapeless === true });
    this.#recipes.push(stored);
    this.#ids.add(id);
  }

  get recipes(): readonly CraftingRecipe<TId, TOutput>[] {
    return Object.freeze(this.#recipes.map((recipe) => this.#cloneRecipe(recipe)));
  }

  fits(recipe: CraftingRecipe<TId, TOutput>, width: number, height: number): boolean {
    this.#validateDimensions(width, height);
    const ingredients = recipe.pattern.flat().filter((ingredient) => this.#options(ingredient).length > 0);
    if (recipe.shapeless) return ingredients.length <= width * height;
    return recipe.pattern.length <= height && Math.max(...recipe.pattern.map((row) => row.length)) <= width;
  }

  match(grid: readonly (TId | null)[], width: number, height: number): CraftingMatch<TId, TOutput> | null {
    this.#validateGrid(grid, width, height);
    for (const recipe of this.#recipes) {
      if (!this.fits(recipe, width, height)) continue;
      const match = recipe.shapeless
        ? this.#matchShapeless(recipe, grid)
        : this.#matchShaped(recipe, grid, width, height);
      if (match) return match;
    }
    return null;
  }

  /** Matches and consumes one item from every required grid slot, returning a
   * new grid. Neither the input grid nor its stack objects are mutated. */
  craft<TStack extends CraftingGridStack<TId>>(
    grid: readonly (TStack | null)[], width: number, height: number,
    cloneStack: (stack: Readonly<TStack>) => TStack = (stack) => ({ ...stack }) as TStack,
  ): CraftingResult<TId, TOutput, TStack> | null {
    const match = this.match(grid.map((stack) => stack?.id ?? null), width, height);
    if (!match) return null;
    const next = grid.map((stack) => stack ? cloneStack(stack) : null);
    for (const slot of match.consumedSlots) {
      const stack = next[slot];
      if (!stack || stack.count <= 0) throw new Error(`Crafting grid slot ${slot} has an invalid stack count.`);
      (stack as { count: number }).count--;
      if (stack.count === 0) next[slot] = null;
    }
    return Object.freeze({ ...match, output: this.#cloneOutput(match.output), grid: Object.freeze(next) });
  }

  /** Finds an exact ingredient allocation without greedily double-spending IDs
   * shared by tags. Returns null when the available counts cannot satisfy it. */
  planFromCounts(recipe: CraftingRecipe<TId, TOutput>, counts: ReadonlyMap<TId, number>): ReadonlyMap<TId, number> | null {
    const ingredients = recipe.pattern.flat().filter((ingredient) => this.#options(ingredient).length > 0);
    const available: Array<{ id: TId; count: number; used: number }> = [];
    for (const [id, count] of counts) {
      if (!Number.isFinite(count) || count < 0) throw new Error("Crafting item counts must be finite and non-negative.");
      if (count >= 1) available.push({ id, count: Math.floor(count), used: 0 });
    }
    const ordered = [...ingredients].sort((a, b) => this.#options(a).length - this.#options(b).length);
    const search = (depth: number): boolean => {
      if (depth === ordered.length) return true;
      const ingredient = ordered[depth]!;
      for (const entry of available) {
        if (entry.used >= entry.count || !this.#matches(ingredient, entry.id)) continue;
        entry.used++;
        if (search(depth + 1)) return true;
        entry.used--;
      }
      return false;
    };
    if (!search(0)) return null;
    return new Map(available.filter((entry) => entry.used > 0).map((entry) => [entry.id, entry.used]));
  }

  #matchShapeless(recipe: CraftingRecipe<TId, TOutput>, grid: readonly (TId | null)[]): CraftingMatch<TId, TOutput> | null {
    const ingredients = recipe.pattern.flat().filter((ingredient) => this.#options(ingredient).length > 0);
    const available: TId[] = [];
    const slots: number[] = [];
    for (let slot = 0; slot < grid.length; slot++) {
      const id = grid[slot];
      if (id === null || id === undefined) continue;
      available.push(id);
      slots.push(slot);
    }
    if (ingredients.length !== available.length) return null;
    const assignment = this.#assign(ingredients, available);
    if (!assignment) return null;
    return this.#makeMatch(recipe, assignment.map((index) => slots[index]!), 0, 0);
  }

  #matchShaped(recipe: CraftingRecipe<TId, TOutput>, grid: readonly (TId | null)[], width: number, height: number): CraftingMatch<TId, TOutput> | null {
    const patternWidth = Math.max(...recipe.pattern.map((row) => row.length));
    for (let rowOffset = 0; rowOffset <= height - recipe.pattern.length; rowOffset++) {
      for (let columnOffset = 0; columnOffset <= width - patternWidth; columnOffset++) {
        const consumed: number[] = [];
        let matches = true;
        for (let row = 0; row < height && matches; row++) {
          for (let column = 0; column < width; column++) {
            const patternRow = row - rowOffset;
            const patternColumn = column - columnOffset;
            const ingredient = patternRow >= 0 && patternRow < recipe.pattern.length
              ? recipe.pattern[patternRow]?.[patternColumn] ?? null : null;
            const actual = grid[row * width + column] ?? null;
            if (!this.#matches(ingredient, actual)) { matches = false; break; }
            if (this.#options(ingredient).length > 0) consumed.push(row * width + column);
          }
        }
        if (matches) return this.#makeMatch(recipe, consumed, rowOffset, columnOffset);
      }
    }
    return null;
  }

  #assign(ingredients: readonly CraftingIngredient<TId>[], available: readonly TId[]): number[] | null {
    const ordered = ingredients.map((ingredient, index) => ({ ingredient, index }))
      .sort((a, b) => this.#options(a.ingredient).length - this.#options(b.ingredient).length);
    const result = new Array<number>(ingredients.length);
    const used = new Array<boolean>(available.length).fill(false);
    const search = (depth: number): boolean => {
      if (depth === ordered.length) return true;
      const entry = ordered[depth]!;
      for (let index = 0; index < available.length; index++) {
        if (used[index] || !this.#matches(entry.ingredient, available[index]!)) continue;
        used[index] = true;
        result[entry.index] = index;
        if (search(depth + 1)) return true;
        used[index] = false;
      }
      return false;
    };
    return search(0) ? result : null;
  }

  #options(ingredient: CraftingIngredient<TId>): readonly TId[] {
    if (ingredient === null || ingredient === undefined) return [];
    return Array.isArray(ingredient) ? ingredient as readonly TId[] : [ingredient as TId];
  }

  #matches(ingredient: CraftingIngredient<TId>, actual: TId | null): boolean {
    const options = this.#options(ingredient);
    if (options.length === 0) return actual === null;
    return actual !== null && options.some((option) => this.#equals(option, actual));
  }

  #makeMatch(recipe: CraftingRecipe<TId, TOutput>, consumedSlots: number[], rowOffset: number, columnOffset: number): CraftingMatch<TId, TOutput> {
    return Object.freeze({ recipe: this.#cloneRecipe(recipe), output: this.#cloneOutput(recipe.output), consumedSlots: Object.freeze(consumedSlots), rowOffset, columnOffset });
  }

  #cloneRecipe(recipe: CraftingRecipe<TId, TOutput>): CraftingRecipe<TId, TOutput> {
    return { ...recipe, pattern: recipe.pattern.map((row) => [...row]), output: this.#cloneOutput(recipe.output) };
  }

  #validateDimensions(width: number, height: number): void {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error("Crafting grid dimensions must be positive integers.");
  }

  #validateGrid(grid: readonly unknown[], width: number, height: number): void {
    this.#validateDimensions(width, height);
    if (grid.length !== width * height) throw new Error(`Crafting grid has ${grid.length} cells; expected ${width * height}.`);
  }
}
