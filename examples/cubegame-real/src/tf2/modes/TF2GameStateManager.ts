import * as THREE from 'three';
import type { TF2Team } from '../classes/TF2ClassRegistry';

export type TF2ModeKind = 'payload' | 'control_points' | 'koth' | 'ctf';
export type TF2RoundPhase = 'PreRound' | 'ActiveRound' | 'Overtime' | 'RoundEnd';

export interface TF2PlayerObjectiveState {
  uuid: string;
  team: TF2Team;
  position: THREE.Vector3;
  alive: boolean;
}

export interface TF2ModeSnapshot {
  mode: TF2ModeKind;
  phase: TF2RoundPhase;
  label: string;
  redScore: number;
  bluScore: number;
  timer: number;
}

export class TF2GameStateManager {
  private phase: TF2RoundPhase = 'PreRound';
  private timer = 20;
  private scores: Record<TF2Team, number> = { RED: 0, BLU: 0 };

  // Payload specific
  private payloadT = 0;
  private payloadIdleTime = 0;

  // Control Points specific (Sequential: RED starts owning all, BLU captures CP 1, then CP 2, then CP 3)
  private cpOwners: Record<number, TF2Team | 'NEUTRAL'> = { 1: 'RED', 2: 'RED', 3: 'RED' };
  private cpCaptureProgress: Record<number, number> = { 1: 0, 2: 0, 3: 0 }; // 0 to 100

  // KOTH specific
  private kothOwner: TF2Team | '' = '';
  private kothTimers: Record<TF2Team, number> = { RED: 180, BLU: 180 };

  // CTF specific
  private flagState: Record<TF2Team, 'home' | 'carried' | 'dropped'> = { RED: 'home', BLU: 'home' };
  private flagCarrier: Record<TF2Team, string> = { RED: '', BLU: '' }; // flag team -> player uuid
  private flagPos: Record<TF2Team, THREE.Vector3> = { RED: new THREE.Vector3(-42, 64, 0), BLU: new THREE.Vector3(42, 64, 0) };
  private flagReturnTimer: Record<TF2Team, number> = { RED: 0, BLU: 0 };

  constructor(private mode: TF2ModeKind = 'payload') {}

  public setMode(mode: TF2ModeKind): void {
    this.mode = mode;
    this.phase = 'PreRound';
    this.timer = 20;
    this.scores = { RED: 0, BLU: 0 };

    this.payloadT = 0;
    this.payloadIdleTime = 0;

    this.cpOwners = { 1: 'RED', 2: 'RED', 3: 'RED' };
    this.cpCaptureProgress = { 1: 0, 2: 0, 3: 0 };

    this.kothOwner = '';
    this.kothTimers = { RED: 180, BLU: 180 };

    this.flagState = { RED: 'home', BLU: 'home' };
    this.flagCarrier = { RED: '', BLU: '' };
    this.flagReturnTimer = { RED: 0, BLU: 0 };
  }

