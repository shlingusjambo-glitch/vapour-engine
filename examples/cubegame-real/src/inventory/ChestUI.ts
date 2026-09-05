import { EventBus } from '../core/EventBus';
import { Inventory, ItemStack } from './Inventory';
import { InputManager } from '../core/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { StorageManager } from '../storage/StorageManager';
import { TextureGenerator } from '../graphics/TextureGenerator';
import { getFeatureItemId } from '../content/FeatureCatalog';

const CHEST_SIZE = 27; // 3×9

export class ChestUI {
  private inventory: Inventory;
  private screen: HTMLElement;
  private chestGrid: HTMLElement;
  private invGrid: HTMLElement;
  private hotbarGrid: HTMLElement;

  private chestSlots: Array<ItemStack | null> = new Array(CHEST_SIZE).fill(null);
  private currentChestPos: string = '';

  private draggedStack: ItemStack | null = null;
  private draggedEl: HTMLElement;
  private draggedImg: HTMLImageElement;
  private draggedCount: HTMLElement;

  constructor(inventory: Inventory) {
    this.inventory = inventory;

    this.screen     = document.getElementById('chest-screen')!;
    this.chestGrid  = document.getElementById('chest-inv-grid')!;
    this.invGrid    = document.getElementById('chest-player-inv')!;
    this.hotbarGrid = document.getElementById('chest-player-hotbar')!;

    this.draggedEl    = document.getElementById('dragged-item')!;
    this.draggedImg   = document.getElementById('dragged-item-img') as HTMLImageElement;
    this.draggedCount = document.getElementById('dragged-item-count')!;

    this.initDOM();
    this.bindEvents();

    EventBus.on('ui:openChest', (pos: { x: number; y: number; z: number }) => this.open(pos));
    EventBus.on('inventory:updated', () => { if (this.isOpen()) this.draw(); });

    window.addEventListener('mousemove', (e) => {
      if (this.draggedStack) {
        this.draggedEl.style.left = `${e.clientX - 22}px`;
        this.draggedEl.style.top  = `${e.clientY - 22}px`;
      }
    });
  }

