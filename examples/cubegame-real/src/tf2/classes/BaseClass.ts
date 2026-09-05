import { EventBus } from '../../core/EventBus';
import { TF2ClassId, TF2ClassProfile, TF2Team, getTF2ClassProfile } from './TF2ClassRegistry';

import { TF2_WEAPONS } from '../weapons/TF2WeaponFramework';

export interface TF2ClassRuntimeState {
  classId: TF2ClassId;
  team: TF2Team;
  health: number;
  overheal: number;
  cloak: number;
  disguiseClass?: TF2ClassId;
  disguiseTeam?: TF2Team;
  metal: number;
  ubercharge: number;
  cloakActive: boolean;
  invulnerable: boolean;
  selectedSlot: 'primary' | 'secondary' | 'melee';
  ammoClip: Record<string, number>;
  ammoReserve: Record<string, number>;
}

export class BaseClass {
  public readonly profile: TF2ClassProfile;
  public readonly state: TF2ClassRuntimeState;

  constructor(classId: TF2ClassId, team: TF2Team) {
    this.profile = getTF2ClassProfile(classId);
    this.state = {
      classId: this.profile.id,
      team,
      health: this.profile.maxHealth,
      overheal: 0,
      cloak: this.profile.id === 'spy' ? 1 : 0,
      metal: this.profile.id === 'engineer' ? 200 : 0,
      ubercharge: this.profile.id === 'medic' ? 0 : 0,
      cloakActive: false,
      invulnerable: false,
      selectedSlot: 'primary',
      ammoClip: {},
      ammoReserve: {},
    };

    // Initialize weapon ammo states from defaults
    const weaponIds = [this.profile.primary, this.profile.secondary, this.profile.melee];
    for (const w of weaponIds) {
      const def = TF2_WEAPONS[w];
      if (def) {
        this.state.ammoClip[w] = def.clipSize;
        this.state.ammoReserve[w] = def.reserveAmmo;
      }
    }
  }

  public tick(dt: number): void {
    if (this.profile.id === 'medic') {
      this.state.health = Math.min(this.profile.maxHealth, this.state.health + dt * 3);
    }
    if (this.state.overheal > 0) {
      const decay = Math.min(this.state.overheal, dt * 2.5);
      this.state.overheal -= decay;
      this.state.health = Math.max(this.profile.maxHealth, this.state.health - decay);
    }
    if (this.profile.id === 'spy' && !this.state.cloakActive && this.state.cloak < 1) {
      this.state.cloak = Math.min(1, this.state.cloak + dt * 0.08);
    }
  }

  public setSlot(slot: TF2ClassRuntimeState['selectedSlot']): void {
    this.state.selectedSlot = slot;
    EventBus.emit('tf2:slotChanged', { slot });
  }

  public toggleSpyCloak(): boolean {
    if (this.profile.id !== 'spy' || this.state.cloak <= 0.08) return false;
    this.state.cloakActive = !this.state.cloakActive;
    EventBus.emit('tf2:spyCloak', { active: this.state.cloakActive });
    return true;
  }

  public disguise(classId: TF2ClassId, team: TF2Team): void {
    if (this.profile.id !== 'spy') return;
    this.state.disguiseClass = classId;
    this.state.disguiseTeam = team;
    EventBus.emit('tf2:spyDisguise', { classId, team });
  }

  public consumeMetal(amount: number): boolean {
    if (this.profile.id !== 'engineer' || this.state.metal < amount) return false;
    this.state.metal -= amount;
    return true;
  }

  public addUbercharge(amount: number): void {
    if (this.profile.id !== 'medic') return;
    this.state.ubercharge = Math.min(1, this.state.ubercharge + amount);
  }

  public replenishAmmo(fraction: number): void {
    const weaponIds = [this.profile.primary, this.profile.secondary, this.profile.melee];
    for (const w of weaponIds) {
      const def = TF2_WEAPONS[w];
      if (def && def.clipSize > 1) {
        const amt = Math.ceil(def.reserveAmmo * fraction);
        this.state.ammoReserve[w] = Math.min(def.reserveAmmo, this.state.ammoReserve[w] + amt);
      }
    }
  }
}
