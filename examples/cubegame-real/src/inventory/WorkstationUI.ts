import { ItemRegistry } from '../items/ItemRegistry';
import { BlockRegistry } from '../world/BlockRegistry';
import { TextureGenerator } from '../graphics/TextureGenerator';
import { AudioManager } from '../audio/AudioManager';
import { InputManager } from '../core/InputManager';
import { EventBus } from '../core/EventBus';
import { Inventory, ItemStack } from './Inventory';
import { StorageManager } from '../storage/StorageManager';
import { getFeatureBlockId } from '../content/FeatureCatalog';

export interface StonecutterRecipe {
  outputId: number;
  count: number;
}

export class StonecutterUI {
  private inventory: Inventory;
  private screen: HTMLElement;
  private playerInvGrid: HTMLElement;
  private playerHotbarGrid: HTMLElement;
  private inputSlot: HTMLElement;
  private outputSlot: HTMLElement;
  private recipeListEl: HTMLElement;

  private inputStack: ItemStack | null = null;
  private outputStack: ItemStack | null = null;
  private selectedRecipe: StonecutterRecipe | null = null;

  private draggedStack: ItemStack | null = null;
  private draggedEl: HTMLElement;
  private draggedImg: HTMLImageElement;
  private draggedCount: HTMLElement;

  constructor(inventory: Inventory) {
    this.inventory = inventory;

    this.screen = document.getElementById('stonecutter-screen')!;
    this.playerInvGrid = document.getElementById('stonecutter-player-inv')!;
    this.playerHotbarGrid = document.getElementById('stonecutter-player-hotbar')!;
    this.inputSlot = document.getElementById('stonecutter-input-slot')!;
    this.outputSlot = document.getElementById('stonecutter-output-slot')!;
    this.recipeListEl = document.getElementById('stonecutter-recipe-list')!;

    this.draggedEl = document.getElementById('dragged-item')!;
    this.draggedImg = document.getElementById('dragged-item-img') as HTMLImageElement;
    this.draggedCount = document.getElementById('dragged-item-count')!;

    this.initDOM();
    this.bindEvents();

    EventBus.on('ui:openStonecutter', () => this.open());
    EventBus.on('inventory:updated', () => { if (this.isOpen()) this.draw(); });

    window.addEventListener('mousemove', (e) => {
      if (this.draggedStack && this.isOpen()) {
        this.draggedEl.style.left = `${e.clientX - 22}px`;
        this.draggedEl.style.top  = `${e.clientY - 22}px`;
      }
    });
  }

