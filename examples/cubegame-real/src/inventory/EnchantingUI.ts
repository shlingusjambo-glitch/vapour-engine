import { EventBus } from '../core/EventBus';
import { Inventory, ItemStack } from './Inventory';
import { ItemRegistry } from '../items/ItemRegistry';
import { BlockRegistry } from '../world/BlockRegistry';
import { InputManager } from '../core/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { TextureGenerator } from '../graphics/TextureGenerator';

interface EnchantmentOption {
  name: string;
  effect: string;
  level: number;
  cost: number;
}

export class EnchantingUI {
  private inventory: Inventory;

  private screen: HTMLElement;
  private playerInvGrid: HTMLElement;
  private playerHotbarGrid: HTMLElement;

  private itemSlot: HTMLElement;
  private lapisSlot: HTMLElement;

  private offers: HTMLElement[] = [];
  private offerTexts: HTMLElement[] = [];
  private offerCosts: HTMLElement[] = [];

  private standSlots: Array<ItemStack | null> = [null, null]; // 0: Item, 1: Lapis

  private currentOptions: EnchantmentOption[] = [];

  private draggedStack: ItemStack | null = null;
  private draggedEl: HTMLElement;
  private draggedImg: HTMLImageElement;
  private draggedCount: HTMLElement;

  constructor(inventory: Inventory) {
    this.inventory = inventory;

    this.screen = document.getElementById('enchanting-screen')!;
    this.playerInvGrid = document.getElementById('enchant-player-inv')!;
    this.playerHotbarGrid = document.getElementById('enchant-player-hotbar')!;

    this.itemSlot = document.getElementById('enchant-item-slot')!;
    this.lapisSlot = document.getElementById('enchant-lapis-slot')!;

    for (let i = 1; i <= 3; i++) {
      this.offers.push(document.getElementById(`enchant-offer-${i}`)!);
      this.offerTexts.push(document.getElementById(`enchant-offer-text-${i}`)!);
      this.offerCosts.push(document.getElementById(`enchant-offer-cost-${i}`)!);
    }

    this.draggedEl = document.getElementById('dragged-item')!;
    this.draggedImg = document.getElementById('dragged-item-img') as HTMLImageElement;
    this.draggedCount = document.getElementById('dragged-item-count')!;

    this.initDOM();
    this.bindEvents();

    EventBus.on('ui:openEnchantingTable', () => this.open());
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
      this.playerInvGrid.appendChild(this.makeSlot(i, 'enchant-inventory'));
    }

    this.playerHotbarGrid.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      this.playerHotbarGrid.appendChild(this.makeSlot(i, 'enchant-inventory'));
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

