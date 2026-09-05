import { EventBus } from '../core/EventBus';
import { Inventory, ItemStack } from './Inventory';
import { CraftingSystem } from './CraftingSystem';
import { BlockRegistry } from '../world/BlockRegistry';
import { ItemRegistry } from '../items/ItemRegistry';
import { InputManager } from '../core/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { TextureGenerator } from '../graphics/TextureGenerator';
import { RecipeBookUI } from './RecipeBookUI';

export class InventoryUI {
  private inventory: Inventory;

  private invScreen: HTMLElement;
  private inventoryGrid: HTMLElement;
  private hotbarMirror: HTMLElement;
  private craftingGrid: HTMLElement;   // 2x2 personal crafting
  private craftingResult: HTMLElement;
  private hudHotbar: HTMLElement;
  private tooltip: HTMLElement;

   private draggedStack: ItemStack | null = null;
  private draggedEl: HTMLElement;
  private draggedImg: HTMLImageElement;
  private draggedCount: HTMLElement;
  private activeItemNameTimeout: number | null = null;
  private recipeBook: RecipeBookUI;

  private hoveredSlotIdx: number | null = null;
  private hoveredSlotType: string | null = null;

  // Personal crafting: 4 slots (2×2)
  private craftingSlots: Array<ItemStack | null> = new Array(4).fill(null);

  constructor(inventory: Inventory) {
    this.inventory = inventory;

    this.invScreen     = document.getElementById('inventory-screen')!;
    this.inventoryGrid = document.getElementById('inventory-grid-3x9')!;
    this.hotbarMirror  = document.getElementById('inventory-hotbar-mirror')!;
    this.craftingGrid  = document.getElementById('crafting-grid')!;
    this.craftingResult= document.getElementById('crafting-result-slot')!;
    this.hudHotbar     = document.getElementById('hotbar')!;

    this.draggedEl    = document.getElementById('dragged-item')!;
    this.draggedImg   = document.getElementById('dragged-item-img') as HTMLImageElement;
    this.draggedCount = document.getElementById('dragged-item-count')!;

    // Create floating tooltip
    this.tooltip = document.createElement('div');
    this.tooltip.id = 'item-tooltip';
    this.tooltip.style.cssText = `
      position:fixed; z-index:300; pointer-events:none; display:none;
      background:rgba(20,8,30,0.92); border:1.5px solid #5a2d82;
      border-radius:6px; padding:8px 12px; font-family:'Share Tech Mono',monospace;
      font-size:13px; color:#fff; white-space:nowrap;
      box-shadow:0 4px 16px rgba(0,0,0,0.6);
    `;
    document.body.appendChild(this.tooltip);

    this.initDOM();
    this.recipeBook = new RecipeBookUI(this.invScreen.querySelector('#inventory-container') as HTMLElement, this.inventory, {
      gridSize: 2,
      title: 'Recipe Book',
      getExtraStacks: () => this.craftingSlots,
    });
    this.bindEvents();

    EventBus.on('inventory:updated', () => this.draw());
    EventBus.on('hotbar:changed', (idx: number) => this.updateHUDHotbarActive(idx));
    window.addEventListener('mousemove', (e) => this.updateDraggedPosition(e));
  }

  private initDOM(): void {
    // 1. Main inventory (3×9 = 27 slots, indices 9-35)
    this.inventoryGrid.innerHTML = '';
    for (let i = 9; i < 36; i++) {
      this.inventoryGrid.appendChild(this.makeSlot(i, 'inventory'));
    }

    // 2. Hotbar mirror (indices 0-8)
    this.hotbarMirror.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      this.hotbarMirror.appendChild(this.makeSlot(i, 'inventory'));
    }