  private initDOM(): void {
    this.playerInvGrid.innerHTML = '';
    for (let i = 9; i < 36; i++) {
      this.playerInvGrid.appendChild(this.makeSlot(i, 'stonecutter-inventory'));
    }

    this.playerHotbarGrid.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      this.playerHotbarGrid.appendChild(this.makeSlot(i, 'stonecutter-inventory'));
    }
  }

  private makeSlot(index: number, type: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.index = index.toString();
    el.dataset.type = type;
    return el;
  }

  private bindEvents(): void {
    document.addEventListener('mousedown', (e) => {
      if (!this.isOpen()) return;
      const target = e.target as HTMLElement;
      const slot = target.closest('.slot') as HTMLElement | null;
      if (!slot) return;
      e.preventDefault();

      const type = slot.dataset.type || '';
      const idx = parseInt(slot.dataset.index || '-1');
      const isRight = e.button === 2;

      if (type === 'stonecutter-inventory') {
        this.handleInvClick(idx, isRight, e.shiftKey);
      } else if (type === 'stonecutter-slot') {
        this.handleTableClick(idx, isRight);
      }
    });

    const closeBtn = document.getElementById('stonecutter-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
  }

  public isOpen(): boolean {
    return this.screen.style.display === 'flex';
  }

  public open(): void {
    this.screen.style.display = 'flex';
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
    this.inputStack = null;
    this.outputStack = null;
    this.selectedRecipe = null;
    this.draw();
  }

  public close(): void {
    if (this.inputStack) {
      this.inventory.addItem(this.inputStack.id, this.inputStack.count);
      this.inputStack = null;
    }
    if (this.draggedStack) {
      this.inventory.addItem(this.draggedStack.id, this.draggedStack.count);
      this.draggedStack = null;
      this.draggedEl.style.display = 'none';
    }
    this.outputStack = null;
    this.selectedRecipe = null;
    this.screen.style.display = 'none';
    InputManager.isUIActive = false;
    InputManager.lockPointer();
  }

  private getRecipesFor(inputId: number): StonecutterRecipe[] {
    const recipes: StonecutterRecipe[] = [];
    const name = ItemRegistry.getName(inputId) || BlockRegistry.get(inputId).name || '';

    // Slab and Stair suffix lookups
    const slabId = getFeatureBlockId(`${name} Slab`);
    const stairId = getFeatureBlockId(`${name} Stairs`);

    if (slabId) recipes.push({ outputId: slabId, count: 2 });
    if (stairId) recipes.push({ outputId: stairId, count: 1 });

    // Custom pathways
    if (name === 'Stone') {
      const stoneBricksId = getFeatureBlockId('Stone Bricks');
      if (stoneBricksId) recipes.push({ outputId: stoneBricksId, count: 1 });
    } else if (name === 'Stone Bricks') {
      const chiseledId = getFeatureBlockId('Chiseled Stone');
      if (chiseledId) recipes.push({ outputId: chiseledId, count: 1 });
    }

    return recipes;
  }

  private draw(): void {
    document.querySelectorAll<HTMLElement>('.slot[data-type="stonecutter-inventory"]').forEach((slotEl) => {
      const idx = parseInt(slotEl.dataset.index!);
      this.renderSlotItem(slotEl, this.inventory.getSlot(idx));
    });

    this.renderSlotItem(this.inputSlot, this.inputStack);
    this.renderSlotItem(this.outputSlot, this.outputStack);

    // Render Recipe List
    this.recipeListEl.innerHTML = '';
    if (this.inputStack) {
      const recipes = this.getRecipesFor(this.inputStack.id);
      recipes.forEach((recipe) => {
        const itemEl = document.createElement('div');
        itemEl.style.cssText = 'width:36px;height:36px;background:rgba(255,255,255,0.15);border:1px solid #444;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative;';
        if (this.selectedRecipe && this.selectedRecipe.outputId === recipe.outputId) {
          itemEl.style.borderColor = 'var(--color-primary)';
          itemEl.style.background = 'rgba(255,255,255,0.3)';
        }

        const img = document.createElement('img');
        img.style.cssText = 'width:28px;height:28px;image-rendering:pixelated;';
        img.src = TextureGenerator.getItemIconDataURL(recipe.outputId);
        itemEl.appendChild(img);

        if (recipe.count > 1) {
          const badge = document.createElement('span');
          badge.style.cssText = 'position:absolute;bottom:1px;right:2px;font-size:9px;color:white;font-family:monospace;text-shadow:1px 1px black;';
          badge.textContent = recipe.count.toString();
          itemEl.appendChild(badge);
        }

        itemEl.addEventListener('click', () => {
          this.selectedRecipe = recipe;
          this.updateOutput();
          AudioManager.playItemPickup();
          this.draw();
        });

        this.recipeListEl.appendChild(itemEl);
      });
    }

    if (this.draggedStack) {
      this.draggedEl.style.display = 'flex';
      this.draggedImg.src = TextureGenerator.getItemIconDataURL(this.draggedStack.id);
      this.draggedCount.textContent = this.draggedStack.count > 1 ? this.draggedStack.count.toString() : '';
    } else {
      this.draggedEl.style.display = 'none';
    }
  }

  private updateOutput(): void {
    if (!this.inputStack || !this.selectedRecipe) {
      this.outputStack = null;
      return;
    }
    this.outputStack = { id: this.selectedRecipe.outputId, count: this.selectedRecipe.count };
  }

  private renderSlotItem(slotEl: HTMLElement, stack: ItemStack | null): void {
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
  }

  private handleInvClick(idx: number, isRight: boolean, isShift: boolean): void {
    const slotStack = this.inventory.getSlot(idx);

    if (isShift && slotStack && !this.draggedStack) {
      const recipes = this.getRecipesFor(slotStack.id);
      if (recipes.length > 0) {
        if (!this.inputStack) {
          this.inputStack = { ...slotStack };
          this.inventory.setSlot(idx, null);
        } else if (this.inputStack.id === slotStack.id) {
          const max = this.inventory.getMaxStackSize(slotStack.id);
          const space = max - this.inputStack.count;
          const xfer = Math.min(space, slotStack.count);
          this.inputStack.count += xfer;
          slotStack.count -= xfer;
          if (slotStack.count <= 0) this.inventory.setSlot(idx, null);
        }
        AudioManager.playItemPickup();
        this.selectedRecipe = null;
        this.updateOutput();
        this.draw();
      }
      return;
    }

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half };
        this.inventory.removeItemFromSlot(idx, half);
      } else {
        this.draggedStack = { ...slotStack };
        this.inventory.setSlot(idx, null);
      }
    } else {
      if (!slotStack) {
        if (isRight) {
          this.inventory.setSlot(idx, { id: this.draggedStack.id, count: 1 });
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.inventory.setSlot(idx, this.draggedStack);
          this.draggedStack = null;
        }
      } else if (slotStack.id === this.draggedStack.id) {
        const max = this.inventory.getMaxStackSize(slotStack.id);
        if (isRight) {
          if (slotStack.count < max) { slotStack.count++; if (--this.draggedStack.count <= 0) this.draggedStack = null; this.inventory.saveToStorage(); }
        } else {
          const space = max - slotStack.count;
          const xfer = Math.min(space, this.draggedStack.count);
          slotStack.count += xfer;
          this.draggedStack.count -= xfer;
          if (this.draggedStack.count <= 0) this.draggedStack = null;
          this.inventory.saveToStorage();
        }
      } else if (!isRight) {
        const temp = { ...slotStack };
        this.inventory.setSlot(idx, this.draggedStack);
        this.draggedStack = temp;
      }
    }
    AudioManager.playItemPickup();
    this.draw();
  }

  private handleTableClick(idx: number, isRight: boolean): void {
    if (idx === 1) { // Output slot
      if (this.outputStack && !this.draggedStack) {
        this.draggedStack = { ...this.outputStack };
        this.outputStack = null;

        // Deduct input
        if (this.inputStack) {
          this.inputStack.count--;
          if (this.inputStack.count <= 0) {
            this.inputStack = null;
            this.selectedRecipe = null;
          }
        }
        this.updateOutput();
        AudioManager.playItemPickup();
        this.draw();
      }
      return;
    }

    if (!this.draggedStack) {
      if (!this.inputStack) return;
      if (isRight) {
        const half = Math.ceil(this.inputStack.count / 2);
        this.draggedStack = { id: this.inputStack.id, count: half };
        this.inputStack.count -= half;
        if (this.inputStack.count <= 0) {
          this.inputStack = null;
          this.selectedRecipe = null;
        }
      } else {
        this.draggedStack = { ...this.inputStack };
        this.inputStack = null;
        this.selectedRecipe = null;
      }
    } else {
      const recipes = this.getRecipesFor(this.draggedStack.id);
      if (recipes.length === 0) {
        EventBus.emit('network:chat', `[System] That block cannot be stonecut!`);
        return;
      }

      if (!this.inputStack) {
        if (isRight) {
          this.inputStack = { id: this.draggedStack.id, count: 1 };
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.inputStack = this.draggedStack;
          this.draggedStack = null;
        }
        this.selectedRecipe = null;
      } else if (this.inputStack.id === this.draggedStack.id) {
        const max = this.inventory.getMaxStackSize(this.inputStack.id);
        if (isRight) {
          if (this.inputStack.count < max) { this.inputStack.count++; if (--this.draggedStack.count <= 0) this.draggedStack = null; }
        } else {
          const space = max - this.inputStack.count;
          const xfer = Math.min(space, this.draggedStack.count);
          this.inputStack.count += xfer;
          this.draggedStack.count -= xfer;
          if (this.draggedStack.count <= 0) this.draggedStack = null;
        }
      } else if (!isRight) {
        const temp = { ...this.inputStack };
        this.inputStack = this.draggedStack;
        this.draggedStack = temp;
        this.selectedRecipe = null;
      }
    }
    this.updateOutput();
    AudioManager.playItemPickup();
    this.draw();
  }
}

