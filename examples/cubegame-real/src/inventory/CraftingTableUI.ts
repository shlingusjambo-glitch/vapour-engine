import { EventBus } from '../core/EventBus';
import { Inventory, ItemStack } from './Inventory';
import { CraftingSystem } from './CraftingSystem';
import { ItemRegistry } from '../items/ItemRegistry';
import { InputManager } from '../core/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { TextureGenerator } from '../graphics/TextureGenerator';
import { RecipeBookUI } from './RecipeBookUI';

/**
 * 3×3 crafting grid UI — opened when the player right-clicks a Crafting Table block.
 */
export class CraftingTableUI {
  private inventory: Inventory;
  private screen: HTMLElement;
  private craftGrid: HTMLElement;
  private resultSlot: HTMLElement;
  private invGrid: HTMLElement;
  private hotbarGrid: HTMLElement;

  private craftingSlots: Array<ItemStack | null> = new Array(9).fill(null);
  private draggedStack: ItemStack | null = null;
  private draggedEl: HTMLElement;
  private draggedImg: HTMLImageElement;
  private draggedCount: HTMLElement;
  private recipeBook: RecipeBookUI;

  constructor(inventory: Inventory) {
    this.inventory = inventory;

    this.screen     = document.getElementById('crafting-table-screen')!;
    this.craftGrid  = document.getElementById('ct-crafting-grid')!;
    this.resultSlot = document.getElementById('ct-result-slot')!;
    this.invGrid    = document.getElementById('ct-inv-grid')!;
    this.hotbarGrid = document.getElementById('ct-hotbar-grid')!;

    this.draggedEl    = document.getElementById('dragged-item')!;
    this.draggedImg   = document.getElementById('dragged-item-img') as HTMLImageElement;
    this.draggedCount = document.getElementById('dragged-item-count')!;

    this.initDOM();
    this.recipeBook = new RecipeBookUI(this.screen.querySelector('.inventory-container') as HTMLElement, this.inventory, {
      gridSize: 3,
      title: 'Recipe Book',
      getExtraStacks: () => this.craftingSlots,
    });
    this.bindEvents();

    EventBus.on('ui:openCraftingTable', () => this.open());
    EventBus.on('inventory:updated', () => { if (this.isOpen()) this.draw(); });

    window.addEventListener('mousemove', (e) => {
      if (this.draggedStack) {
        this.draggedEl.style.left = `${e.clientX - 22}px`;
        this.draggedEl.style.top  = `${e.clientY - 22}px`;
      }
    });
  }

  private initDOM(): void {
    // 3×3 crafting grid
    this.craftGrid.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      this.craftGrid.appendChild(this.makeSlot(i, 'ct-crafting'));
    }

    // Player inventory (indices 9-35)
    this.invGrid.innerHTML = '';
    for (let i = 9; i < 36; i++) {
      this.invGrid.appendChild(this.makeSlot(i, 'ct-inventory'));
    }

