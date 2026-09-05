import { BlockRegistry } from '../world/BlockRegistry';
import { ItemRegistry } from '../items/ItemRegistry';
import { TextureGenerator } from '../graphics/TextureGenerator';
import { Inventory, ItemStack } from './Inventory';
import { CraftingRecipe, CraftingSystem, RecipeIngredient } from './CraftingSystem';

interface RecipeEntry {
  id: number;
  name: string;
  recipe: CraftingRecipe | null;
  craftable: boolean;
  fitsGrid: boolean;
}

interface RecipeBookOptions {
  gridSize: 2 | 3;
  title: string;
  getExtraStacks?: () => Array<ItemStack | null>;
}

export class RecipeBookUI {
  private root: HTMLElement;
  private listEl: HTMLElement;
  private detailEl: HTMLElement;
  private modeBtn: HTMLButtonElement;
  private showAll = false;
  private selectedId: number | null = null;

  constructor(
    host: HTMLElement,
    private inventory: Inventory,
    private options: RecipeBookOptions
  ) {
    this.root = document.createElement('div');
    this.root.className = 'recipe-book-panel';

    const header = document.createElement('div');
    header.className = 'recipe-book-header';

    const title = document.createElement('div');
    title.className = 'recipe-book-title';
    title.textContent = options.title;

    this.modeBtn = document.createElement('button');
    this.modeBtn.className = 'recipe-book-toggle';
    this.modeBtn.type = 'button';
    this.modeBtn.textContent = 'All Items';
    this.modeBtn.addEventListener('click', () => {
      this.showAll = !this.showAll;
      this.modeBtn.classList.toggle('active', this.showAll);
      this.draw();
    });

    header.appendChild(title);
    header.appendChild(this.modeBtn);
    this.root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'recipe-book-body';

    this.listEl = document.createElement('div');
    this.listEl.className = 'recipe-book-list';

    this.detailEl = document.createElement('div');
    this.detailEl.className = 'recipe-book-detail';

    body.appendChild(this.listEl);
    body.appendChild(this.detailEl);
    this.root.appendChild(body);
    host.appendChild(this.root);
  }

  public draw(): void {
    const entries = this.buildEntries();
    if (entries.length > 0 && !entries.some(entry => entry.id === this.selectedId)) {
      this.selectedId = entries[0].id;
    }

    this.renderList(entries);
    this.renderDetail(entries.find(entry => entry.id === this.selectedId) ?? entries[0] ?? null);
  }