export interface LoomPattern {
  name: string;
  patternName: string;
}

const LOOM_PATTERNS: LoomPattern[] = [
  { name: 'Stripe', patternName: 'stripe' },
  { name: 'Cross', patternName: 'cross' },
  { name: 'Flower Charge', patternName: 'flower' },
  { name: 'Creeper Charge', patternName: 'creeper' },
  { name: 'Skull Charge', patternName: 'skull' },
  { name: 'Border', patternName: 'border' },
];

export class LoomUI {
  private inventory: Inventory;
  private screen: HTMLElement;
  private playerInvGrid: HTMLElement;
  private playerHotbarGrid: HTMLElement;

  private bannerSlot: HTMLElement;
  private dyeSlot: HTMLElement;
  private patternSlot: HTMLElement;
  private outputSlot: HTMLElement;
  private patternListEl: HTMLElement;

  private slots: Array<ItemStack | null> = [null, null, null, null]; // 0: Banner, 1: Dye, 2: Pattern Item, 3: Output
  private selectedPattern: LoomPattern | null = null;

  private draggedStack: ItemStack | null = null;
  private draggedEl: HTMLElement;
  private draggedImg: HTMLImageElement;
  private draggedCount: HTMLElement;

  constructor(inventory: Inventory) {
    this.inventory = inventory;

    this.screen = document.getElementById('loom-screen')!;
    this.playerInvGrid = document.getElementById('loom-player-inv')!;
    this.playerHotbarGrid = document.getElementById('loom-player-hotbar')!;

    this.bannerSlot = document.getElementById('loom-banner-slot')!;
    this.dyeSlot = document.getElementById('loom-dye-slot')!;
    this.patternSlot = document.getElementById('loom-pattern-slot')!;
    this.outputSlot = document.getElementById('loom-output-slot')!;
    this.patternListEl = document.getElementById('loom-pattern-list')!;

    this.draggedEl = document.getElementById('dragged-item')!;
    this.draggedImg = document.getElementById('dragged-item-img') as HTMLImageElement;
    this.draggedCount = document.getElementById('dragged-item-count')!;

    this.initDOM();
    this.bindEvents();

    EventBus.on('ui:openLoom', () => this.open());
    EventBus.on('inventory:updated', () => { if (this.isOpen()) this.draw(); });

    window.addEventListener('mousemove', (e) => {
      if (this.draggedStack && this.isOpen()) {
        this.draggedEl.style.left = `${e.clientX - 22}px`;
        this.draggedEl.style.top  = `${e.clientY - 22}px`;
      }
    });
  }

