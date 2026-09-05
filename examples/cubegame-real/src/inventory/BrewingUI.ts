import { EventBus } from '../core/EventBus';
import { Inventory, ItemStack } from './Inventory';
import { ItemRegistry } from '../items/ItemRegistry';
import { BlockRegistry } from '../world/BlockRegistry';
import { InputManager } from '../core/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { TextureGenerator } from '../graphics/TextureGenerator';
import { BrewingState, BrewingManager } from './BrewingManager';
import { getFeatureItemId } from '../content/FeatureCatalog';

export class BrewingUI {
  private inventory: Inventory;
  private manager: BrewingManager;

  private screen: HTMLElement;
  private playerInvGrid: HTMLElement;
  private playerHotbarGrid: HTMLElement;
  
  private fuelSlot: HTMLElement;
  private ingredientSlot: HTMLElement;
  private potionSlots: HTMLElement[] = [];
  
  private fuelIndicator: HTMLElement;
  private progressFill: HTMLElement;
  private statusText: HTMLElement;

  private activeCoords: { x: number; y: number; z: number } | null = null;
  private updateInterval: number | null = null;

  private draggedStack: ItemStack | null = null;
  private draggedEl: HTMLElement;
  private draggedImg: HTMLImageElement;
  private draggedCount: HTMLElement;

  constructor(inventory: Inventory) {
    this.inventory = inventory;
    this.manager = (window as any).gameBrewingManager;

    this.screen = document.getElementById('brewing-screen')!;
    this.playerInvGrid = document.getElementById('brewing-player-inv')!;
    this.playerHotbarGrid = document.getElementById('brewing-player-hotbar')!;
    
    this.fuelSlot = document.getElementById('brewing-fuel-slot')!;
    this.ingredientSlot = document.getElementById('brewing-ingredient-slot')!;
    
    const potionElements = document.querySelectorAll('[data-type="brewing-slot"]');
    potionElements.forEach((el) => {
      const idx = parseInt((el as HTMLElement).dataset.index || '-1');
      if (idx >= 0 && idx <= 2) {
        this.potionSlots[idx] = el as HTMLElement;
      }
    });

    this.fuelIndicator = document.getElementById('brewing-fuel-indicator')!;
    this.progressFill = document.getElementById('brewing-progress-fill')!;
    this.statusText = document.getElementById('brewing-status-text')!;

    this.draggedEl = document.getElementById('dragged-item')!;
    this.draggedImg = document.getElementById('dragged-item-img') as HTMLImageElement;
    this.draggedCount = document.getElementById('dragged-item-count')!;

    this.initDOM();
    this.bindEvents();

    EventBus.on('ui:openBrewingStand', (coords: any) => this.open(coords));
    EventBus.on('inventory:updated', () => { if (this.isOpen()) this.draw(); });

    window.addEventListener('mousemove', (e) => {
      if (this.draggedStack) {
        this.draggedEl.style.left = `${e.clientX - 22}px`;
        this.draggedEl.style.top  = `${e.clientY - 22}px`;
      }
    });
  }

