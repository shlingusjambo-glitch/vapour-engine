import { EventBus } from '../core/EventBus';
import { Inventory, ItemStack } from './Inventory';
import { ItemRegistry } from '../items/ItemRegistry';
import { BlockRegistry } from '../world/BlockRegistry';
import { InputManager } from '../core/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { TextureGenerator } from '../graphics/TextureGenerator';

export class AnvilUI {
  private inventory: Inventory;

  private screen: HTMLElement;
  private playerInvGrid: HTMLElement;
  private playerHotbarGrid: HTMLElement;

  private inputSlot0: HTMLElement;
  private inputSlot1: HTMLElement;
  private resultSlot: HTMLElement;

  private renameInput: HTMLInputElement;
  private costLabel: HTMLElement;

  private standSlots: Array<ItemStack | null> = [null, null, null]; // 0: Input A, 1: Input B, 2: Result

  private draggedStack: ItemStack | null = null;
  private draggedEl: HTMLElement;
  private draggedImg: HTMLImageElement;
  private draggedCount: HTMLElement;

  private calculatedCost: number = 0;

  constructor(inventory: Inventory) {
    this.inventory = inventory;

    this.screen = document.getElementById('anvil-screen')!;
    this.playerInvGrid = document.getElementById('anvil-player-inv')!;
    this.playerHotbarGrid = document.getElementById('anvil-player-hotbar')!;

    this.inputSlot0 = document.getElementById('anvil-input-slot-0')!;
    this.inputSlot1 = document.getElementById('anvil-input-slot-1')!;
    this.resultSlot = document.getElementById('anvil-result-slot')!;

    this.renameInput = document.getElementById('anvil-rename-input') as HTMLInputElement;
    this.costLabel = document.getElementById('anvil-cost-label')!;

    this.draggedEl = document.getElementById('dragged-item')!;
    this.draggedImg = document.getElementById('dragged-item-img') as HTMLImageElement;
    this.draggedCount = document.getElementById('dragged-item-count')!;

    this.initDOM();
    this.bindEvents();

    EventBus.on('ui:openAnvil', () => this.open());
    EventBus.on('inventory:updated', () => { if (this.isOpen()) this.draw(); });

    window.addEventListener('mousemove', (e) => {
      if (this.draggedStack) {
        this.draggedEl.style.left = `${e.clientX - 22}px`;
        this.draggedEl.style.top  = `${e.clientY - 22}px`;
      }
    });
  }

