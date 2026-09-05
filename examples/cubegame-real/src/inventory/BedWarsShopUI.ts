import { EventBus } from '../core/EventBus';
import { InputManager } from '../core/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { Inventory, ItemStack } from './Inventory';
import { ItemRegistry } from '../items/ItemRegistry';
import { BlockRegistry } from '../world/BlockRegistry';
import { TextureGenerator } from '../graphics/TextureGenerator';
import { getFeatureBlockId, getFeatureItemId } from '../content/FeatureCatalog';

type TeamName = 'Red' | 'Blue' | 'Green' | 'Yellow';
type CurrencyName = 'Iron Ingot' | 'Gold Ingot' | 'Diamond' | 'Emerald';
type ShopKind = 'itemShop' | 'teamUpgrades';
type OfferKind = 'stack' | 'tiered' | 'permanent' | 'armor' | 'teamUpgrade';

interface ShopCost {
  itemId: number;
  count: number;
  label: string;
}

interface ShopOffer {
  slot: number;
  title: string;
  category: string;
  description: string;
  iconId: number;
  kind: OfferKind;
  cost: ShopCost;
  count?: number;
  itemId?: number;
  tiers?: number[];
  tierCosts?: ShopCost[];
  armorSet?: Array<{ slot: number; itemId: number; customName: string }>;
  upgradeKey?: string;
  maxLevel?: number;
}

interface OpenShopPayload {
  team?: TeamName;
  villagerId?: string;
  kind?: ShopKind;
}

const IRON = 202;
const GOLD = 203;
const DIAMOND = 204;

function itemId(name: string, fallback = 0): number {
  return getFeatureItemId(name) || fallback;
}

function blockId(name: string, fallback = 0): number {
  return getFeatureBlockId(name) || fallback;
}

function displayName(id: number): string {
  return ItemRegistry.getName(id) || BlockRegistry.get(id)?.name || `Item #${id}`;
}

export class BedWarsShopUI {
  private screen: HTMLDivElement;
  private grid: HTMLDivElement;
  private detailTitle: HTMLDivElement;
  private detailBody: HTMLDivElement;
  private status: HTMLDivElement;
  private currentTeam: TeamName = 'Red';
  private currentKind: ShopKind = 'itemShop';
  private offers: ShopOffer[] = [];
  private readonly currencyIds: Record<CurrencyName, number>;
  private readonly teamUpgrades = new Map<string, number>();