  private initDOM(): void {
    this.playerInvGrid.innerHTML = '';
    for (let i = 9; i < 36; i++) {
      this.playerInvGrid.appendChild(this.makeSlot(i, 'loom-inventory'));
    }

    this.playerHotbarGrid.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      this.playerHotbarGrid.appendChild(this.makeSlot(i, 'loom-inventory'));
    }
  }

  private makeSlot(index: number, type: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'slot';
    el.dataset.index = index.toString();
    el.dataset.type = type;
    return el;
  }

  private bindEvents(): void {
    document.addEventListener('mousedown', (e) => {
      if (!this.isOpen()) return;
      const target = e.target as HTMLElement;
      const slot = target.closest('.slot') as HTMLElement | null;
      if (!slot) return;
      e.preventDefault();

      const type = slot.dataset.type || '';
      const idx = parseInt(slot.dataset.index || '-1');
      const isRight = e.button === 2;

      if (type === 'loom-inventory') {
        this.handleInvClick(idx, isRight, e.shiftKey);
      } else if (type === 'loom-slot') {
        this.handleTableClick(idx, isRight);
      }
    });

    const closeBtn = document.getElementById('loom-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
  }

  public isOpen(): boolean {
    return this.screen.style.display === 'flex';
  }

  public open(): void {
    this.screen.style.display = 'flex';
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
    this.slots.fill(null);
    this.selectedPattern = null;
    this.draw();
  }

  public close(): void {
    for (let i = 0; i < 3; i++) {
      const s = this.slots[i];
      if (s) {
        this.inventory.addItem(s.id, s.count);
        this.slots[i] = null;
      }
    }
    if (this.draggedStack) {
      this.inventory.addItem(this.draggedStack.id, this.draggedStack.count);
      this.draggedStack = null;
      this.draggedEl.style.display = 'none';
    }
    this.slots[3] = null;
    this.selectedPattern = null;
    this.screen.style.display = 'none';
    InputManager.isUIActive = false;
    InputManager.lockPointer();
  }

  private draw(): void {
    document.querySelectorAll<HTMLElement>('.slot[data-type="loom-inventory"]').forEach((slotEl) => {
      const idx = parseInt(slotEl.dataset.index!);
      this.renderSlotItem(slotEl, this.inventory.getSlot(idx));
    });

    this.renderSlotItem(this.bannerSlot, this.slots[0]);
    this.renderSlotItem(this.dyeSlot, this.slots[1]);
    this.renderSlotItem(this.patternSlot, this.slots[2]);
    this.renderSlotItem(this.outputSlot, this.slots[3]);

    this.patternListEl.innerHTML = '';
    const banner = this.slots[0];
    const dye = this.slots[1];
    if (banner && dye) {
      let patternsToShow = LOOM_PATTERNS;
      const patternItem = this.slots[2];
      if (patternItem) {
        const name = ItemRegistry.getName(patternItem.id) || '';
        const specific = LOOM_PATTERNS.find(p => name.toLowerCase().includes(p.name.toLowerCase()));
        if (specific) {
          patternsToShow = [specific];
        }
      }

      patternsToShow.forEach((pat) => {
        const btn = document.createElement('div');
        btn.style.cssText = 'height:32px;background:rgba(255,255,255,0.1);border:1px solid #555;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:white;font-size:10px;font-family:monospace;';
        if (this.selectedPattern && this.selectedPattern.name === pat.name) {
          btn.style.borderColor = 'var(--color-primary)';
          btn.style.background = 'rgba(255,255,255,0.2)';
        }
        btn.textContent = pat.name;
        btn.addEventListener('click', () => {
          this.selectedPattern = pat;
          this.updateOutput();
          AudioManager.playItemPickup();
          this.draw();
        });
        this.patternListEl.appendChild(btn);
      });
    }

    if (this.draggedStack) {
      this.draggedEl.style.display = 'flex';
      this.draggedImg.src = TextureGenerator.getItemIconDataURL(this.draggedStack.id);
      this.draggedCount.textContent = this.draggedStack.count > 1 ? this.draggedStack.count.toString() : '';
    } else {
      this.draggedEl.style.display = 'none';
    }
  }

  private updateOutput(): void {
    const banner = this.slots[0];
    const dye = this.slots[1];
    if (!banner || !dye || !this.selectedPattern) {
      this.slots[3] = null;
      return;
    }

    const dyeName = ItemRegistry.getName(dye.id) || 'Colored';
    const cleanDye = dyeName.replace(' Dye', '');

    const output: ItemStack = JSON.parse(JSON.stringify(banner));
    output.count = 1;
    (output as any).customName = `${cleanDye} ${this.selectedPattern.name} Banner`;
    (output as any).bannerPattern = this.selectedPattern.patternName;
    (output as any).bannerColor = cleanDye;

    this.slots[3] = output;
  }

  private renderSlotItem(slotEl: HTMLElement, stack: ItemStack | null): void {
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
  }

  private handleInvClick(idx: number, isRight: boolean, isShift: boolean): void {
    const slotStack = this.inventory.getSlot(idx);

    if (isShift && slotStack && !this.draggedStack) {
      const name = ItemRegistry.getName(slotStack.id) || '';
      let targetIdx = -1;
      if (name.includes('Banner Pattern')) {
        targetIdx = 2;
      } else if (name.includes('Dye')) {
        targetIdx = 1;
      } else if (name.includes('Banner')) {
        targetIdx = 0;
      }

      if (targetIdx !== -1 && !this.slots[targetIdx]) {
        this.slots[targetIdx] = { ...slotStack };
        this.inventory.setSlot(idx, null);
        AudioManager.playItemPickup();
        this.selectedPattern = null;
        this.updateOutput();
        this.draw();
      }
      return;
    }

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half, customName: (slotStack as any).customName };
        this.inventory.removeItemFromSlot(idx, half);
      } else {
        this.draggedStack = { ...slotStack };
        this.inventory.setSlot(idx, null);
      }
    } else {
      if (!slotStack) {
        if (isRight) {
          this.inventory.setSlot(idx, { id: this.draggedStack.id, count: 1, customName: (this.draggedStack as any).customName });
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.inventory.setSlot(idx, this.draggedStack);
          this.draggedStack = null;
        }
      } else if (slotStack.id === this.draggedStack.id) {
        const max = this.inventory.getMaxStackSize(slotStack.id);
        if (isRight) {
          if (slotStack.count < max) { slotStack.count++; if (--this.draggedStack.count <= 0) this.draggedStack = null; this.inventory.saveToStorage(); }
        } else {
          const space = max - slotStack.count;
          const xfer = Math.min(space, this.draggedStack.count);
          slotStack.count += xfer;
          this.draggedStack.count -= xfer;
          if (this.draggedStack.count <= 0) this.draggedStack = null;
          this.inventory.saveToStorage();
        }
      } else if (!isRight) {
        const temp = { ...slotStack };
        this.inventory.setSlot(idx, this.draggedStack);
        this.draggedStack = temp;
      }
    }
    AudioManager.playItemPickup();
    this.draw();
  }

  private handleTableClick(idx: number, isRight: boolean): void {
    if (idx === 3) {
      if (this.slots[3] && !this.draggedStack) {
        this.draggedStack = { ...this.slots[3] };
        this.slots[3] = null;

        if (this.slots[0]) {
          this.slots[0].count--;
          if (this.slots[0].count <= 0) this.slots[0] = null;
        }
        if (this.slots[1]) {
          this.slots[1].count--;
          if (this.slots[1].count <= 0) this.slots[1] = null;
        }

        this.selectedPattern = null;
        this.updateOutput();
        AudioManager.playItemPickup();
        this.draw();
      }
      return;
    }

    const slotStack = this.slots[idx];
    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half, customName: (slotStack as any).customName };
        slotStack.count -= half;
        if (slotStack.count <= 0) this.slots[idx] = null;
      } else {
        this.draggedStack = { ...slotStack };
        this.slots[idx] = null;
      }
      this.selectedPattern = null;
    } else {
      const name = ItemRegistry.getName(this.draggedStack.id) || '';
      if (idx === 0 && !name.includes('Banner')) {
        EventBus.emit('network:chat', `[System] Must place a Banner in the banner slot!`);
        return;
      }
      if (idx === 1 && !name.includes('Dye')) {
        EventBus.emit('network:chat', `[System] Must place Dye in the dye slot!`);
        return;
      }
      if (idx === 2 && !name.includes('Banner Pattern')) {
        EventBus.emit('network:chat', `[System] Must place a Banner Pattern in the pattern slot!`);
        return;
      }

      if (!slotStack) {
        if (isRight) {
          this.slots[idx] = { id: this.draggedStack.id, count: 1, customName: (this.draggedStack as any).customName };
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.slots[idx] = this.draggedStack;
          this.draggedStack = null;
        }
        this.selectedPattern = null;
      } else if (slotStack.id === this.draggedStack.id) {
        const max = this.inventory.getMaxStackSize(slotStack.id);
        if (isRight) {
          if (slotStack.count < max) { slotStack.count++; if (--this.draggedStack.count <= 0) this.draggedStack = null; }
        } else {
          const space = max - slotStack.count;
          const xfer = Math.min(space, this.draggedStack.count);
          slotStack.count += xfer;
          this.draggedStack.count -= xfer;
          if (this.draggedStack.count <= 0) this.draggedStack = null;
        }
      } else if (!isRight) {
        const temp = { ...slotStack };
        this.slots[idx] = this.draggedStack;
        this.draggedStack = temp;
        this.selectedPattern = null;
      }
    }
    this.updateOutput();
    AudioManager.playItemPickup();
    this.draw();
  }
}