  private buildEntries(): RecipeEntry[] {
    const counts = this.getInventoryCounts();
    const recipes = CraftingSystem.getRecipes();
    const recipeByOutput = new Map<number, RecipeEntry>();

    for (const recipe of recipes) {
      const id = recipe.output.id;
      const fitsGrid = CraftingSystem.recipeFitsGrid(recipe, this.options.gridSize);
      const craftable = CraftingSystem.canCraftFromCounts(recipe, counts, this.options.gridSize);
      const entry: RecipeEntry = {
        id,
        name: this.getName(id),
        recipe,
        craftable,
        fitsGrid,
      };

      const prev = recipeByOutput.get(id);
      if (
        !prev ||
        (entry.craftable && !prev.craftable) ||
        (entry.fitsGrid && !prev.fitsGrid)
      ) {
        recipeByOutput.set(id, entry);
      }
    }

    if (!this.showAll) {
      return Array.from(recipeByOutput.values())
        .filter(entry => entry.craftable)
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    const allIds = new Set<number>();
    for (const block of BlockRegistry.getAll()) {
      if (block.id > 0) allIds.add(block.id);
    }
    for (const item of ItemRegistry.getAll()) {
      if (item.id > 0) allIds.add(item.id);
    }

    return Array.from(allIds)
      .map((id) => {
        const recipeEntry = recipeByOutput.get(id);
        return recipeEntry ?? {
          id,
          name: this.getName(id),
          recipe: null,
          craftable: false,
          fitsGrid: false,
        };
      })
      .sort((a, b) => {
        if (a.craftable !== b.craftable) return a.craftable ? -1 : 1;
        if (!!a.recipe !== !!b.recipe) return a.recipe ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }

  private renderList(entries: RecipeEntry[]): void {
    this.listEl.innerHTML = '';
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'recipe-book-empty';
      empty.textContent = 'No craftable recipes';
      this.listEl.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const button = document.createElement('button');
      button.className = 'recipe-book-entry';
      button.type = 'button';
      button.classList.toggle('selected', entry.id === this.selectedId);
      button.classList.toggle('craftable', entry.craftable);
      button.classList.toggle('locked', !entry.recipe || !entry.fitsGrid);
      button.title = entry.name;

      const img = document.createElement('img');
      img.className = 'recipe-book-icon';
      img.src = TextureGenerator.getItemIconDataURL(entry.id);
      img.alt = '';

      const label = document.createElement('span');
      label.textContent = entry.name;

      button.appendChild(img);
      button.appendChild(label);
      button.addEventListener('click', () => {
        this.selectedId = entry.id;
        this.draw();
      });
      this.listEl.appendChild(button);
    }
  }

  private renderDetail(entry: RecipeEntry | null): void {
    this.detailEl.innerHTML = '';
    if (!entry) {
      const empty = document.createElement('div');
      empty.className = 'recipe-book-empty';
      empty.textContent = 'Pick up materials to unlock recipes';
      this.detailEl.appendChild(empty);
      return;
    }

    const output = document.createElement('div');
    output.className = 'recipe-book-output';

    const img = document.createElement('img');
    img.className = 'recipe-book-output-icon';
    img.src = TextureGenerator.getItemIconDataURL(entry.id);
    img.alt = '';

    const name = document.createElement('div');
    name.className = 'recipe-book-output-name';
    name.textContent = entry.name;

    output.appendChild(img);
    output.appendChild(name);
    this.detailEl.appendChild(output);

    if (!entry.recipe) {
      const note = document.createElement('div');
      note.className = 'recipe-book-note';
      note.textContent = this.getItemInfo(entry.id);
      this.detailEl.appendChild(note);
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'recipe-book-grid';
    const cells = this.recipeCells(entry.recipe);
    for (const ingredient of cells) {
      const cell = document.createElement('div');
      cell.className = 'recipe-book-cell';
      const id = CraftingSystem.getDisplayIngredientId(ingredient);
      if (id) {
        const icon = document.createElement('img');
        icon.className = 'recipe-book-cell-icon';
        icon.src = TextureGenerator.getItemIconDataURL(id);
        icon.alt = '';
        icon.title = CraftingSystem.getIngredientLabel(ingredient);
        cell.appendChild(icon);
        if (Array.isArray(ingredient)) {
          const tag = document.createElement('span');
          tag.className = 'recipe-book-any-tag';
          tag.textContent = 'ANY';
          cell.appendChild(tag);
        }
      }
      grid.appendChild(cell);
    }
    this.detailEl.appendChild(grid);

    const counts = CraftingSystem.getIngredientCounts(entry.recipe);
    const ingredients = document.createElement('div');
    ingredients.className = 'recipe-book-ingredients';
    for (const [ingredient, count] of counts) {
      const line = document.createElement('div');
      line.textContent = `${count}x ${CraftingSystem.getIngredientLabel(ingredient)}`;
      ingredients.appendChild(line);
    }
    this.detailEl.appendChild(ingredients);

    const note = document.createElement('div');
    note.className = 'recipe-book-note';
    if (entry.craftable) {
      note.textContent = 'Craftable with current inventory';
    } else if (!entry.fitsGrid) {
      note.textContent = 'Crafting table required';
    } else {
      note.textContent = 'Missing ingredients';
    }
    this.detailEl.appendChild(note);
  }

  private recipeCells(recipe: CraftingRecipe): Array<RecipeIngredient> {
    const cells = new Array<RecipeIngredient>(9).fill(null);
    if (recipe.shapeless) {
      const ids = recipe.pattern.flat().filter((id): id is Exclude<RecipeIngredient, null> => !!id);
      ids.slice(0, 9).forEach((id, i) => { cells[i] = id; });
      return cells;
    }

    for (let row = 0; row < recipe.pattern.length; row++) {
      for (let col = 0; col < recipe.pattern[row].length; col++) {
        if (row < 3 && col < 3) cells[row * 3 + col] = recipe.pattern[row][col] ?? null;
      }
    }
    return cells;
  }

  private getInventoryCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    const add = (stack: ItemStack | null) => {
      if (!stack || stack.count <= 0) return;
      counts.set(stack.id, (counts.get(stack.id) ?? 0) + stack.count);
    };

    for (let i = 0; i < 37; i++) add(this.inventory.getSlot(i));
    if (this.options.getExtraStacks) {
      for (const stack of this.options.getExtraStacks()) add(stack);
    }
    return counts;
  }

  private getName(id: number): string {
    const item = ItemRegistry.get(id);
    if (item) return item.name;
    if (BlockRegistry.has(id)) return BlockRegistry.get(id).name;
    return `Item #${id}`;
  }

  private getItemInfo(id: number): string {
    const item = ItemRegistry.get(id);
    if (item) {
      const type = item.toolType === 'none' ? 'item' : item.toolType;
      return `${type}; stacks to ${item.maxStack}`;
    }
    const block = BlockRegistry.has(id) ? BlockRegistry.get(id) : null;
    if (block) {
      return `${block.isSolid ? 'solid block' : 'non-solid block'}; ${block.stepSound} sound`;
    }
    return 'No item data';
  }
}