      if (type === 'enchant-inventory') {
        this.handleInvClick(idx, isRight, e.shiftKey);
      } else if (type === 'enchant-slot') {
        this.handleTableClick(idx, isRight);
      }
    });

    // Close on escape/e
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;
      if (e.key === 'e' || e.key === 'E' || e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });

    const closeBtn = document.getElementById('enchant-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    // Offer selections
    this.offers.forEach((offerEl, idx) => {
      offerEl.addEventListener('click', () => this.selectOffer(idx));
    });

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
    // Return items to inventory
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
    // Render inventory
    document.querySelectorAll<HTMLElement>('.slot[data-type="enchant-inventory"]').forEach((slotEl) => {
      const idx = parseInt(slotEl.dataset.index!);
      this.renderSlotItem(slotEl, this.inventory.getSlot(idx));
    });

    // Render table slots
    this.renderSlotItem(this.itemSlot, this.standSlots[0]);
    this.renderSlotItem(this.lapisSlot, this.standSlots[1]);

    if (this.draggedStack) {
      this.draggedEl.style.display = 'flex';
      this.draggedImg.src = TextureGenerator.getItemIconDataURL(this.draggedStack.id);
      this.draggedCount.textContent = this.draggedStack.count > 1 ? this.draggedStack.count.toString() : '';
    } else {
      this.draggedEl.style.display = 'none';
    }

    this.updateOptions();
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

  private updateOptions(): void {
    const item = this.standSlots[0];
    const lapis = this.standSlots[1];

    const lapisId = 399; // Lapis Lazuli

    const hasItem = item && ItemRegistry.isTool(item.id);
    const hasLapis = lapis && lapis.id === lapisId && lapis.count > 0;

    if (!hasItem) {
      this.currentOptions = [];
      this.offers.forEach((el, idx) => {
        el.style.borderColor = '#444';
        el.style.background = 'rgba(255,255,255,0.02)';
        this.offerTexts[idx].textContent = 'Place an item to enchant';
        this.offerCosts[idx].textContent = '';
      });
      return;
    }

    // Generate option templates if empty
    if (this.currentOptions.length === 0) {
      const toolType = ItemRegistry.getToolType(item!.id);
      let possibleEffects = ['unbreaking', 'efficiency'];
      if (toolType === 'sword') possibleEffects = ['sharpness', 'knockback', 'fire_aspect'];
      else if (toolType === 'armor') possibleEffects = ['protection', 'feather_falling'];

      const getRandEffect = () => possibleEffects[Math.floor(Math.random() * possibleEffects.length)];

      this.currentOptions = [
        { name: 'Enchantment I', effect: getRandEffect(), level: 1, cost: 1 },
        { name: 'Enchantment II', effect: getRandEffect(), level: Math.random() > 0.4 ? 2 : 1, cost: 2 },
        { name: 'Enchantment III', effect: getRandEffect(), level: Math.random() > 0.5 ? 3 : 2, cost: 3 }
      ];
    }

    const playerLvl = (window as any).gamePlayerController?.level ?? 0;

    this.offers.forEach((el, idx) => {
      const opt = this.currentOptions[idx];
      const name = opt.effect.replace('_', ' ').toUpperCase();
      const roman = opt.level === 1 ? 'I' : opt.level === 2 ? 'II' : 'III';
      
      const lapisCount = lapis ? lapis.count : 0;
      const canAfford = playerLvl >= opt.cost && lapisCount >= opt.cost;

      this.offerTexts[idx].textContent = `${name} ${roman}`;
      this.offerCosts[idx].textContent = `Cost: ${opt.cost} Level${opt.cost > 1 ? 's' : ''} + ${opt.cost} Lapis`;

      if (canAfford) {
        el.style.borderColor = '#a832b2';
        el.style.background = 'rgba(168, 50, 178, 0.08)';
      } else {
        el.style.borderColor = '#444';
        el.style.background = 'rgba(255,255,255,0.02)';
      }
    });
  }

  private selectOffer(idx: number): void {
    const item = this.standSlots[0];
    const lapis = this.standSlots[1];
    if (!item || !lapis) return;

    const opt = this.currentOptions[idx];
    if (!opt) return;

    const playerController = (window as any).gamePlayerController;
    if (!playerController) return;

    const lapisCount = lapis.count;
    const canAfford = playerController.level >= opt.cost && lapisCount >= opt.cost;

    if (!canAfford) {
      AudioManager.playToolBreak(); // error buzz
      return;
    }

    // Deduct cost
    playerController.level -= opt.cost;
    lapis.count -= opt.cost;
    if (lapis.count <= 0) this.standSlots[1] = null;

    // Apply Enchantment metadata
    if (!item.enchantments) {
      item.enchantments = [];
    }
    const existingIdx = item.enchantments.findIndex(e => e.type === opt.effect);
    if (existingIdx !== -1) {
      item.enchantments[existingIdx].level = Math.max(item.enchantments[existingIdx].level, opt.level);
    } else {
      item.enchantments.push({ type: opt.effect, level: opt.level });
    }

    // Trigger visual/audio feedback
    AudioManager.playLevelUp();
    EventBus.emit('network:chat', `[System] Enchanted item with ${opt.effect.toUpperCase()} ${opt.level}`);

    // Update level UI
    const xpNeeded = 100 + playerController.level * 50;
    EventBus.emit('player:xpChanged', { xp: playerController.xp, level: playerController.level, max: xpNeeded });

    // Reset current options
    this.currentOptions = [];
    this.draw();
  }

  private handleInvClick(idx: number, isRight: boolean, isShift: boolean): void {
    const slotStack = this.inventory.getSlot(idx);

    if (isShift && !this.draggedStack && slotStack) {
      const isLapis = slotStack.id === 399;
      const isTool = ItemRegistry.isTool(slotStack.id);

      if (isLapis) {
        if (!this.standSlots[1]) {
          this.standSlots[1] = { ...slotStack };
          this.inventory.setSlot(idx, null);
        } else {
          const max = this.inventory.getMaxStackSize(399);
          const xfer = Math.min(max - this.standSlots[1].count, slotStack.count);
          this.standSlots[1].count += xfer;
          this.inventory.removeItemFromSlot(idx, xfer);
        }
      } else if (isTool) {
        if (!this.standSlots[0]) {
          this.standSlots[0] = { ...slotStack };
          this.inventory.setSlot(idx, null);
          this.currentOptions = [];
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
        this.draggedStack = { id: slotStack.id, count: half, durability: slotStack.durability, enchantments: slotStack.enchantments };
        this.inventory.removeItemFromSlot(idx, half);
      } else {
        this.draggedStack = { ...slotStack };
        this.inventory.setSlot(idx, null);
      }
    } else {
      if (!slotStack) {
        if (isRight) {
          this.inventory.setSlot(idx, { id: this.draggedStack.id, count: 1, durability: this.draggedStack.durability, enchantments: this.draggedStack.enchantments });
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
    const slotStack = this.standSlots[idx];

    if (!this.draggedStack) {
      if (!slotStack) return;
      if (isRight) {
        const half = Math.ceil(slotStack.count / 2);
        this.draggedStack = { id: slotStack.id, count: half, durability: slotStack.durability, enchantments: slotStack.enchantments };
        slotStack.count -= half;
        if (slotStack.count <= 0) this.standSlots[idx] = null;
      } else {
        this.draggedStack = { ...slotStack };
        this.standSlots[idx] = null;
      }
      if (idx === 0) this.currentOptions = [];
    } else {
      if (!slotStack) {
        if (isRight) {
          this.standSlots[idx] = { id: this.draggedStack.id, count: 1, durability: this.draggedStack.durability, enchantments: this.draggedStack.enchantments };
          if (--this.draggedStack.count <= 0) this.draggedStack = null;
        } else {
          this.standSlots[idx] = this.draggedStack;
          this.draggedStack = null;
        }
        if (idx === 0) this.currentOptions = [];
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
        if (idx === 0) this.currentOptions = [];
      }
    }
    AudioManager.playItemPickup();
    this.draw();
  }
}