export class LecternUI {
  private screen: HTMLElement;
  private pageTextEl: HTMLElement;
  private pageInputEl: HTMLTextAreaElement;
  private pageIndicatorEl: HTMLElement;

  private pageViewEl: HTMLElement;
  private pageEditEl: HTMLElement;

  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private writeBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;

  private currentPos: string = '';
  private pages: string[] = [];
  private currentPageIdx: number = 0;

  constructor() {
    this.screen = document.getElementById('lectern-screen')!;
    this.pageTextEl = document.getElementById('lectern-page-text')!;
    this.pageInputEl = document.getElementById('lectern-page-input') as HTMLTextAreaElement;
    this.pageIndicatorEl = document.getElementById('lectern-page-indicator')!;

    this.pageViewEl = document.getElementById('lectern-page-view')!;
    this.pageEditEl = document.getElementById('lectern-page-edit')!;

    this.prevBtn = document.getElementById('lectern-prev-btn') as HTMLButtonElement;
    this.nextBtn = document.getElementById('lectern-next-btn') as HTMLButtonElement;
    this.writeBtn = document.getElementById('lectern-write-btn') as HTMLButtonElement;
    this.saveBtn = document.getElementById('lectern-save-btn') as HTMLButtonElement;
    this.closeBtn = document.getElementById('lectern-close-btn') as HTMLButtonElement;

    this.bindEvents();

    EventBus.on('ui:openLectern', (pos: { x: number; y: number; z: number }) => this.open(pos));
  }