  private initDOM(): void {
    this.playerInvGrid.innerHTML = '';
    for (let i = 9; i < 36; i++) {
      this.playerInvGrid.appendChild(this.makeSlot(i, 'anvil-inventory'));
    }

    this.playerHotbarGrid.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      this.playerHotbarGrid.appendChild(this.makeSlot(i, 'anvil-inventory'));
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

      if (type === 'anvil-inventory') {
        this.handleInvClick(idx, isRight, e.shiftKey);
      } else if (type === 'anvil-slot') {
        this.handleTableClick(idx, isRight);
      }
    });

    this.renameInput.addEventListener('input', () => {
      this.updateAnvilRecipe();
      this.drawTableSlots();
    });

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (document.activeElement === this.renameInput) {
        if (e.key === 'Escape' || e.key === 'Enter') {
          this.renameInput.blur();
        }
        return;
      }
      if (e.key === 'e' || e.key === 'E' || e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    const closeBtn = document.getElementById('anvil-close-btn');
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
    this.renameInput.value = '';
    this.standSlots.fill(null);
    this.calculatedCost = 0;
    this.costLabel.style.display = 'none';
    this.draw();
  }

  public close(): void {
    for (let i = 0; i < 2; i++) {
      const s = this.standSlots[i];
      if (s) {
        this.inventory.addItem(s.id, s.count);
        this.standSlots[i] = null;
      }
    }
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
    document.querySelectorAll<HTMLElement>('.slot[data-type="anvil-inventory"]').forEach((slotEl) => {
      const idx = parseInt(slotEl.dataset.index!);
      this.renderSlotItem(slotEl, this.inventory.getSlot(idx));
    });

    this.drawTableSlots();

    if (this.draggedStack) {
      this.draggedEl.style.display = 'flex';
      this.draggedImg.src = TextureGenerator.getItemIconDataURL(this.draggedStack.id);
      this.draggedCount.textContent = this.draggedStack.count > 1 ? this.draggedStack.count.toString() : '';
    } else {
      this.draggedEl.style.display = 'none';
    }
  }

  private drawTableSlots(): void {
    this.renderSlotItem(this.inputSlot0, this.standSlots[0]);
    this.renderSlotItem(this.inputSlot1, this.standSlots[1]);
    this.renderSlotItem(this.resultSlot, this.standSlots[2]);

    if (this.calculatedCost > 0) {
      this.costLabel.textContent = `Enchantment Cost: ${this.calculatedCost} Level${this.calculatedCost > 1 ? 's' : ''}`;
      this.costLabel.style.display = 'block';
    } else {
      this.costLabel.style.display = 'none';
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

  private updateAnvilRecipe(): void {
    const itemA = this.standSlots[0];
    const itemB = this.standSlots[1];
    const renameText = this.renameInput.value.trim();

    if (!itemA) {
      this.standSlots[2] = null;
      this.calculatedCost = 0;
      return;
    }

    let result: ItemStack = JSON.parse(JSON.stringify(itemA));
    let cost = 0;

    const defA = ItemRegistry.get(itemA.id);
    if (!defA) {
      this.standSlots[2] = null;
      this.calculatedCost = 0;
      return;
    }

    // 1. Check Renaming
    let isRenamed = false;
    if (renameText !== '' && renameText !== (itemA as any).customName) {
      (result as any).customName = renameText;
      cost += 1;
      isRenamed = true;
    }

    // 2. Check Combining / Repairing
    if (itemB) {
      const defB = ItemRegistry.get(itemB.id);
      if (!defB) {
        this.standSlots[2] = null;
        this.calculatedCost = 0;
        return;
      }

      // A. Combine similar tools
      if (ItemRegistry.isTool(itemA.id) && itemB.id === itemA.id) {
        const durA = itemA.durability ?? defA.durability;
        const durB = itemB.durability ?? defB.durability;
        const bonus = Math.floor(defA.durability * 0.12);
        result.durability = Math.min(defA.durability, durA + durB + bonus);

        // Combine enchantments
        const enchantMap = new Map<string, number>();
        const addEnchants = (enchants: any[]) => {
          if (!enchants) return;
          for (const e of enchants) {
            const current = enchantMap.get(e.type) || 0;
            if (e.level === current) {
              enchantMap.set(e.type, Math.min(3, e.level + 1)); // Cap level at 3
            } else {
              enchantMap.set(e.type, Math.max(current, e.level));
            }
          }
        };

        addEnchants(itemA.enchantments || []);
        addEnchants(itemB.enchantments || []);
        result.enchantments = Array.from(enchantMap.entries()).map(([type, level]) => ({ type, level }));

        cost += 2 + (result.enchantments.length * 2);
      }
      // B. Repair tool with resource
      else if (ItemRegistry.isTool(itemA.id) && this.isRepairMaterial(itemA.id, itemB.id)) {
        const curDur = itemA.durability ?? defA.durability;
        if (curDur < defA.durability) {
          const repairAmount = Math.floor(defA.durability * 0.25);
          result.durability = Math.min(defA.durability, curDur + repairAmount);
          cost += 2;
        } else {
          // Tool is already full durability
          this.standSlots[2] = null;
          this.calculatedCost = 0;
          return;
        }
      } else {
        // Incompatible combination
        this.standSlots[2] = null;
        this.calculatedCost = 0;
        return;
      }
    }

    if (cost > 0) {
      this.standSlots[2] = result;
      this.calculatedCost = cost;
    } else {
      this.standSlots[2] = null;
      this.calculatedCost = 0;
    }
  }

  private isRepairMaterial(toolId: number, matId: number): boolean {
    const name = ItemRegistry.getName(toolId) || '';
    const matName = ItemRegistry.getName(matId) || '';

    if (name.includes('Copper') && matName.includes('Copper Ingot')) return true;
    if (name.includes('Tin') && matName.includes('Tin Ingot')) return true;
    if (name.includes('Silver') && matName.includes('Silver Ingot')) return true;
    if (name.includes('Ruby') && matName.includes('Ruby')) return true;
    if (name.includes('Sapphire') && matName.includes('Sapphire')) return true;
    if (name.includes('Ancient') && matName.includes('Ancient Alloy Ingot')) return true;
    if (name.includes('Iron') && matName.includes('Iron Ingot')) return true;
    if (name.includes('Gold') && matName.includes('Gold Ingot')) return true;
    if (name.includes('Diamond') && matName.includes('Diamond')) return true;

    return false;
  }

  private handleInvClick(idx: number, isRight: boolean, isShift: boolean): void {
    const slotStack = this.inventory.getSlot(idx);

    if (isShift && !this.draggedStack && slotStack) {
      const isTool = ItemRegistry.isTool(slotStack.id);
      if (isTool) {
        if (!this.standSlots[0]) {
          this.standSlots[0] = { ...slotStack };
          this.inventory.setSlot(idx, null);
        } else if (!this.standSlots[1]) {
          this.standSlots[1] = { ...slotStack };
          this.inventory.setSlot(idx, null);
        }
      } else {
        if (!this.standSlots[1]) {
          this.standSlots[1] = { ...slotStack };
          this.inventory.setSlot(idx, null);
        }
      }
      AudioManager.playItemPickup();
      this.updateAnvilRecipe();
      this.draw();
      return;
    }

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half, durability: slotStack.durability, enchantments: slotStack.enchantments, customName: (slotStack as any).customName };
        this.inventory.removeItemFromSlot(idx, half);
      } else {
        this.draggedStack = { ...slotStack };
        this.inventory.setSlot(idx, null);
      }
    } else {
      if (!slotStack) {
        if (isRight) {
          this.inventory.setSlot(idx, { id: this.draggedStack.id, count: 1, durability: this.draggedStack.durability, enchantments: this.draggedStack.enchantments, customName: (this.draggedStack as any).customName });
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
    this.updateAnvilRecipe();
    this.draw();
  }

  private handleTableClick(idx: number, isRight: boolean): void {
    const slotStack = this.standSlots[idx];

    // Clicked Output Slot (Result)
    if (idx === 2) {
      if (slotStack && !this.draggedStack) {
        const playerController = (window as any).gamePlayerController;
        if (!playerController) return;

        if (playerController.level < this.calculatedCost) {
          AudioManager.playToolBreak(); // error buzz
          return;
        }

        // Deduct XP levels
        playerController.level -= this.calculatedCost;
        const xpNeeded = 100 + playerController.level * 50;
        EventBus.emit('player:xpChanged', { xp: playerController.xp, level: playerController.level, max: xpNeeded });

        // Collect result
        this.draggedStack = slotStack;
        this.standSlots[2] = null;

        // Consume inputs
        this.consumeTableInputs();

        this.calculatedCost = 0;
        AudioManager.playPlace('stone'); // metallic strike fallback
        this.updateAnvilRecipe();
        this.draw();
      }
      return;
    }

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half, durability: slotStack.durability, enchantments: slotStack.enchantments, customName: (slotStack as any).customName };
        slotStack.count -= half;
        if (slotStack.count <= 0) this.standSlots[idx] = null;
      } else {
        this.draggedStack = { ...slotStack };
        this.standSlots[idx] = null;
      }
    } else {
      if (!slotStack) {
        if (isRight) {
          this.standSlots[idx] = { id: this.draggedStack.id, count: 1, durability: this.draggedStack.durability, enchantments: this.draggedStack.enchantments, customName: (this.draggedStack as any).customName };
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.standSlots[idx] = this.draggedStack;
          this.draggedStack = null;
        }
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
        this.standSlots[idx] = this.draggedStack;
        this.draggedStack = temp;
      }
    }
    AudioManager.playItemPickup();
    this.updateAnvilRecipe();
    this.draw();
  }

  private consumeTableInputs(): void {
    // Consume 1 unit from Slot 0
    if (this.standSlots[0]) {
      this.standSlots[0].count--;
      if (this.standSlots[0].count <= 0) this.standSlots[0] = null;
    }
    // Consume 1 unit from Slot 1
    if (this.standSlots[1]) {
      this.standSlots[1].count--;
      if (this.standSlots[1].count <= 0) this.standSlots[1] = null;
    }
  }
}