  private initDOM(): void {
    this.chestGrid.innerHTML = '';
    for (let i = 0; i < CHEST_SIZE; i++) {
      this.chestGrid.appendChild(this.makeSlot(i, 'chest'));
    }
    this.invGrid.innerHTML = '';
    for (let i = 9; i < 36; i++) {
      this.invGrid.appendChild(this.makeSlot(i, 'chest-player'));
    }
    this.hotbarGrid.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      this.hotbarGrid.appendChild(this.makeSlot(i, 'chest-player'));
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
      const slot = (e.target as HTMLElement).closest('.slot') as HTMLElement | null;
      if (!slot) return;
      e.preventDefault();

      const type = slot.dataset.type!;
      const idx  = parseInt(slot.dataset.index!);
      const isRight = e.button === 2;

      if (type === 'chest') {
        this.handleChestClick(idx, isRight, e.shiftKey);
      } else if (type === 'chest-player') {
        this.handlePlayerClick(idx, isRight, e.shiftKey);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'e' || e.key === 'E' || e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    const closeBtn = document.getElementById('chest-close-btn');
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

  private generateLootForChest(): void {
    const lootPool = [
      { id: 201, max: 16 }, // Coal
      { id: 21, max: 8 },  // Torch
      { id: 202, max: 8 },  // Iron Ingot
      { id: 203, max: 4 },  // Gold Ingot
      
      // Medieval items
      { name: 'Shattered Crown', max: 1 },
      { name: 'Tarnished Ring', max: 1 },
      { name: 'Ancient Scroll', max: 1 },
      { name: 'Grace Fragment', max: 1 },

      // Food
      { name: 'Golden Carrot', max: 4 },
      { name: 'Cooked Fish', max: 6 },
      { name: 'Baked Potato', max: 8 },
      { name: 'Sweet Berries', max: 12 },

      // Tools / Armor
      { name: 'Silver Sword', max: 1 },
      { name: 'Copper Pickaxe', max: 1 },
      { name: 'Iron Helmet', max: 1 },
      { name: 'Iron Chestplate', max: 1 },
      { name: 'Silver Helmet', max: 1 }
    ];

    const posParts = this.currentChestPos.split(',').map(Number);
    const x = posParts[0] || 0;
    const y = posParts[1] || 0;
    const z = posParts[2] || 0;
    
    const rand = (seed: number) => {
      const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
      return n - Math.floor(n);
    };

    let seedIndex = 0;
    const itemCount = Math.floor(rand(seedIndex++) * 5) + 3; // 3 to 7 slots
    
    const occupied = new Set<number>();
    
    for (let i = 0; i < itemCount; i++) {
      let slot = Math.floor(rand(seedIndex++) * CHEST_SIZE);
      let attempts = 0;
      while (occupied.has(slot) && attempts < CHEST_SIZE) {
        slot = (slot + 1) % CHEST_SIZE;
        attempts++;
      }
      if (attempts >= CHEST_SIZE) break;
      occupied.add(slot);

      const itemDef = lootPool[Math.floor(rand(seedIndex++) * lootPool.length)];
      let itemIdValue = 0;
      if ('id' in itemDef && typeof itemDef.id === 'number') {
        itemIdValue = itemDef.id;
      } else if ('name' in itemDef && typeof itemDef.name === 'string') {
        itemIdValue = getFeatureItemId(itemDef.name);
      }

      if (itemIdValue > 0) {
        const count = Math.floor(rand(seedIndex++) * itemDef.max) + 1;
        this.chestSlots[slot] = { id: itemIdValue, count };
      }
    }
  }

  public async open(pos: { x: number; y: number; z: number }): Promise<void> {
    this.currentChestPos = `${pos.x},${pos.y},${pos.z}`;
    // Load saved chest contents
    const saved = await StorageManager.loadChestContents(this.currentChestPos);
    if (saved) {
      this.chestSlots = saved;
    } else {
      this.chestSlots = new Array(CHEST_SIZE).fill(null);
      this.generateLootForChest();
    }
    this.screen.style.display = 'flex';
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
    this.draw();
  }

  public close(): void {
    if (this.draggedStack) {
      this.inventory.addItem(this.draggedStack.id, this.draggedStack.count);
      this.draggedStack = null;
      this.draggedEl.style.display = 'none';
    }
    // Persist chest contents
    StorageManager.saveChestContents(this.currentChestPos, this.chestSlots);
    this.screen.style.display = 'none';
    InputManager.isUIActive = false;
    InputManager.lockPointer();
  }

  private draw(): void {
    this.chestGrid.querySelectorAll<HTMLElement>('.slot[data-type="chest"]').forEach(el => {
      this.renderSlot(el, this.chestSlots[parseInt(el.dataset.index!)]);
    });
    document.querySelectorAll<HTMLElement>('.slot[data-type="chest-player"]').forEach(el => {
      this.renderSlot(el, this.inventory.getSlot(parseInt(el.dataset.index!)));
    });

    if (this.draggedStack) {
      this.draggedEl.style.display = 'flex';
      this.draggedImg.src = TextureGenerator.getItemIconDataURL(this.draggedStack.id);
      this.draggedImg.style.imageRendering = 'pixelated';
      this.draggedCount.textContent = this.draggedStack.count > 1 ? this.draggedStack.count.toString() : '';
    } else {
      this.draggedEl.style.display = 'none';
    }
  }

  private renderSlot(el: HTMLElement, stack: ItemStack | null): void {
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

  private handleChestClick(index: number, isRight: boolean, isShift: boolean): void {
    const slotStack = this.chestSlots[index];

    if (isShift && !this.draggedStack && slotStack) {
      // Move to player inventory
      this.inventory.addItem(slotStack.id, slotStack.count);
      this.chestSlots[index] = null;
      StorageManager.saveChestContents(this.currentChestPos, this.chestSlots);
      AudioManager.playItemPickup();
      this.draw();
      return;
    }

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half };
        slotStack.count -= half;
        if (slotStack.count <= 0) this.chestSlots[index] = null;
      } else {
        this.draggedStack = { ...slotStack };
        this.chestSlots[index] = null;
      }
    } else {
      if (!slotStack) {
        if (isRight) {
          this.chestSlots[index] = { id: this.draggedStack.id, count: 1 };
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.chestSlots[index] = this.draggedStack;
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
        this.chestSlots[index] = this.draggedStack;
        this.draggedStack = temp;
      }
    }
    StorageManager.saveChestContents(this.currentChestPos, this.chestSlots);
    this.draw();
  }

  private handlePlayerClick(index: number, isRight: boolean, isShift: boolean): void {
    const slotStack = this.inventory.getSlot(index);

    if (isShift && !this.draggedStack && slotStack) {
      // Move to chest
      for (let i = 0; i < CHEST_SIZE; i++) {
        if (!this.chestSlots[i]) {
          this.chestSlots[i] = { ...slotStack };
          this.inventory.setSlot(index, null);
          StorageManager.saveChestContents(this.currentChestPos, this.chestSlots);
          break;
        }
      }
      AudioManager.playItemPickup();
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
}