  private bindEvents(): void {
    this.prevBtn.addEventListener('click', () => {
      if (this.currentPageIdx > 0) {
        this.currentPageIdx--;
        this.draw();
        AudioManager.playItemPickup();
      }
    });

    this.nextBtn.addEventListener('click', () => {
      if (this.currentPageIdx < this.pages.length - 1) {
        this.currentPageIdx++;
        this.draw();
        AudioManager.playItemPickup();
      } else if (this.currentPageIdx === this.pages.length - 1 && this.pages.length < 50) {
        this.pages.push('');
        this.currentPageIdx++;
        this.draw();
        AudioManager.playItemPickup();
      }
    });

    this.writeBtn.addEventListener('click', () => {
      this.toggleEdit(true);
    });

    this.saveBtn.addEventListener('click', () => {
      this.savePage();
    });

    this.closeBtn.addEventListener('click', () => {
      this.close();
    });

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'Escape') {
        if (this.pageEditEl.style.display === 'flex') {
          this.toggleEdit(false);
        } else {
          this.close();
        }
      }
    });
  }

  public isOpen(): boolean {
    return this.screen.style.display === 'flex';
  }

  public async open(pos: { x: number; y: number; z: number }): Promise<void> {
    this.currentPos = `${pos.x},${pos.y},${pos.z}`;
    
    const data = await StorageManager.getWorldData<string[] | null>(`lectern::${this.currentPos}`, null);
    if (data && Array.isArray(data) && data.length > 0) {
      this.pages = data;
    } else {
      this.pages = [
        "Welcome to your Lectern!\n\nThis book is blank. Click the 'Write Page' button below to customize its text.\n\nYou can flip pages using the Prev and Next buttons.",
        "Volume 1: The Legend of the Cube\n\nLong ago, the world was flat and smooth. Then, the Great Creator placed the first voxel block...\n\nEver since, adventurers have built monuments and fought monsters in these lands.",
        "Volume 2: Automation & Power\n\nRedstone lines carry electric pulses. Use Repeaters to amplify power, and Comparators to compare input strengths.\n\nHoppers extract items, and Pistons push blocks."
      ];
    }

    this.currentPageIdx = 0;
    this.screen.style.display = 'flex';
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
    this.toggleEdit(false);
    this.draw();
  }

  public close(): void {
    this.screen.style.display = 'none';
    InputManager.isUIActive = false;
    InputManager.lockPointer();
  }

  private toggleEdit(edit: boolean): void {
    if (edit) {
      this.pageViewEl.style.display = 'none';
      this.pageEditEl.style.display = 'flex';
      this.writeBtn.style.display = 'none';
      this.saveBtn.style.display = 'block';
      this.pageInputEl.value = this.pages[this.currentPageIdx] || '';
      this.pageInputEl.focus();
    } else {
      this.pageViewEl.style.display = 'block';
      this.pageEditEl.style.display = 'none';
      this.writeBtn.style.display = 'block';
      this.saveBtn.style.display = 'none';
    }
  }

  private async savePage(): Promise<void> {
    this.pages[this.currentPageIdx] = this.pageInputEl.value;
    
    while (this.pages.length > 1 && this.pages[this.pages.length - 1] === '') {
      this.pages.pop();
    }

    await StorageManager.setWorldData(`lectern::${this.currentPos}`, this.pages);
    this.toggleEdit(false);
    this.draw();
    AudioManager.playPlace('wood');
  }

  private draw(): void {
    this.pageTextEl.textContent = this.pages[this.currentPageIdx] || 'This page is empty.';
    this.pageIndicatorEl.textContent = `Page ${this.currentPageIdx + 1} of ${this.pages.length}`;
    
    this.prevBtn.disabled = this.currentPageIdx === 0;
    this.nextBtn.disabled = this.currentPageIdx >= 49;
  }
}