    // 3. HUD hotbar (indices 0-8)
    this.hudHotbar.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const s = this.makeSlot(i, 'hud');
      if (i === 0) s.classList.add('active');
      this.hudHotbar.appendChild(s);
    }

    // 4. Personal crafting 2×2 (4 slots)
    this.craftingGrid.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      this.craftingGrid.appendChild(this.makeSlot(i, 'crafting'));
    }

    // Add tooltip events to pre-existing HTML slots (off-hand and armor slots)
    document.querySelectorAll<HTMLElement>('.slot[data-type="inventory"]').forEach(el => {
      const idx = parseInt(el.dataset.index || '-1');
      if (idx === 36 || idx >= 37) {
        const clone = el.cloneNode(true) as HTMLElement;
        el.parentNode?.replaceChild(clone, el);
        
        clone.addEventListener('mouseenter', (e) => {
          this.hoveredSlotIdx = idx;
          this.hoveredSlotType = 'inventory';
          this.showTooltip(e as MouseEvent, idx, 'inventory');
        });
        clone.addEventListener('mouseleave', () => {
          this.hoveredSlotIdx = null;
          this.hoveredSlotType = null;
          this.hideTooltip();
        });
        clone.addEventListener('mousemove', (e) => this.moveTooltip(e as MouseEvent));
      }
    });
  }

  private makeSlot(index: number, type: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.index = index.toString();
    el.dataset.type = type;

    // Tooltip events
    el.addEventListener('mouseenter', (e) => {
      this.hoveredSlotIdx = index;
      this.hoveredSlotType = type;
      this.showTooltip(e as MouseEvent, index, type);
    });
    el.addEventListener('mouseleave', () => {
      this.hoveredSlotIdx = null;
      this.hoveredSlotType = null;
      this.hideTooltip();
    });
    el.addEventListener('mousemove', (e) => this.moveTooltip(e as MouseEvent));
    return el;
  }

  private bindEvents(): void {
    EventBus.on('toggle:inventory', () => this.toggleInventory());

    document.addEventListener('mousedown', (e) => {
      const target = e.target as HTMLElement;
      const slot = target.closest('.slot') as HTMLElement | null;
      if (!slot) return;
      e.preventDefault();

      const type = slot.dataset.type;
      const idx  = parseInt(slot.dataset.index || '-1');
      const isRight = e.button === 2;
      const isShift = e.shiftKey;

      if (type === 'inventory') {
        if (isShift && !this.draggedStack) {
          this.shiftClickInventory(idx);
        } else {
          this.handleInventorySlotClick(idx, isRight);
        }
      } else if (type === 'crafting') {
        this.handleCraftingSlotClick(idx, isRight);
      } else if (slot.id === 'crafting-result-slot') {
        this.handleResultSlotClick();
      }
    });

    window.addEventListener('contextmenu', (e) => {
      if (e.target instanceof HTMLElement && e.target.closest('.slot')) {
        e.preventDefault();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'f' || e.key === 'F') {
        const isTyping = document.activeElement?.tagName === 'INPUT';
        if (!isTyping) {
          e.preventDefault();
          if (this.isOpen() && this.hoveredSlotIdx !== null && this.hoveredSlotType === 'inventory') {
            const activeIdx = this.hoveredSlotIdx;
            const activeStack = this.inventory.getSlot(activeIdx);
            const offhandStack = this.inventory.getSlot(36);
            this.inventory.setSlot(activeIdx, offhandStack);
            this.inventory.setSlot(36, activeStack);
            AudioManager.playItemPickup();
            this.draw();
          } else if (!this.isOpen() && !InputManager.isUIActive) {
            const activeIdx = this.inventory.getActiveSlotIndex();
            const activeStack = this.inventory.getSlot(activeIdx);
            const offhandStack = this.inventory.getSlot(36);
            this.inventory.setSlot(activeIdx, offhandStack);
            this.inventory.setSlot(36, activeStack);
            AudioManager.playItemPickup();
            this.draw();
          }
        }
      }
    });
  }

  // ── Shift-click: auto-move between hotbar (0-8) and inventory (9-35) ──

  private shiftClickInventory(index: number): void {
    const stack = this.inventory.getSlot(index);
    if (!stack) return;

    if (index === 36) {
      let moved = false;
      for (let i = 0; i < 9; i++) {
        if (!this.inventory.getSlot(i)) {
          this.inventory.setSlot(i, { ...stack });
          this.inventory.setSlot(36, null);
          moved = true;
          break;
        }
      }
      if (!moved) {
        for (let i = 9; i < 36; i++) {
          if (!this.inventory.getSlot(i)) {
            this.inventory.setSlot(i, { ...stack });
            this.inventory.setSlot(36, null);
            break;
          }
        }
      }
    } else if (index >= 37 && index <= 40) {
      // Move from armor slot to inventory/hotbar
      for (let i = 0; i < 36; i++) {
        if (!this.inventory.getSlot(i)) {
          this.inventory.setSlot(i, { ...stack });
          this.inventory.setSlot(index, null);
          AudioManager.playItemPickup();
          this.draw();
          return;
        }
      }
    } else if (index < 36) {
      // If it's armor, move to correct armor slot if empty!
      const itemDef = ItemRegistry.get(stack.id);
      if (itemDef && itemDef.toolType === 'armor') {
        let targetSlot = -1;
        if (itemDef.name.endsWith('Helmet')) targetSlot = 37;
        else if (itemDef.name.endsWith('Chestplate')) targetSlot = 38;
        else if (itemDef.name.endsWith('Leggings')) targetSlot = 39;
        else if (itemDef.name.endsWith('Boots')) targetSlot = 40;

        if (targetSlot !== -1 && !this.inventory.getSlot(targetSlot)) {
          this.inventory.setSlot(targetSlot, { ...stack });
          this.inventory.setSlot(index, null);
          AudioManager.playItemPickup();
          this.draw();
          return;
        }
      }

      // Default shift click behavior
      if (index < 9) {
        // Move from hotbar to main inventory
        for (let i = 9; i < 36; i++) {
          if (!this.inventory.getSlot(i)) {
            this.inventory.setSlot(i, { ...stack });
            this.inventory.setSlot(index, null);
            break;
          }
        }
      } else {
        // Move from main inventory to hotbar
        for (let i = 0; i < 9; i++) {
          if (!this.inventory.getSlot(i)) {
            this.inventory.setSlot(i, { ...stack });
            this.inventory.setSlot(index, null);
            break;
          }
        }
      }
    }
    AudioManager.playItemPickup();
    this.draw();
  }

  // ── Tooltip ─────────────────────────────────────────────────────────────

  private showTooltip(e: MouseEvent, index: number, type: string): void {
    let stack: ItemStack | null = null;
    if (type === 'inventory') stack = this.inventory.getSlot(index);
    else if (type === 'crafting') stack = this.craftingSlots[index];

    if (!stack || stack.count <= 0) { this.hideTooltip(); return; }

    const itemName = ItemRegistry.getName(stack.id) || BlockRegistry.get(stack.id)?.name || `Item #${stack.id}`;
    const isDurability = ItemRegistry.isTool(stack.id);

    this.tooltip.innerHTML = `<b>${itemName}</b>${stack.count > 1 ? `<span style="color:#aaa"> ×${stack.count}</span>` : ''}`;
    if (isDurability) {
      const def = ItemRegistry.get(stack.id);
      if (def && def.durability > 0) {
        const cur = stack.durability ?? def.durability;
        this.tooltip.innerHTML += `<br><span style="color:#88aaff; font-size:11px">Durability: ${cur} / ${def.durability}</span>`;
      }
    }
    this.tooltip.style.display = 'block';
    this.moveTooltip(e);
  }

  private hideTooltip(): void {
    this.tooltip.style.display = 'none';
  }

  private moveTooltip(e: MouseEvent): void {
    const x = e.clientX + 14;
    const y = e.clientY + 14;
    this.tooltip.style.left = `${x}px`;
    this.tooltip.style.top  = `${y}px`;
  }

  // ── Open / close ─────────────────────────────────────────────────────────

  public isOpen(): boolean {
    return this.invScreen.style.display === 'flex';
  }

  public toggleInventory(): void {
    if (this.isOpen()) {
      this.invScreen.style.display = 'none';
      this.invScreen.classList.remove('inv-open');
      InputManager.isUIActive = false;
      InputManager.lockPointer();

      // Return crafting grid items to inventory
      for (let i = 0; i < 4; i++) {
        const stack = this.craftingSlots[i];
        if (stack) {
          this.inventory.addItem(stack.id, stack.count);
          this.craftingSlots[i] = null;
        }
      }
      this.updateCraftingRecipe();
      this.draw();
    } else {
      this.invScreen.style.display = 'flex';
      // Trigger slide-in animation
      requestAnimationFrame(() => this.invScreen.classList.add('inv-open'));
      InputManager.isUIActive = true;
      InputManager.unlockPointer();
      this.draw();
    }
  }

  public getCraftingSlots(): Array<ItemStack | null> {
    return this.craftingSlots;
  }

  // ── Draw ─────────────────────────────────────────────────────────────────

  public draw(): void {
    document.querySelectorAll<HTMLElement>('.slot[data-type="inventory"]').forEach(slotEl => {
      const idx = parseInt(slotEl.dataset.index!);
      this.renderSlotItem(slotEl, this.inventory.getSlot(idx));
    });

    document.querySelectorAll<HTMLElement>('.slot[data-type="hud"]').forEach(slotEl => {
      const idx = parseInt(slotEl.dataset.index!);
      this.renderSlotItem(slotEl, this.inventory.getSlot(idx));
    });

    document.querySelectorAll<HTMLElement>('.slot[data-type="crafting"]').forEach(slotEl => {
      const idx = parseInt(slotEl.dataset.index!);
      this.renderSlotItem(slotEl, this.craftingSlots[idx]);
    });

    const hudOffhandEl = document.getElementById('hud-offhand-slot');
    if (hudOffhandEl) {
      this.renderSlotItem(hudOffhandEl, this.inventory.getSlot(36));
    }

    // Calculate armor points
    let armorPoints = 0;
    for (let slotIndex of [37, 38, 39, 40]) {
      const stack = this.inventory.getSlot(slotIndex);
      if (stack && stack.count > 0) {
        const itemDef = ItemRegistry.get(stack.id);
        if (itemDef && itemDef.toolType === 'armor') {
          const tier = itemDef.tier;
          let points = 0;
          if (itemDef.name.endsWith('Helmet')) {
            points = tier === 4 ? 3 : tier === 2 ? 2 : tier === 1 ? 2 : tier === 3 ? 2 : 1;
          } else if (itemDef.name.endsWith('Chestplate')) {
            points = tier === 4 ? 8 : tier === 2 ? 6 : tier === 3 ? 5 : tier === 1 ? 4 : 3;
          } else if (itemDef.name.endsWith('Leggings')) {
            points = tier === 4 ? 6 : tier === 2 ? 5 : tier === 3 ? 3 : tier === 1 ? 3 : 2;
          } else if (itemDef.name.endsWith('Boots')) {
            points = tier === 4 ? 3 : tier === 2 ? 2 : tier === 1 ? 1 : tier === 3 ? 1 : 1;
          }
          armorPoints += points;
        }
      }
    }
    EventBus.emit('player:armorChanged', armorPoints);

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

  private renderSlotItem(slotEl: HTMLElement, stack: ItemStack | null | { id: number; count: number; durability?: number }): void {
    slotEl.innerHTML = '';
    if (!stack || stack.count <= 0) return;

    const img = document.createElement('img');
    img.className = 'item-icon';
    img.style.cssText = 'width:38px;height:38px;image-rendering:pixelated;';
    img.src = TextureGenerator.getItemIconDataURL(stack.id);
    slotEl.appendChild(img);

    if (stack.count > 1) {
      const countEl = document.createElement('span');
      countEl.className = 'item-count';
      countEl.textContent = stack.count.toString();
      slotEl.appendChild(countEl);
    }

    if (ItemRegistry.isTool(stack.id)) {
      const def = ItemRegistry.get(stack.id);
      if (def && def.durability > 0) {
        const currentDurability = stack.durability ?? def.durability;
        if (currentDurability < def.durability) {
          const ratio = Math.max(0, Math.min(1, currentDurability / def.durability));
          const barContainer = document.createElement('div');
          barContainer.className = 'durability-bar-container';
          barContainer.style.cssText = 'position:absolute;bottom:4px;left:6px;width:40px;height:4px;background:#1a0033;border:1px solid #000;border-radius:1px;pointer-events:none;';
          
          const barFill = document.createElement('div');
          barFill.className = 'durability-bar-fill';
          
          let color = '#55ff55';
          if (ratio <= 0.2) {
            color = '#ff5555';
          } else if (ratio <= 0.5) {
            color = '#ffff55';
          }
          
          barFill.style.cssText = `height:100%;width:${ratio * 100}%;background:${color};`;
          barContainer.appendChild(barFill);
          slotEl.appendChild(barContainer);
        }
      }
    }
  }

  private updateHUDHotbarActive(index: number): void {
    this.hudHotbar.querySelectorAll<HTMLElement>('.slot').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.index!) === index);
    });

    const elName = document.getElementById('hotbar-item-name');
    if (elName) {
      const stack = this.inventory.getSlot(index);
      if (stack && stack.id > 0) {
        let name = '';
        const itemDef = ItemRegistry.get(stack.id);
        if (itemDef) {
          name = itemDef.name;
        } else {
          name = BlockRegistry.get(stack.id)?.name || `Item #${stack.id}`;
        }
        elName.textContent = name;
        elName.style.opacity = '1';

        if (this.activeItemNameTimeout !== null) {
          window.clearTimeout(this.activeItemNameTimeout);
        }
        this.activeItemNameTimeout = window.setTimeout(() => {
          elName.style.opacity = '0';
        }, 1500);
      } else {
        elName.style.opacity = '0';
      }
    }
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────────

  private handleInventorySlotClick(index: number, isRightClick: boolean): void {
    if (index >= 37 && index <= 40) {
      if (this.draggedStack) {
        const itemDef = ItemRegistry.get(this.draggedStack.id);
        if (!itemDef || itemDef.toolType !== 'armor') return;
        if (index === 37 && !itemDef.name.endsWith('Helmet')) return;
        if (index === 38 && !itemDef.name.endsWith('Chestplate')) return;
        if (index === 39 && !itemDef.name.endsWith('Leggings')) return;
        if (index === 40 && !itemDef.name.endsWith('Boots')) return;
      }
    }

    const slotStack = this.inventory.getSlot(index);

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRightClick) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half };
        this.inventory.removeItemFromSlot(index, half);
      } else {
        this.draggedStack = { ...slotStack };
        this.inventory.setSlot(index, null);
      }
    } else {
      if (!slotStack) {
        if (isRightClick) {
          this.inventory.setSlot(index, { id: this.draggedStack.id, count: 1 });
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.inventory.setSlot(index, this.draggedStack);
          this.draggedStack = null;
        }
      } else if (slotStack.id === this.draggedStack.id) {
        const max = this.inventory.getMaxStackSize(slotStack.id);
        if (isRightClick) {
          if (slotStack.count < max) { slotStack.count++; if (--this.draggedStack.count <= 0) this.draggedStack = null; this.inventory.saveToStorage(); }
        } else {
          const space = max - slotStack.count;
          const xfer  = Math.min(space, this.draggedStack.count);
          slotStack.count += xfer;
          this.draggedStack.count -= xfer;
          if (this.draggedStack.count <= 0) this.draggedStack = null;
          this.inventory.saveToStorage();
        }
      } else if (!isRightClick) {
        const temp = { ...slotStack };
        this.inventory.setSlot(index, this.draggedStack);
        this.draggedStack = temp;
      }
    }
    this.draw();
  }

  private handleCraftingSlotClick(index: number, isRightClick: boolean): void {
    const slotStack = this.craftingSlots[index];

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRightClick) {
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
        if (isRightClick) {
          this.craftingSlots[index] = { id: this.draggedStack.id, count: 1 };
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.craftingSlots[index] = this.draggedStack;
          this.draggedStack = null;
        }
      } else if (slotStack.id === this.draggedStack.id) {
        const max = this.inventory.getMaxStackSize(slotStack.id);
        if (isRightClick) {
          if (slotStack.count < max) { slotStack.count++; if (--this.draggedStack.count <= 0) this.draggedStack = null; }
        } else {
          const space = max - slotStack.count;
          const xfer  = Math.min(space, this.draggedStack.count);
          slotStack.count += xfer;
          this.draggedStack.count -= xfer;
          if (this.draggedStack.count <= 0) this.draggedStack = null;
        }
      } else if (!isRightClick) {
        const temp = { ...slotStack };
        this.craftingSlots[index] = this.draggedStack;
        this.draggedStack = temp;
      }
    }
    this.updateCraftingRecipe();
    this.draw();
  }

  private handleResultSlotClick(): void {
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
    this.updateCraftingRecipe();
    this.draw();
  }

  private updateCraftingRecipe(): void {
    const gridIds = this.craftingSlots.map(s => s?.id ?? null);
    const result = CraftingSystem.checkRecipe(gridIds);
    this.renderSlotItem(this.craftingResult, result);
  }

  private updateDraggedPosition(e: MouseEvent): void {
    if (this.draggedStack) {
      this.draggedEl.style.left = `${e.clientX - 22}px`;
      this.draggedEl.style.top  = `${e.clientY - 22}px`;
    }
  }
}
