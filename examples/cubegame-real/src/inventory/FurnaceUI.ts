import { EventBus } from '../core/EventBus';
import { Inventory, ItemStack } from './Inventory';
import { ItemRegistry } from '../items/ItemRegistry';
import { InputManager } from '../core/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { TextureGenerator } from '../graphics/TextureGenerator';
import { FurnaceManager, FurnaceState } from './FurnaceManager';

export class FurnaceUI {
  private inventory: Inventory;
  private furnaceManager: FurnaceManager;
  private screen!: HTMLElement;
  
  private inputSlot!: HTMLElement;
  private fuelSlot!: HTMLElement;
  private outputSlot!: HTMLElement;
  private invGrid!: HTMLElement;
  private hotbarGrid!: HTMLElement;
  
  private flameEl!: HTMLElement;
  private progressFillEl!: HTMLElement;
  private statusTextEl!: HTMLElement;

  private furnaceState: FurnaceState | null = null;
  private currentFurnacePos: string = '';
  private currentType: string = 'furnace';

  private draggedStack: ItemStack | null = null;
  private draggedEl: HTMLElement;
  private draggedImg: HTMLImageElement;
  private draggedCount: HTMLElement;

  constructor(inventory: Inventory, furnaceManager: FurnaceManager) {
    this.inventory = inventory;
    this.furnaceManager = furnaceManager;

    this.draggedEl    = document.getElementById('dragged-item')!;
    this.draggedImg   = document.getElementById('dragged-item-img') as HTMLImageElement;
    this.draggedCount = document.getElementById('dragged-item-count')!;

    this.bindEvents();

    EventBus.on('ui:openFurnace', (pos: { x: number; y: number; z: number, type?: string }) => this.open(pos));
    EventBus.on('inventory:updated', () => { if (this.isOpen()) this.draw(); });
    EventBus.on('furnace:updated', (data: { x: number; y: number; z: number; state: FurnaceState }) => {
      if (this.isOpen() && this.currentFurnacePos === `${data.x},${data.y},${data.z}`) {
        this.furnaceState = data.state;
        this.draw();
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.draggedStack && this.isOpen()) {
        this.draggedEl.style.left = `${e.clientX - 22}px`;
        this.draggedEl.style.top  = `${e.clientY - 22}px`;
      }
    });
  }