    // Hotbar (indices 0-8)
    this.hotbarGrid.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      this.hotbarGrid.appendChild(this.makeSlot(i, 'ct-inventory'));
    }
  }

  private makeSlot(index: number, type: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.index = index.toString();
    el.dataset.type  = type;
    return el;
  }

  private bindEvents(): void {
    document.addEventListener('mousedown', (e) => {
      if (!this.isOpen()) return;
      const target = e.target as HTMLElement;
      const slot = target.closest('.slot') as HTMLElement | null;
      if (!slot) return;
      e.preventDefault();

      const type = slot.dataset.type!;
      const idx  = parseInt(slot.dataset.index || '-1');
      const isRight = e.button === 2;

      if (type === 'ct-inventory') {
        this.handleInvClick(idx, isRight, e.shiftKey);
      } else if (type === 'ct-crafting') {
        this.handleCraftClick(idx, isRight);
      } else if (slot.id === 'ct-result-slot') {
        this.handleResultClick();
      }
    });

    // Close on Escape or E
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'e' || e.key === 'E' || e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    const closeBtn = document.getElementById('ct-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    window.addEventListener('contextmenu', (e) => {
      if (this.isOpen() && e.target instanceof HTMLElement && e.target.closest('.slot')) {
        e.preventDefault();
      }
    });
  }

  public isOpen(): boolean {
    return this.screen.style.display === 'flex';
  }

  public open(): void {
    this.screen.style.display = 'flex';
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
    this.draw();
  }

  public close(): void {
    // Return crafting items to inventory
    for (let i = 0; i < 9; i++) {
      const s = this.craftingSlots[i];
      if (s) { this.inventory.addItem(s.id, s.count); this.craftingSlots[i] = null; }
    }
    // Return dragged item
    if (this.draggedStack) {
      this.inventory.addItem(this.draggedStack.id, this.draggedStack.count);
      this.draggedStack = null;
      this.draggedEl.style.display = 'none';
    }
    this.screen.style.display = 'none';
    InputManager.isUIActive = false;
    InputManager.lockPointer();
  }

  private draw(): void {
    // Crafting slots
    this.craftGrid.querySelectorAll<HTMLElement>('.slot[data-type="ct-crafting"]').forEach(el => {
      const i = parseInt(el.dataset.index!);
      this.renderSlot(el, this.craftingSlots[i]);
    });

    // Inventory + hotbar slots
    document.querySelectorAll<HTMLElement>('.slot[data-type="ct-inventory"]').forEach(el => {
      const i = parseInt(el.dataset.index!);
      this.renderSlot(el, this.inventory.getSlot(i));
    });

    // Crafting result
    const gridIds = this.craftingSlots.map(s => s?.id ?? null);
    const result = CraftingSystem.checkRecipe(gridIds);
    this.renderSlot(this.resultSlot, result);

    if (this.draggedStack) {
      this.draggedEl.style.display = 'flex';
      this.draggedImg.src = TextureGenerator.getItemIconDataURL(this.draggedStack.id);
      this.draggedImg.style.imageRendering = 'pixelated';
      this.draggedCount.textContent = this.draggedStack.count > 1 ? this.draggedStack.count.toString() : '';
    } else {
      this.draggedEl.style.display = 'none';
    }

    this.recipeBook.draw();
  }

  private renderSlot(el: HTMLElement, stack: ItemStack | { id: number; count: number } | null): void {
    el.innerHTML = '';
    if (!stack || stack.count <= 0) return;
    const img = document.createElement('img');
    img.className = 'item-icon';
    img.style.cssText = 'width:38px;height:38px;image-rendering:pixelated;';
    img.src = TextureGenerator.getItemIconDataURL(stack.id);
    el.appendChild(img);
    if (stack.count > 1) {
      const cnt = document.createElement('span');
      cnt.className = 'item-count';
      cnt.textContent = stack.count.toString();
      el.appendChild(cnt);
    }
  }

  private handleInvClick(index: number, isRight: boolean, isShift: boolean): void {
    const slotStack = this.inventory.getSlot(index);

    if (isShift && !this.draggedStack && slotStack) {
      // Move to crafting grid first empty slot
      for (let i = 0; i < 9; i++) {
        if (!this.craftingSlots[i]) {
          this.craftingSlots[i] = { ...slotStack };
          this.inventory.setSlot(index, null);
          break;
        }
      }
      this.draw();
      return;
    }

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half };
        this.inventory.removeItemFromSlot(index, half);
      } else {
        this.draggedStack = { ...slotStack };
        this.inventory.setSlot(index, null);
      }
    } else {
      if (!slotStack) {
        if (isRight) {
          this.inventory.setSlot(index, { id: this.draggedStack.id, count: 1 });
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.inventory.setSlot(index, this.draggedStack);
          this.draggedStack = null;
        }
      } else if (slotStack.id === this.draggedStack.id) {
        const max = this.inventory.getMaxStackSize(slotStack.id);
        const space = max - slotStack.count;
        const xfer = Math.min(space, this.draggedStack.count);
        slotStack.count += xfer;
        this.draggedStack.count -= xfer;
        if (this.draggedStack.count <= 0) this.draggedStack = null;
        this.inventory.saveToStorage();
      } else if (!isRight) {
        const temp = { ...slotStack };
        this.inventory.setSlot(index, this.draggedStack);
        this.draggedStack = temp;
      }
    }
    this.draw();
  }

  private handleCraftClick(index: number, isRight: boolean): void {
    const slotStack = this.craftingSlots[index];

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half };
        slotStack.count -= half;
        if (slotStack.count <= 0) this.craftingSlots[index] = null;
      } else {
        this.draggedStack = { ...slotStack };
        this.craftingSlots[index] = null;
      }
    } else {
      if (!slotStack) {
        if (isRight) {
          this.craftingSlots[index] = { id: this.draggedStack.id, count: 1 };
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.craftingSlots[index] = this.draggedStack;
          this.draggedStack = null;
        }
      } else if (slotStack.id === this.draggedStack.id) {
        const max = this.inventory.getMaxStackSize(slotStack.id);
        const space = max - slotStack.count;
        const xfer = Math.min(space, this.draggedStack.count);
        slotStack.count += xfer;
        this.draggedStack.count -= xfer;
        if (this.draggedStack.count <= 0) this.draggedStack = null;
      } else if (!isRight) {
        const temp = { ...slotStack };
        this.craftingSlots[index] = this.draggedStack;
        this.draggedStack = temp;
      }
    }
    this.draw();
  }

  private handleResultClick(): void {
    const crafted = CraftingSystem.craft(this.craftingSlots);
    if (!crafted) return;
    const result = crafted.output;

    if (!this.draggedStack) {
      this.draggedStack = { ...result };
    } else if (this.draggedStack.id === result.id && this.draggedStack.count + result.count <= this.inventory.getMaxStackSize(result.id)) {
      this.draggedStack.count += result.count;
    } else return;
    this.craftingSlots = crafted.grid.map((stack) => stack ? { ...stack } : null);
    AudioManager.playItemPickup();
    this.draw();
  }
}