  public tick(dt: number, players: TF2PlayerObjectiveState[]): TF2ModeSnapshot {
    // Dynamically adjust initial flag coordinates based on dimension height
    const firstPlayer = players[0];
    const floorY = (firstPlayer && firstPlayer.position.y < 30) ? 4 : 64;
    if (this.flagState.RED === 'home') this.flagPos.RED.set(-30, floorY, 0);
    if (this.flagState.BLU === 'home') this.flagPos.BLU.set(30, floorY, 0);

    if (this.phase === 'PreRound') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.phase = 'ActiveRound';
        this.timer = this.mode === 'koth' ? 180 : 600;
      }
    } else if (this.phase === 'ActiveRound') {
      if (this.mode === 'payload') this.tickPayload(dt, players, floorY);
      if (this.mode === 'koth') this.tickKoth(dt, players, floorY);
      if (this.mode === 'control_points') this.tickControlPoints(dt, players, floorY);
      if (this.mode === 'ctf') this.tickCtf(dt, players, floorY);
      
      if (this.mode !== 'koth') {
        this.timer = Math.max(0, this.timer - dt);
        if (this.timer <= 0) {
          this.phase = this.isObjectiveContested(players, floorY) ? 'Overtime' : 'RoundEnd';
        }
      }
    } else if (this.phase === 'Overtime') {
      if (!this.isObjectiveContested(players, floorY)) {
        this.phase = 'RoundEnd';
      }
    }

    return {
      mode: this.mode,
      phase: this.phase,
      label: this.getLabel(),
      redScore: Math.floor(this.scores.RED),
      bluScore: Math.floor(this.scores.BLU),
      timer: this.mode === 'koth' ? (this.kothOwner ? this.kothTimers[this.kothOwner] : this.timer) : Math.max(0, this.timer),
    };
  }

  private tickPayload(dt: number, players: TF2PlayerObjectiveState[], floorY: number): void {
    const startX = -36;
    const endX = 36;
    const cartX = startX + this.payloadT * (endX - startX);
    const cart = new THREE.Vector3(cartX, floorY, 0);

    const attackers = players.filter(p => p.alive && p.team === 'BLU' && p.position.distanceTo(cart) <= 5.5).length;
    const blockers = players.filter(p => p.alive && p.team === 'RED' && p.position.distanceTo(cart) <= 5.5).length;

    if (attackers > 0 && blockers === 0) {
      this.payloadT = Math.min(1, this.payloadT + dt * (0.012 + attackers * 0.008));
      this.payloadIdleTime = 0;
    } else if (attackers === 0 && blockers === 0) {
      this.payloadIdleTime += dt;
      if (this.payloadIdleTime >= 15.0) {
        this.payloadT = Math.max(0, this.payloadT - dt * 0.01); // Automatic rollback
      }
    } else {
      this.payloadIdleTime = 0; // Contested
    }

    if (this.payloadT >= 1.0) {
      this.scores.BLU++;
      this.phase = 'RoundEnd';
    }
  }

  private tickKoth(dt: number, players: TF2PlayerObjectiveState[], floorY: number): void {
    const center = new THREE.Vector3(0, floorY, 0);
    const red = players.some(p => p.alive && p.team === 'RED' && p.position.distanceTo(center) <= 6);
    const blu = players.some(p => p.alive && p.team === 'BLU' && p.position.distanceTo(center) <= 6);

    if (red && !blu) {
      this.kothOwner = 'RED';
    } else if (blu && !red) {
      this.kothOwner = 'BLU';
    }

    if (this.kothOwner) {
      this.kothTimers[this.kothOwner] = Math.max(0, this.kothTimers[this.kothOwner] - dt);
      if (this.kothTimers[this.kothOwner] <= 0) {
        this.scores[this.kothOwner]++;
        this.phase = 'RoundEnd';
      }
    }
  }

  private tickControlPoints(dt: number, players: TF2PlayerObjectiveState[], floorY: number): void {
    // 3 Control points: Point 1 at x = -24, Point 2 at x = 0, Point 3 at x = 24
    const cpCoords: Record<number, number> = { 1: -24, 2: 0, 3: 24 };

    // Sequential Unlocking: BLU must capture CP 1, then CP 2, then CP 3
    let currentTargetCP = 1;
    if (this.cpOwners[1] === 'BLU') currentTargetCP = 2;
    if (this.cpOwners[2] === 'BLU') currentTargetCP = 3;

    const cpPos = new THREE.Vector3(cpCoords[currentTargetCP], floorY, 0);
    const blu = players.filter(p => p.alive && p.team === 'BLU' && p.position.distanceTo(cpPos) <= 6).length;
    const red = players.filter(p => p.alive && p.team === 'RED' && p.position.distanceTo(cpPos) <= 6).length;

    if (blu > 0 && red === 0) {
      this.cpCaptureProgress[currentTargetCP] = Math.min(100, this.cpCaptureProgress[currentTargetCP] + dt * (10 + blu * 5));
      if (this.cpCaptureProgress[currentTargetCP] >= 100) {
        this.cpOwners[currentTargetCP] = 'BLU';
        if (currentTargetCP === 3) {
          this.scores.BLU++;
          this.phase = 'RoundEnd';
        }
      }
    } else if (red > 0 && blu === 0) {
      // Revert capture progress
      this.cpCaptureProgress[currentTargetCP] = Math.max(0, this.cpCaptureProgress[currentTargetCP] - dt * 12);
    }
  }

  private tickCtf(dt: number, players: TF2PlayerObjectiveState[], floorY: number): void {
    const redIntelHome = new THREE.Vector3(-30, floorY, 0);
    const bluIntelHome = new THREE.Vector3(30, floorY, 0);

    for (const team of ['RED', 'BLU'] as TF2Team[]) {
      const enemyTeam: TF2Team = team === 'RED' ? 'BLU' : 'RED';
      const homePos = team === 'RED' ? redIntelHome : bluIntelHome;
      const deliveryHome = enemyTeam === 'RED' ? redIntelHome : bluIntelHome;

      if (this.flagState[team] === 'home') {
        const carrierCandidate = players.find(p => p.alive && p.team === enemyTeam && p.position.distanceTo(homePos) <= 3.5);
        if (carrierCandidate) {
          this.flagState[team] = 'carried';
          this.flagCarrier[team] = carrierCandidate.uuid;
        }
      } else if (this.flagState[team] === 'carried') {
        const carrier = players.find(p => p.uuid === this.flagCarrier[team]);
        if (!carrier || !carrier.alive) {
          // Carrier died or left: Drop flag
          this.flagState[team] = 'dropped';
          this.flagCarrier[team] = '';
          this.flagReturnTimer[team] = 30.0;
        } else {
          this.flagPos[team].copy(carrier.position);
          // Check for delivery to home base zone (and own flag must be at home!)
          if (carrier.position.distanceTo(deliveryHome) <= 4.0 && this.flagState[enemyTeam] === 'home') {
            this.scores[enemyTeam]++;
            this.flagState[team] = 'home';
            this.flagPos[team].copy(homePos);
            this.flagCarrier[team] = '';
            if (this.scores[enemyTeam] >= 3) {
              this.phase = 'RoundEnd';
            }
          }
        }
      } else if (this.flagState[team] === 'dropped') {
        this.flagReturnTimer[team] -= dt;
        if (this.flagReturnTimer[team] <= 0) {
          // Auto return
          this.flagState[team] = 'home';
          this.flagPos[team].copy(homePos);
        } else {
          // Teammate touches dropped flag: returns home instantly
          const defender = players.find(p => p.alive && p.team === team && p.position.distanceTo(this.flagPos[team]) <= 3.5);
          if (defender) {
            this.flagState[team] = 'home';
            this.flagPos[team].copy(homePos);
          } else {
            // Enemy touches dropped flag: pick up again
            const carrierCandidate = players.find(p => p.alive && p.team === enemyTeam && p.position.distanceTo(this.flagPos[team]) <= 3.5);
            if (carrierCandidate) {
              this.flagState[team] = 'carried';
              this.flagCarrier[team] = carrierCandidate.uuid;
            }
          }
        }
      }
    }
  }

  private isObjectiveContested(players: TF2PlayerObjectiveState[], floorY: number): boolean {
    if (this.mode === 'payload') {
      const startX = -36;
      const endX = 36;
      const cartX = startX + this.payloadT * (endX - startX);
      const cart = new THREE.Vector3(cartX, floorY, 0);
      return players.some(p => p.alive && p.position.distanceTo(cart) <= 5.5);
    }
    if (this.mode === 'koth') {
      const center = new THREE.Vector3(0, floorY, 0);
      return players.some(p => p.alive && p.position.distanceTo(center) <= 6.0);
    }
    if (this.mode === 'control_points') {
      const cpCoords: Record<number, number> = { 1: -24, 2: 0, 3: 24 };
      let currentTargetCP = 1;
      if (this.cpOwners[1] === 'BLU') currentTargetCP = 2;
      if (this.cpOwners[2] === 'BLU') currentTargetCP = 3;
      const cpPos = new THREE.Vector3(cpCoords[currentTargetCP], floorY, 0);
      return players.some(p => p.alive && p.position.distanceTo(cpPos) <= 6.0);
    }
    return false;
  }

  private getLabel(): string {
    if (this.mode === 'payload') return `Payload ${(this.payloadT * 100).toFixed(0)}%`;
    if (this.mode === 'koth') return `KOTH ${this.kothOwner || 'Neutral'} RED ${Math.ceil(this.kothTimers.RED)}s BLU ${Math.ceil(this.kothTimers.BLU)}s`;
    if (this.mode === 'ctf') return `CTF RED ${this.scores.RED} BLU ${this.scores.BLU}`;
    
    let currentTargetCP = 1;
    if (this.cpOwners[1] === 'BLU') currentTargetCP = 2;
    if (this.cpOwners[2] === 'BLU') currentTargetCP = 3;
    return `CP ${currentTargetCP}/3 cap ${this.cpCaptureProgress[currentTargetCP].toFixed(0)}%`;
  }
}

