import { InventoryContainer } from '@vapour/engine';
import { EventBus } from '../core/EventBus';
import { StorageManager } from '../storage/StorageManager';
import { ItemRegistry } from '../items/ItemRegistry';

export interface ItemStack {
  id: number;
  count: number;
  durability?: number;
  enchantments?: Array<{ type: string; level: number }>;
  potionEffect?: string;
  customName?: string;
  tint?: string;
  team?: string;
}

/** CubeGame's slot layout and persistence adapter. Stack allocation, atomic
 * removal, range queries, batching, and change tracking belong to Vapour. */
export class Inventory {
  private readonly container = new InventoryContainer<ItemStack>({
    slots: 41,
    maxStack: (stack) => this.getMaxStackSize(stack.id),
    canStack: (existing, incoming) => existing.id === incoming.id
      && !existing.customName && !incoming.customName
      && existing.durability === undefined && incoming.durability === undefined
      && !existing.potionEffect && !incoming.potionEffect
      && (!existing.enchantments || existing.enchantments.length === 0)
      && (!incoming.enchantments || incoming.enchantments.length === 0),
    clone: (stack) => ({ ...stack, enchantments: stack.enchantments?.map((entry) => ({ ...entry })) }),
  });
  private activeSlotIndex = 0;

  constructor() {
    this.container.subscribe(() => this.saveToStorage());
    EventBus.on('hotbar:select', (index: number) => {
      this.activeSlotIndex = Math.max(0, Math.min(8, Math.floor(index)));
      EventBus.emit('hotbar:changed', this.activeSlotIndex);
    });
    EventBus.on('hotbar:scroll', (direction: number) => {
      this.activeSlotIndex = (this.activeSlotIndex + direction + 9) % 9;
      EventBus.emit('hotbar:changed', this.activeSlotIndex);
      EventBus.emit('inventory:updated');
    });
  }

  public async loadFromStorage(): Promise<void> {
    const saved = await StorageManager.loadInventory<Array<ItemStack | null>>();
    if (saved && Array.isArray(saved) && saved.length >= 36 && saved.length <= 41 && !this.isLegacyCreativeStarter(saved)) {
      const restored = new Array<ItemStack | null>(41).fill(null);
      for (let index = 0; index < saved.length; index++) {
        const stack = saved[index];
        restored[index] = stack ? { ...stack, id: ItemRegistry.legacyCompat(stack.id) } : null;
      }
      this.container.restore(restored);
    } else {
      this.container.clear();
      this.saveToStorage();
    }
    EventBus.emit('inventory:updated');
  }

  public saveToStorage(): void {
    void StorageManager.saveInventory(this.container.snapshot());
    EventBus.emit('inventory:updated');
  }

  public getSlot(index: number): ItemStack | null { return this.validSlot(index) ? this.container.get(index) : null; }
  public setSlot(index: number, stack: ItemStack | null): void { if (this.validSlot(index)) this.container.set(index, stack); }
  public getActiveSlotIndex(): number { return this.activeSlotIndex; }

  public addItem(id: number, count = 1): number {
    if (!Number.isFinite(id) || !Number.isFinite(count)) return 0;
    const amount = Math.max(0, Math.floor(count));
    if (amount === 0) return 0;
    return this.container.add({ id: Math.max(0, Math.floor(id)), count: amount }, { start: 0, end: 36 })?.count ?? 0;
  }

  public removeItemFromSlot(index: number, amount: number): void {
    if (this.validSlot(index) && Number.isFinite(amount) && amount > 0) this.container.removeFromSlot(index, Math.floor(amount));
  }

  public swapSlots(indexA: number, indexB: number): void {
    if (this.validSlot(indexA) && this.validSlot(indexB)) this.container.swap(indexA, indexB);
  }

  public clear(): void { this.container.clear(); }

  public removeAllByIds(ids: Iterable<number>, includeEquipment = false): void {
    const wanted = new Set(Array.from(ids, (id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0));
    if (wanted.size === 0) return;
    const end = includeEquipment ? 41 : 37;
    this.container.batch(() => {
      for (let slot = 0; slot < end; slot++) {
        if (wanted.has(this.container.get(slot)?.id ?? -1)) this.container.set(slot, null);
      }
    });
  }

  public clearPlayerSlots(includeEquipment = true): void {
    this.container.clear({ start: 0, end: includeEquipment ? 41 : 37 });
  }

  public getMaxStackSize(id: number): number {
    const max = ItemRegistry.getMaxStack(id);
    return Number.isFinite(max) ? Math.max(1, Math.min(64, Math.floor(max))) : 64;
  }

  public findFirstSlotById(id: number, searchEquipment = false): number {
    return this.container.find(id, { start: 0, end: searchEquipment ? 41 : 36 });
  }

  public countItem(id: number, searchEquipment = false): number {
    return this.container.count(id, { start: 0, end: searchEquipment ? 41 : 36 });
  }

  public removeItem(id: number, count = 1, searchEquipment = false): boolean {
    const amount = Math.max(0, Math.floor(count));
    if (amount === 0) return true;
    return this.container.remove(Math.max(0, Math.floor(id)), amount, { start: 0, end: searchEquipment ? 41 : 36 });
  }

  public hasItem(id: number, count = 1, searchEquipment = false): boolean { return this.countItem(id, searchEquipment) >= count; }

  public dropActiveItem(): ItemStack | null {
    const stack = this.container.get(this.activeSlotIndex);
    if (stack) this.container.set(this.activeSlotIndex, null);
    return stack;
  }

  private validSlot(index: number): boolean { return Number.isInteger(index) && index >= 0 && index < 41; }

  private isLegacyCreativeStarter(slots: Array<ItemStack | null>): boolean {
    const exactOldPrefix = slots[0]?.id === 1 && slots[1]?.id === 3 && slots[2]?.id === 4
      && slots[3]?.id === 15 && slots[4]?.id === 10 && slots[5]?.id === 11;
    const oldSamplerIds = new Set([1, 2, 3, 4, 5, 6, 10, 11, 13, 14, 15]);
    const hotbarSamplerStacks = slots.slice(0, 9).filter((slot) => slot && oldSamplerIds.has(slot.id) && slot.count >= 16).length;
    const hasSurvivalItem = slots.some((slot) => slot && slot.id >= 100);
    return exactOldPrefix || (hotbarSamplerStacks >= 6 && !hasSurvivalItem);
  }
}