  private initDOM(): void {
    // Player inventory (indices 9-35)
    this.playerInvGrid.innerHTML = '';
    for (let i = 9; i < 36; i++) {
      this.playerInvGrid.appendChild(this.makeSlot(i, 'brewing-inventory'));
    }

    // Hotbar (indices 0-8)
    this.playerHotbarGrid.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      this.playerHotbarGrid.appendChild(this.makeSlot(i, 'brewing-inventory'));
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

      if (type === 'brewing-inventory') {
        this.handleInvClick(idx, isRight, e.shiftKey);
      } else if (type === 'brewing-slot') {
        this.handleStandClick(idx, isRight);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'e' || e.key === 'E' || e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    const closeBtn = document.getElementById('brewing-close-btn');
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

  public open(coords: { x: number; y: number; z: number }): void {
    this.activeCoords = coords;
    this.screen.style.display = 'flex';
    InputManager.isUIActive = true;
    InputManager.unlockPointer();
    this.draw();

    this.updateInterval = window.setInterval(() => this.updateStandState(), 100);
  }

  public close(): void {
    if (this.draggedStack) {
      this.inventory.addItem(this.draggedStack.id, this.draggedStack.count);
      this.draggedStack = null;
      this.draggedEl.style.display = 'none';
    }

    this.screen.style.display = 'none';
    InputManager.isUIActive = false;
    InputManager.lockPointer();
    this.activeCoords = null;

    if (this.updateInterval !== null) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  private updateStandState(): void {
    if (!this.activeCoords) return;
    const manager = (window as any).gameBrewingManager as BrewingManager;
    const state = manager.getStandState(this.activeCoords.x, this.activeCoords.y, this.activeCoords.z);

    // Progress percentage
    const pct = state.brewTime > 0 ? ((20.0 - state.brewTime) / 20.0) * 100 : 0;
    this.progressFill.style.height = `${pct}%`;
    this.statusText.textContent = state.brewTime > 0 ? `Brewing: ${Math.ceil(state.brewTime)}s` : 'Idle';
    this.fuelIndicator.textContent = `Fuel: ${Math.round((state.fuel / 20.0) * 100)}%`;

    // Redraw slots dynamically to reflect background updates
    this.drawStandSlots(state);
  }

  private draw(): void {
    if (!this.activeCoords) return;
    const manager = (window as any).gameBrewingManager as BrewingManager;
    const state = manager.getStandState(this.activeCoords.x, this.activeCoords.y, this.activeCoords.z);

    // Inventory slots
    document.querySelectorAll<HTMLElement>('.slot[data-type="brewing-inventory"]').forEach((slotEl) => {
      const idx = parseInt(slotEl.dataset.index!);
      this.renderSlotItem(slotEl, this.inventory.getSlot(idx));
    });

    this.drawStandSlots(state);

    if (this.draggedStack) {
      this.draggedEl.style.display = 'flex';
      this.draggedImg.src = TextureGenerator.getItemIconDataURL(this.draggedStack.id);
      this.draggedCount.textContent = this.draggedStack.count > 1 ? this.draggedStack.count.toString() : '';
    } else {
      this.draggedEl.style.display = 'none';
    }
  }

  private drawStandSlots(state: BrewingState): void {
    this.renderSlotItem(this.fuelSlot, state.fuelSlot);
    this.renderSlotItem(this.ingredientSlot, state.ingredient);
    for (let i = 0; i < 3; i++) {
      this.renderSlotItem(this.potionSlots[i], state.potions[i]);
    }
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

    if (isShift && !this.draggedStack && slotStack) {
      // Shift-click automatically routes into brewing stand slots
      const manager = (window as any).gameBrewingManager as BrewingManager;
      const state = manager.getStandState(this.activeCoords!.x, this.activeCoords!.y, this.activeCoords!.z);
      
      const isBlaze = slotStack.id === (getFeatureItemId('Blaze Powder') || 418);
      const isPotion = slotStack.id === 415 || slotStack.id === 416 || slotStack.id === 417;

      if (isBlaze) {
        if (!state.fuelSlot) {
          state.fuelSlot = { ...slotStack };
          this.inventory.setSlot(idx, null);
        } else if (state.fuelSlot.id === slotStack.id) {
          const max = this.inventory.getMaxStackSize(slotStack.id);
          const xfer = Math.min(max - state.fuelSlot.count, slotStack.count);
          state.fuelSlot.count += xfer;
          this.inventory.removeItemFromSlot(idx, xfer);
        }
      } else if (isPotion) {
        // Find empty potion slot
        for (let i = 0; i < 3; i++) {
          if (!state.potions[i]) {
            state.potions[i] = { ...slotStack };
            this.inventory.setSlot(idx, null);
            break;
          }
        }
      } else {
        // Treat as ingredient
        if (!state.ingredient) {
          state.ingredient = { ...slotStack };
          this.inventory.setSlot(idx, null);
        } else if (state.ingredient.id === slotStack.id) {
          const max = this.inventory.getMaxStackSize(slotStack.id);
          const xfer = Math.min(max - state.ingredient.count, slotStack.count);
          state.ingredient.count += xfer;
          this.inventory.removeItemFromSlot(idx, xfer);
        }
      }
      AudioManager.playItemPickup();
      this.draw();
      manager.saveAll();
      return;
    }

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half, potionEffect: slotStack.potionEffect };
        this.inventory.removeItemFromSlot(idx, half);
      } else {
        this.draggedStack = { ...slotStack };
        this.inventory.setSlot(idx, null);
      }
    } else {
      if (!slotStack) {
        if (isRight) {
          this.inventory.setSlot(idx, { id: this.draggedStack.id, count: 1, potionEffect: this.draggedStack.potionEffect });
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.inventory.setSlot(idx, this.draggedStack);
          this.draggedStack = null;
        }
      } else if (slotStack.id === this.draggedStack.id && slotStack.potionEffect === this.draggedStack.potionEffect) {
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

  private handleStandClick(idx: number, isRight: boolean): void {
    const manager = (window as any).gameBrewingManager as BrewingManager;
    const state = manager.getStandState(this.activeCoords!.x, this.activeCoords!.y, this.activeCoords!.z);

    let slotStack: ItemStack | null = null;
    if (idx >= 0 && idx <= 2) slotStack = state.potions[idx];
    else if (idx === 3) slotStack = state.ingredient;
    else if (idx === 4) slotStack = state.fuelSlot;

    const setStandSlot = (index: number, val: ItemStack | null) => {
      if (index >= 0 && index <= 2) state.potions[index] = val;
      else if (index === 3) state.ingredient = val;
      else if (index === 4) state.fuelSlot = val;
    };

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half, potionEffect: slotStack.potionEffect };
        slotStack.count -= half;
        if (slotStack.count <= 0) setStandSlot(idx, null);
      } else {
        this.draggedStack = { ...slotStack };
        setStandSlot(idx, null);
      }
    } else {
      if (!slotStack) {
        if (isRight) {
          setStandSlot(idx, { id: this.draggedStack.id, count: 1, potionEffect: this.draggedStack.potionEffect });
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          setStandSlot(idx, this.draggedStack);
          this.draggedStack = null;
        }
      } else if (slotStack.id === this.draggedStack.id && slotStack.potionEffect === this.draggedStack.potionEffect) {
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
        setStandSlot(idx, this.draggedStack);
        this.draggedStack = temp;
      }
    }
    AudioManager.playItemPickup();
    this.draw();
    manager.saveAll();
  }
}