  constructor(private inventory: Inventory) {
    this.currencyIds = {
      'Iron Ingot': IRON,
      'Gold Ingot': GOLD,
      'Diamond': DIAMOND,
      'Emerald': itemId('Emerald', 471),
    };

    this.screen = document.createElement('div');
    this.screen.id = 'bedwars-shop-screen';
    this.screen.style.cssText = `
      position:fixed;inset:0;display:none;z-index:4600;align-items:center;justify-content:center;
      background:rgba(0,0,0,.45);font-family:monospace;color:#f4f4f4;pointer-events:auto;`;

    const panel = document.createElement('div');
    panel.style.cssText = `
      width:min(1040px,94vw);height:min(720px,90vh);background:#c6c6c6;color:#111;
      border:6px solid #111;box-shadow:0 18px 42px rgba(0,0,0,.5);padding:18px;box-sizing:border-box;
      user-select:none;-webkit-user-select:none;`;

    const title = document.createElement('div');
    title.id = 'bedwars-shop-title';
    title.style.cssText = 'font-size:22px;letter-spacing:2px;text-align:center;margin:0 0 12px;color:#222;';
    panel.appendChild(title);

    const body = document.createElement('div');
    body.style.cssText = 'display:grid;grid-template-columns:1fr minmax(220px,280px);gap:16px;height:calc(100% - 52px);';

    this.grid = document.createElement('div');
    this.grid.style.cssText = `
      display:grid;grid-template-columns:repeat(9,minmax(48px,64px));grid-auto-rows:minmax(48px,64px);gap:6px;align-content:start;
      background:#8b8b8b;border:4px solid #222;padding:12px;overflow:auto;`;
    body.appendChild(this.grid);

    const side = document.createElement('div');
    side.style.cssText = 'background:#9a9a9a;border:4px solid #222;padding:12px;display:flex;flex-direction:column;gap:10px;min-width:0;';
    this.detailTitle = document.createElement('div');
    this.detailTitle.style.cssText = 'font-size:17px;color:#fff;text-shadow:2px 2px #333;min-height:24px;';
    this.detailBody = document.createElement('div');
    this.detailBody.style.cssText = 'font-size:12px;line-height:1.45;color:#111;white-space:pre-line;flex:1;overflow:auto;';
    this.status = document.createElement('div');
    this.status.style.cssText = 'font-size:12px;color:#fff;background:#333;padding:8px;min-height:42px;';
    const close = document.createElement('button');
    close.textContent = 'Close Shop';
    close.style.cssText = 'height:42px;border:3px solid #111;background:#777;color:white;font-weight:bold;cursor:pointer;';
    close.onclick = () => this.close();
    side.append(this.detailTitle, this.detailBody, this.status, close);
    body.appendChild(side);
    panel.appendChild(body);
    this.screen.appendChild(panel);
    document.body.appendChild(this.screen);

    EventBus.on('ui:openBedWarsShop', (payload?: OpenShopPayload) => this.open(payload));
    document.addEventListener('keydown', (e) => {
      if (this.screen.style.display !== 'none' && (e.key === 'Escape' || e.key.toLowerCase() === 'e')) {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    }, true);
  }

  public open(payload?: OpenShopPayload): void {
    this.currentTeam = payload?.team || 'Red';
    this.currentKind = payload?.kind || 'itemShop';
    this.offers = this.currentKind === 'teamUpgrades' ? this.buildTeamUpgradeOffers() : this.buildItemShopOffers(this.currentTeam);
    this.render();
    this.screen.style.display = 'flex';
    InputManager.unlockPointer();
    AudioManager.playMenuOpen();
  }

  public close(): void {
    if (this.screen.style.display === 'none') return;
    this.screen.style.display = 'none';
    AudioManager.playMenuClose();
  }

  private buildItemShopOffers(team: TeamName): ShopOffer[] {
    const wool = this.teamWoolId(team);
    const endStone = blockId('End Stone', 13);
    const glass = blockId('Glass', 11);
    const ladder = blockId('Ladder', itemId('Ladder', 0));
    const planks = blockId('Oak Planks', 15) || 15;
    const tnt = blockId('TNT', 0) || itemId('TNT', 0) || 209;
    const fireCharge = itemId('Fire Charge', 0) || 209;
    const enderPearl = itemId('Ender Pearl', 0) || itemId('Eye of Ender', 0) || 471;
    const invisPotion = itemId('Invisibility Potion', 0) || itemId('Potion', 0) || 285;
    const shears = itemId('Shears', 238);
    const bow = 270;
    const arrows = 211;
    const goldenApple = 285;

    return [
      this.stack(0, 'Wool x16', 'Blocks', `Fast bridge block. Automatically uses ${team} team color.`, wool, 'Iron Ingot', 4, 16),
      this.stack(1, 'Oak Planks x16', 'Blocks', 'Basic bed-defense block.', planks, 'Gold Ingot', 4, 16),
      this.stack(2, 'End Stone x12', 'Blocks', 'Harder bed-defense block.', endStone, 'Iron Ingot', 24, 12),
      this.stack(3, 'Blast-Proof Glass x4', 'Blocks', 'Anti-TNT bed defense.', glass, 'Iron Ingot', 12, 4),
      this.stack(4, 'Ladder x8', 'Blocks', 'Cheap vertical pathing and clutching.', ladder, 'Iron Ingot', 4, 8),

      this.tiered(9, 'Sword Upgrade', 'Melee', 'Wood → Stone → Iron → Diamond. Upgrades your sword instead of duplicating it.', 250, [250, 251, 252, 254], [
        this.cost('Iron Ingot', 0),
        this.cost('Iron Ingot', 10),
        this.cost('Gold Ingot', 7),
        this.cost('Emerald', 4),
      ]),
      this.stack(10, 'Bow', 'Ranged', 'Basic bow.', bow, 'Gold Ingot', 12, 1, 'permanent'),
      this.stack(11, 'Arrows x8', 'Ranged', 'Ammo bundle.', arrows, 'Gold Ingot', 2, 8),

      this.tiered(18, 'Pickaxe Upgrade', 'Tools', 'Wood → Stone → Iron → Diamond. One tool slot upgrades forward.', 220, [220, 221, 222, 224], [
        this.cost('Iron Ingot', 10),
        this.cost('Iron Ingot', 10),
        this.cost('Gold Ingot', 3),
        this.cost('Gold Ingot', 6),
      ]),
      this.tiered(19, 'Axe Upgrade', 'Tools', 'Wood → Stone → Iron → Diamond. Replaces the old axe tier.', 230, [230, 231, 232, 234], [
        this.cost('Iron Ingot', 10),
        this.cost('Iron Ingot', 10),
        this.cost('Gold Ingot', 3),
        this.cost('Gold Ingot', 6),
      ]),
      this.stack(20, 'Shears', 'Tools', 'Permanent shears. Buying again will not duplicate.', shears, 'Iron Ingot', 20, 1, 'permanent'),

      this.armor(27, 'Copper Armor', 'Armor', 'Permanent armor upgrade.', itemId('Copper Boots', 0) || 0, 'Iron Ingot', 40, 'Copper'),
      this.armor(28, 'Iron Armor', 'Armor', 'Permanent armor upgrade.', itemId('Iron Chestplate', 0) || 0, 'Gold Ingot', 12, 'Iron'),
      this.armor(29, 'Diamond Armor', 'Armor', 'Permanent armor upgrade.', itemId('Diamond Chestplate', 0) || 0, 'Emerald', 6, 'Diamond'),

      this.stack(36, 'TNT', 'Utility', 'Explosive bed-defense breaker.', tnt, 'Gold Ingot', 8, 1),
      this.stack(37, 'Fire Charge', 'Utility', 'Ranged knockback pressure tool.', fireCharge, 'Iron Ingot', 40, 1),
      this.stack(38, 'Golden Apple', 'Utility', 'Combat healing food.', goldenApple, 'Gold Ingot', 3, 1),
      this.stack(39, 'Ender Pearl', 'Utility', 'Teleport clutch and bed-rush tool.', enderPearl, 'Emerald', 4, 1),
      this.stack(40, 'Invisibility Potion', 'Utility', 'Sneak into bases. Placeholder potion item if the potion asset is unavailable.', invisPotion, 'Emerald', 2, 1),
    ].filter((offer) => offer.iconId > 0);
  }

  private buildTeamUpgradeOffers(): ShopOffer[] {
    return [
      this.teamUpgrade(10, 'Sharpened Swords', 'Team Upgrades', 'Applies one shared sword damage upgrade for your team.', 254, 'Diamond', 4, 'sharpness', 1),
      this.teamUpgrade(12, 'Reinforced Armor', 'Team Upgrades', 'Team armor protection. Can be purchased up to tier 4.', itemId('Diamond Chestplate', 0), 'Diamond', 2, 'protection', 4),
      this.teamUpgrade(14, 'Haste', 'Team Upgrades', 'Faster block breaking around fights and bed defense.', 222, 'Diamond', 2, 'haste', 2),
      this.teamUpgrade(28, 'Forge Upgrade', 'Team Upgrades', 'Increases base generator pressure. Can be purchased up to tier 4.', blockId('Gold Block', 32), 'Diamond', 2, 'forge', 4),
      this.teamUpgrade(30, 'Mining Fatigue Trap', 'Team Upgrades', 'Arms a base trap against the next enemy push.', itemId('String', 206), 'Diamond', 1, 'minerFatigueTrap', 1),
      this.teamUpgrade(32, 'Dragon Buff', 'Team Upgrades', 'Late-game sudden-death pressure upgrade.', itemId('Emerald', 471), 'Diamond', 5, 'dragonBuff', 1),
    ].filter((offer) => offer.iconId > 0);
  }

  private stack(slot: number, title: string, category: string, description: string, itemIdOut: number, currency: CurrencyName, costCount: number, count: number, kind: OfferKind = 'stack'): ShopOffer {
    return { slot, title, category, description, iconId: itemIdOut, cost: this.cost(currency, costCount), kind, itemId: itemIdOut, count };
  }

  private tiered(slot: number, title: string, category: string, description: string, iconId: number, tiers: number[], tierCosts: ShopCost[]): ShopOffer {
    return { slot, title, category, description, iconId, cost: tierCosts[0], kind: 'tiered', tiers, tierCosts };
  }

  private armor(slot: number, title: string, category: string, description: string, iconId: number, currency: CurrencyName, costCount: number, material: 'Copper' | 'Iron' | 'Diamond'): ShopOffer {
    const pieces = ['Helmet', 'Chestplate', 'Leggings', 'Boots'];
    const armorSet = pieces.map((piece, offset) => ({
      slot: 37 + offset,
      itemId: itemId(`${material} ${piece}`, 0),
      customName: `${this.currentTeam} ${material} ${piece}`,
    })).filter((p) => p.itemId > 0);
    return { slot, title, category, description, iconId, cost: this.cost(currency, costCount), kind: 'armor', armorSet };
  }

  private teamUpgrade(slot: number, title: string, category: string, description: string, iconId: number, currency: CurrencyName, costCount: number, upgradeKey: string, maxLevel: number): ShopOffer {
    return { slot, title, category, description, iconId, cost: this.cost(currency, costCount), kind: 'teamUpgrade', upgradeKey, maxLevel };
  }

  private cost(currency: CurrencyName, count: number): ShopCost {
    return { itemId: this.currencyIds[currency], count, label: `${count} ${currency}` };
  }

  private render(): void {
    const title = document.getElementById('bedwars-shop-title');
    if (title) title.textContent = this.currentKind === 'teamUpgrades' ? 'BedWars Team Upgrades' : 'BedWars Item Shop';
    this.grid.innerHTML = '';
    const bySlot = new Map<number, ShopOffer>();
    for (const offer of this.offers) bySlot.set(offer.slot, offer);

    for (let i = 0; i < 54; i++) {
      const cell = document.createElement('button');
      cell.style.cssText = 'position:relative;width:100%;height:100%;min-width:48px;min-height:48px;background:#b7b7b7;border:3px solid #222;cursor:pointer;image-rendering:pixelated;user-select:none;-webkit-user-select:none;';
      const offer = bySlot.get(i);
      if (offer) {
        cell.title = `${offer.title}\nCost: ${this.costForOffer(offer).label}\n${offer.description}`;
        const img = document.createElement('img');
        img.src = TextureGenerator.getItemIconDataURL(offer.iconId);
        img.style.cssText = 'width:70%;height:70%;max-width:44px;max-height:44px;image-rendering:pixelated;pointer-events:none;';
        cell.appendChild(img);
        const cost = document.createElement('div');
        cost.textContent = this.costForOffer(offer).count > 0 ? this.costForOffer(offer).count.toString() : 'FREE';
        cost.style.cssText = 'position:absolute;right:4px;bottom:2px;color:#ffff55;text-shadow:2px 2px #000;font-size:11px;';
        cell.appendChild(cost);
        cell.onmouseenter = () => this.showDetails(offer);
        cell.onfocus = () => this.showDetails(offer);
        cell.onclick = () => this.buy(offer);
      } else {
        cell.style.opacity = '0.45';
      }
      this.grid.appendChild(cell);
    }
    this.status.textContent = this.currentKind === 'teamUpgrades'
      ? `${this.currentTeam} team upgrade shop. Diamonds buy shared upgrades.`
      : `${this.currentTeam} item shop. Stackables keep adding; tiered gear upgrades instead of duplicating.`;
    this.status.style.color = '#fff';
  }

  private showDetails(offer: ShopOffer): void {
    const cost = this.costForOffer(offer);
    const owned = offer.tiers?.map(id => `${displayName(id)}: ${this.inventory.countItem(id, true)}`).join('\n') || '';
    const level = offer.upgradeKey ? this.teamUpgrades.get(this.teamUpgradeKey(offer.upgradeKey)) || 0 : 0;
    this.detailTitle.textContent = `${offer.category}: ${offer.title}`;
    this.detailBody.textContent = `${offer.description}\n\nCost: ${cost.label}${owned ? `\n\nOwned tiers:\n${owned}` : ''}${offer.upgradeKey ? `\n\nCurrent level: ${level}/${offer.maxLevel || 1}` : ''}`;
  }

  private buy(offer: ShopOffer): void {
    const cost = this.costForOffer(offer);
    if (offer.kind === 'teamUpgrade') {
      this.buyTeamUpgrade(offer, cost);
      return;
    }

    if (!this.inventory.hasItem(cost.itemId, cost.count)) {
      this.setStatus(`Need ${cost.label}.`, false);
      return;
    }

    if (offer.kind === 'armor') {
      this.buyArmor(offer, cost);
      return;
    }

    let itemToGrant = offer.itemId || offer.iconId;
    let countToGrant = offer.count || 1;

    if (offer.kind === 'tiered' || offer.kind === 'permanent') {
      const next = this.nextMissingTier(offer.tiers || [itemToGrant]);
      if (!next) {
        this.setStatus(`Already owns ${offer.title}.`, false);
        return;
      }
      itemToGrant = next;
      countToGrant = 1;
    }

    if (!this.inventory.removeItem(cost.itemId, cost.count)) {
      this.setStatus(`Could not deduct ${cost.label}.`, false);
      return;
    }

    if (offer.kind === 'tiered' || offer.kind === 'permanent') this.removeLowerTiers(offer.tiers || [itemToGrant], itemToGrant);
    const leftover = this.inventory.addItem(itemToGrant, countToGrant);
    if (leftover > 0) {
      this.inventory.addItem(cost.itemId, cost.count);
      this.setStatus('Inventory full. Purchase cancelled.', false);
      return;
    }

    this.setStatus(`Purchased ${countToGrant}x ${displayName(itemToGrant)} for ${cost.label}.`, true);
    AudioManager.playItemPickup();
    this.render();
  }

  private buyArmor(offer: ShopOffer, cost: ShopCost): void {
    if (!offer.armorSet || offer.armorSet.length === 0) {
      this.setStatus('Armor set is unavailable in this build.', false);
      return;
    }
    if (!this.inventory.removeItem(cost.itemId, cost.count)) {
      this.setStatus(`Could not deduct ${cost.label}.`, false);
      return;
    }
    const tint = this.teamTint(this.currentTeam);
    for (const piece of offer.armorSet) {
      const stack: ItemStack = { id: piece.itemId, count: 1, customName: piece.customName, tint, team: this.currentTeam };
      this.inventory.setSlot(piece.slot, stack);
    }
    this.setStatus(`Purchased ${offer.title} for ${cost.label}.`, true);
    AudioManager.playItemPickup();
  }

  private buyTeamUpgrade(offer: ShopOffer, cost: ShopCost): void {
    const key = this.teamUpgradeKey(offer.upgradeKey || offer.title);
    const level = this.teamUpgrades.get(key) || 0;
    const maxLevel = offer.maxLevel || 1;
    if (level >= maxLevel) {
      this.setStatus(`${offer.title} is already maxed.`, false);
      return;
    }
    const scaledCost = { ...cost, count: cost.count * (level + 1), label: `${cost.count * (level + 1)} ${displayName(cost.itemId)}` };
    if (!this.inventory.hasItem(scaledCost.itemId, scaledCost.count)) {
      this.setStatus(`Need ${scaledCost.label}.`, false);
      return;
    }
    if (!this.inventory.removeItem(scaledCost.itemId, scaledCost.count)) return;
    this.teamUpgrades.set(key, level + 1);
    this.setStatus(`Purchased ${offer.title} level ${level + 1}/${maxLevel}.`, true);
    AudioManager.playItemPickup();
    this.render();
  }

  private costForOffer(offer: ShopOffer): ShopCost {
    if ((offer.kind === 'tiered' || offer.kind === 'permanent') && offer.tiers && offer.tierCosts) {
      const idx = this.nextMissingTierIndex(offer.tiers);
      return offer.tierCosts[Math.max(0, Math.min(idx, offer.tierCosts.length - 1))] || offer.cost;
    }
    return offer.cost;
  }

  private nextMissingTierIndex(tiers: number[]): number {
    const filtered = tiers.filter(Boolean);
    if (filtered.length === 0) return 0;
    let highestOwned = -1;
    for (let i = 0; i < filtered.length; i++) {
      if (this.inventory.countItem(filtered[i], true) > 0) highestOwned = i;
    }
    return Math.min(filtered.length - 1, highestOwned + 1);
  }

  private nextMissingTier(tiers: number[]): number | null {
    const filtered = tiers.filter(Boolean);
    if (filtered.length === 0) return null;
    const idx = this.nextMissingTierIndex(filtered);
    if (this.inventory.countItem(filtered[filtered.length - 1], true) > 0) return null;
    return filtered[idx];
  }

  private removeLowerTiers(tiers: number[], granted: number): void {
    for (const tier of tiers) {
      if (!tier || tier === granted) continue;
      let slot = this.inventory.findFirstSlotById(tier, true);
      while (slot >= 0) {
        this.inventory.setSlot(slot, null);
        slot = this.inventory.findFirstSlotById(tier, true);
      }
    }
  }

  private setStatus(message: string, ok: boolean): void {
    this.status.textContent = message;
    this.status.style.color = ok ? '#9dff9d' : '#ff7777';
    if (!ok) AudioManager.playMenuHover();
  }

  private teamUpgradeKey(key: string): string {
    return `${this.currentTeam}:${key}`;
  }

  private teamTint(team: TeamName): string {
    return { Red: '#ff3f4f', Blue: '#4a86ff', Green: '#43d96b', Yellow: '#fff05a' }[team];
  }

  private teamWoolId(team: TeamName): number {
    return blockId(`${team} Wool`, 0) || itemId(`${team} Wool`, 0) || 210;
  }
}