  private initDOM(): void {
    if (!this.invGrid || !this.hotbarGrid) return;

    // Player inventory (indices 9-35)
    this.invGrid.innerHTML = '';
    for (let i = 9; i < 36; i++) {
      this.invGrid.appendChild(this.makeSlot(i, `${this.currentType}-player`));
    }

    // Hotbar (indices 0-8)
    this.hotbarGrid.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      this.hotbarGrid.appendChild(this.makeSlot(i, `${this.currentType}-player`));
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

      if (type === `${this.currentType}-player`) {
        this.handlePlayerClick(idx, isRight, e.shiftKey);
      } else if (type === `${this.currentType}-slot`) {
        this.handleFurnaceSlotClick(idx, isRight);
      }
    });

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'e' || e.key === 'E' || e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      }
    });

    ['furnace', 'blast-furnace', 'smoker'].forEach((t) => {
      const closeBtn = document.getElementById(`${t}-close-btn`);
      if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    });

    window.addEventListener('contextmenu', (e) => {
      if (this.isOpen() && e.target instanceof HTMLElement && e.target.closest('.slot')) {
        e.preventDefault();
      }
    });
  }

  public isOpen(): boolean {
    return !!this.screen && this.screen.style.display === 'flex';
  }

  public open(pos: { x: number; y: number; z: number, type?: string }): void {
    this.currentType = pos.type || 'furnace';
    this.screen         = document.getElementById(`${this.currentType}-screen`)!;
    this.inputSlot      = document.getElementById(`${this.currentType}-input-slot`)!;
    this.fuelSlot       = document.getElementById(`${this.currentType}-fuel-slot`)!;
    this.outputSlot     = document.getElementById(`${this.currentType}-output-slot`)!;
    this.invGrid        = document.getElementById(`${this.currentType}-player-inv`)!;
    this.hotbarGrid     = document.getElementById(`${this.currentType}-player-hotbar`)!;
    
    this.flameEl        = document.getElementById(`${this.currentType}-flame`)!;
    this.progressFillEl = document.getElementById(`${this.currentType}-progress-fill`)!;
    this.statusTextEl   = document.getElementById(`${this.currentType}-status-text`)!;

    this.currentFurnacePos = `${pos.x},${pos.y},${pos.z}`;
    this.furnaceState = this.furnaceManager.getFurnaceState(pos.x, pos.y, pos.z);

    this.initDOM();

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

    if (this.furnaceState) {
      this.furnaceManager.updateFurnaceState(this.furnaceState.x, this.furnaceState.y, this.furnaceState.z, this.furnaceState);
    }

    if (this.screen) {
      this.screen.style.display = 'none';
    }
    InputManager.isUIActive = false;
    InputManager.lockPointer();
  }

  private saveCurrentState(): void {
    if (this.furnaceState) {
      this.furnaceManager.updateFurnaceState(this.furnaceState.x, this.furnaceState.y, this.furnaceState.z, this.furnaceState);
    }
  }

  private draw(): void {
    if (!this.furnaceState) return;

    // Draw input, fuel, output slots
    this.renderSlot(this.inputSlot, this.furnaceState.input);
    this.renderSlot(this.fuelSlot, this.furnaceState.fuel);
    this.renderSlot(this.outputSlot, this.furnaceState.output);

    // Draw player inventory + hotbar
    document.querySelectorAll<HTMLElement>(`.slot[data-type="${this.currentType}-player"]`).forEach(el => {
      this.renderSlot(el, this.inventory.getSlot(parseInt(el.dataset.index!)));
    });

    // Handle dragged item
    if (this.draggedStack) {
      this.draggedEl.style.display = 'flex';
      this.draggedImg.src = TextureGenerator.getItemIconDataURL(this.draggedStack.id);
      this.draggedImg.style.imageRendering = 'pixelated';
      this.draggedCount.textContent = this.draggedStack.count > 1 ? this.draggedStack.count.toString() : '';
    } else {
      this.draggedEl.style.display = 'none';
    }

    // Update flame burning indicator
    if (this.furnaceState.burnTime > 0) {
      this.flameEl.style.opacity = '1.0';
      this.flameEl.textContent = '🔥';
    } else {
      this.flameEl.style.opacity = '0.15';
      this.flameEl.textContent = '🔥';
    }

    // Update cooking progress fill (arrow ➜)
    const cookPercent = Math.min(100, Math.max(0, (this.furnaceState.cookTime / 10.0) * 100));
    this.progressFillEl.style.width = `${cookPercent}%`;

    // Status text
    if (this.furnaceState.burnTime > 0) {
      const remaining = Math.ceil(this.furnaceState.burnTime);
      this.statusTextEl.textContent = `Smelting (${remaining}s)`;
    } else {
      this.statusTextEl.textContent = 'Idle';
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

  private handlePlayerClick(index: number, isRight: boolean, isShift: boolean): void {
    const slotStack = this.inventory.getSlot(index);
    if (!slotStack) {
      if (this.draggedStack) {
        if (isRight) {
          this.inventory.setSlot(index, { id: this.draggedStack.id, count: 1 });
          this.draggedStack.count--;
          if (this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.inventory.setSlot(index, this.draggedStack);
          this.draggedStack = null;
        }
      }
      this.draw();
      this.saveCurrentState();
      return;
    }

    if (isShift && this.furnaceState) {
      // Shift click: move to furnace
      const isFuel = this.furnaceManager.getFuelBurnTime(slotStack.id) > 0;
      let targetSlot: 'fuel' | 'input' | null = null;
      if (isFuel) {
        if (!this.furnaceState.fuel) targetSlot = 'fuel';
        else if (this.furnaceState.fuel.id === slotStack.id) targetSlot = 'fuel';
        else if (!this.furnaceState.input) targetSlot = 'input';
        else if (this.furnaceState.input.id === slotStack.id) targetSlot = 'input';
      } else {
        if (!this.furnaceState.input) targetSlot = 'input';
        else if (this.furnaceState.input.id === slotStack.id) targetSlot = 'input';
      }

      if (targetSlot === 'fuel') {
        const fuel = this.furnaceState.fuel;
        if (!fuel) {
          this.furnaceState.fuel = { ...slotStack };
          this.inventory.setSlot(index, null);
        } else {
          const max = this.inventory.getMaxStackSize(fuel.id);
          const space = max - fuel.count;
          const xfer = Math.min(space, slotStack.count);
          fuel.count += xfer;
          slotStack.count -= xfer;
          if (slotStack.count <= 0) this.inventory.setSlot(index, null);
        }
      } else if (targetSlot === 'input') {
        const input = this.furnaceState.input;
        if (!input) {
          this.furnaceState.input = { ...slotStack };
          this.inventory.setSlot(index, null);
        } else {
          const max = this.inventory.getMaxStackSize(input.id);
          const space = max - input.count;
          const xfer = Math.min(space, slotStack.count);
          input.count += xfer;
          slotStack.count -= xfer;
          if (slotStack.count <= 0) this.inventory.setSlot(index, null);
        }
      }
      AudioManager.playItemPickup();
      this.draw();
      this.saveCurrentState();
      return;
    }

    if (!this.draggedStack) {
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half };
        this.inventory.removeItemFromSlot(index, half);
      } else {
        this.draggedStack = { ...slotStack };
        this.inventory.setSlot(index, null);
      }
    } else {
      if (slotStack.id === this.draggedStack.id) {
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
    this.saveCurrentState();
  }

  private handleFurnaceSlotClick(idx: number, isRight: boolean): void {
    if (!this.furnaceState) return;

    if (idx === 2) {
      // Output slot is read-only for placing
      const output = this.furnaceState.output;
      if (!output) return;

      if (!this.draggedStack) {
        this.draggedStack = { ...output };
        this.furnaceState.output = null;
        this.claimXp();
      } else if (this.draggedStack.id === output.id) {
        const max = this.inventory.getMaxStackSize(output.id);
        const space = max - this.draggedStack.count;
        const xfer = Math.min(space, output.count);
        this.draggedStack.count += xfer;
        output.count -= xfer;
        if (output.count <= 0) {
          this.furnaceState.output = null;
        }
        this.claimXp();
      }
      AudioManager.playItemPickup();
      this.draw();
      this.saveCurrentState();
      return;
    }

    // Input (0) and Fuel (1) slots
    let slotStack = idx === 0 ? this.furnaceState.input : this.furnaceState.fuel;

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half };
        slotStack.count -= half;
        if (slotStack.count <= 0) {
          if (idx === 0) this.furnaceState.input = null;
          else this.furnaceState.fuel = null;
        }
      } else {
        this.draggedStack = { ...slotStack };
        if (idx === 0) this.furnaceState.input = null;
        else this.furnaceState.fuel = null;
      }
    } else {
      if (idx === 1) {
        // Fuel validation
        if (this.furnaceManager.getFuelBurnTime(this.draggedStack.id) === 0) {
          EventBus.emit('network:chat', `[System] That is not a valid Fuel!`);
          return;
        }
      } else if (idx === 0) {
        // Recipe validation (optional, allows putting anything in input but only cooks recipes)
      }

      if (!slotStack) {
        if (isRight) {
          const newStack = { id: this.draggedStack.id, count: 1 };
          if (idx === 0) this.furnaceState.input = newStack;
          else this.furnaceState.fuel = newStack;
          this.draggedStack.count--;
          if (this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          if (idx === 0) this.furnaceState.input = this.draggedStack;
          else this.furnaceState.fuel = this.draggedStack;
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
        if (idx === 0) this.furnaceState.input = this.draggedStack;
        else this.furnaceState.fuel = this.draggedStack;
        this.draggedStack = temp;
      }
    }
    this.draw();
    this.saveCurrentState();
  }

  private claimXp(): void {
    if (this.furnaceState && this.furnaceState.xpReward > 0) {
      const pc = (window as any).gamePlayerController;
      if (pc) {
        const xp = Math.round(this.furnaceState.xpReward * 10) / 10;
        pc.addXp(xp);
        EventBus.emit('network:chat', `[System] Gained ${xp} experience from smelting!`);
      }
      this.furnaceState.xpReward = 0;
    }
  }
}
