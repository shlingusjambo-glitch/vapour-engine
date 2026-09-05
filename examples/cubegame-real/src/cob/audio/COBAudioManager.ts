import { Vector3, clamp } from '../core/Math';

export interface COBAudioAsset {
  id: string;
  url: string;
  baseVolume: number;
  priority: number;
  referenceDistance: number;
  maxDistance: number;
}

interface ActiveAudioChannel {
  channelId: number;
  assetId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  startedAtMs: number;
  emitterPosition: Vector3;
  distance: number;
  priority: number;
  culled: boolean;
}

export class COBAudioManager {
  public static readonly defaultAssets: COBAudioAsset[] = [
    { id: 'rifle_fire_01', url: '/audio/cob/rifle_fire_01.mp3', baseVolume: 0.82, priority: 90, referenceDistance: 5, maxDistance: 180 },
    { id: 'rifle_fire_02', url: '/audio/cob/rifle_fire_02.mp3', baseVolume: 0.78, priority: 88, referenceDistance: 5, maxDistance: 180 },
    { id: 'tank_cannon_fire', url: '/audio/cob/tank_cannon_fire.mp3', baseVolume: 1.0, priority: 130, referenceDistance: 18, maxDistance: 640 },
    { id: 'tank_shell_impact', url: '/audio/cob/tank_shell_impact.mp3', baseVolume: 1.0, priority: 125, referenceDistance: 20, maxDistance: 720 },
    { id: 'humvee_50cal_fire', url: '/audio/cob/humvee_50cal_fire.mp3', baseVolume: 0.86, priority: 96, referenceDistance: 7, maxDistance: 240 },
    { id: 'helicopter_rotor_loop', url: '/audio/cob/helicopter_rotor_loop.mp3', baseVolume: 0.7, priority: 80, referenceDistance: 24, maxDistance: 520 },
    { id: 'fighter_jet_pass', url: '/audio/cob/fighter_jet_pass.mp3', baseVolume: 0.95, priority: 110, referenceDistance: 32, maxDistance: 900 },
    { id: 'missile_launch', url: '/audio/cob/missile_launch.mp3', baseVolume: 0.92, priority: 118, referenceDistance: 14, maxDistance: 520 },
    { id: 'player_hitmarker', url: '/audio/cob/player_hitmarker.mp3', baseVolume: 0.55, priority: 150, referenceDistance: 1, maxDistance: 30 },
    { id: 'objective_capture_tick', url: '/audio/cob/objective_capture_tick.mp3', baseVolume: 0.5, priority: 70, referenceDistance: 4, maxDistance: 80 },
  ];

  private readonly assets = new Map<string, COBAudioAsset>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly activeChannels: ActiveAudioChannel[] = [];
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private nextChannelId = 1;

  public constructor(
    assets: COBAudioAsset[] = COBAudioManager.defaultAssets,
    private readonly maxConcurrentVoices: number = 32
  ) {
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      this.assets.set(asset.id, {
        id: asset.id,
        url: asset.url,
        baseVolume: clamp(asset.baseVolume, 0, 1),
        priority: Math.max(0, asset.priority),
        referenceDistance: Math.max(0.1, asset.referenceDistance),
        maxDistance: Math.max(asset.referenceDistance, asset.maxDistance),
      });
    }
  }

  public async initialize(): Promise<void> {
    if (this.context) return;
    const audioGlobal = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const AudioCtor = audioGlobal.AudioContext || audioGlobal.webkitAudioContext;
    if (!AudioCtor) return;
    this.context = new AudioCtor();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.setValueAtTime(0.85, this.context.currentTime);
    this.masterGain.connect(this.context.destination);
    await this.preloadAll();
  }

  public async preloadAll(): Promise<void> {
    if (!this.context) return;
    const entries = Array.from(this.assets.values());
    for (let i = 0; i < entries.length; i++) {
      const asset = entries[i];
      if (this.buffers.has(asset.id)) continue;
      try {
        const response = await fetch(asset.url);
        if (!response.ok) continue;
        const bytes = await response.arrayBuffer();
        const decoded = await this.context.decodeAudioData(bytes.slice(0));
        this.buffers.set(asset.id, decoded);
      } catch (error) {
        console.warn(`COB audio asset failed to preload: ${asset.id}`, error);
      }
    }
  }

  public playSpatial(assetId: string, emitterPosition: Vector3, listenerCameraPosition: Vector3, priorityOverride?: number): number | null {
    if (!this.context || !this.masterGain) return null;
    const asset = this.assets.get(assetId);
    if (!asset) return null;
    const buffer = this.buffers.get(assetId);
    if (!buffer) return null;

    const distance = emitterPosition.distanceTo(listenerCameraPosition);
    if (distance > asset.maxDistance) return null;

    const volume = this.calculateInverseSquareVolume(asset, emitterPosition, listenerCameraPosition);
    if (volume <= 0.0001) return null;

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(volume, this.context.currentTime);
    source.connect(gain);
    gain.connect(this.masterGain);

    const channel: ActiveAudioChannel = {
      channelId: this.nextChannelId++,
      assetId,
      source,
      gain,
      startedAtMs: Date.now(),
      emitterPosition: emitterPosition.clone(),
      distance,
      priority: priorityOverride === undefined ? asset.priority : Math.max(0, priorityOverride),
      culled: false,
    };

    source.onended = () => {
      this.removeChannel(channel.channelId, false);
    };

    this.activeChannels.push(channel);
    this.enforceVoiceLimit(listenerCameraPosition);
    if (channel.culled) return null;

    source.start();
    return channel.channelId;
  }

  public updateListener(listenerCameraPosition: Vector3): void {
    if (!this.context) return;
    for (let i = 0; i < this.activeChannels.length; i++) {
      const channel = this.activeChannels[i];
      const asset = this.assets.get(channel.assetId);
      if (!asset) continue;
      channel.distance = channel.emitterPosition.distanceTo(listenerCameraPosition);
      const volume = this.calculateInverseSquareVolume(asset, channel.emitterPosition, listenerCameraPosition);
      channel.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.025);
    }
    this.enforceVoiceLimit(listenerCameraPosition);
  }

  public stopChannel(channelId: number): boolean {
    return this.removeChannel(channelId, true);
  }

  public getActiveVoiceCount(): number {
    let count = 0;
    for (let i = 0; i < this.activeChannels.length; i++) {
      if (!this.activeChannels[i].culled) count++;
    }
    return count;
  }

  public clearLoadedAssets(): void {
    this.stopAllChannels();
    this.buffers.clear();
  }

  public dispose(): void {
    this.stopAllChannels();
    this.buffers.clear();
    this.assets.clear();
    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        // GainNode may already be disconnected by browser shutdown.
      }
    }
    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch(() => {});
    }
    this.masterGain = null;
    this.context = null;
  }

  public calculateInverseSquareVolume(asset: COBAudioAsset, emitterPosition: Vector3, listenerCameraPosition: Vector3): number {
    const distanceVector = emitterPosition.subtract(listenerCameraPosition);
    const distanceSquared = distanceVector.lengthSquared();
    if (distanceSquared <= asset.referenceDistance * asset.referenceDistance) {
      return clamp(asset.baseVolume, 0, 1);
    }
    if (distanceSquared >= asset.maxDistance * asset.maxDistance) {
      return 0;
    }
    const referenceSquared = asset.referenceDistance * asset.referenceDistance;
    const attenuation = referenceSquared / Math.max(referenceSquared, distanceSquared);
    return clamp(asset.baseVolume * attenuation, 0, 1);
  }

  private enforceVoiceLimit(listenerCameraPosition: Vector3): void {
    if (this.activeChannels.length <= this.maxConcurrentVoices) return;

    for (let i = 0; i < this.activeChannels.length; i++) {
      const channel = this.activeChannels[i];
      channel.distance = channel.emitterPosition.distanceTo(listenerCameraPosition);
    }

    this.activeChannels.sort((a, b) => {
      const aWeight = a.priority * 1000 - a.distance;
      const bWeight = b.priority * 1000 - b.distance;
      if (aWeight === bWeight) return a.startedAtMs - b.startedAtMs;
      return aWeight - bWeight;
    });

    while (this.activeChannels.length > this.maxConcurrentVoices) {
      const channel = this.activeChannels.shift();
      if (!channel) break;
      channel.culled = true;
      try {
        channel.source.stop();
      } catch {
        channel.gain.disconnect();
      }
    }
  }

  private stopAllChannels(): void {
    while (this.activeChannels.length > 0) {
      const channel = this.activeChannels.pop();
      if (!channel) continue;
      channel.culled = true;
      try {
        channel.source.stop();
      } catch {
        try {
          channel.gain.disconnect();
        } catch {
          // The node can already be disconnected when an ended event races cleanup.
        }
      }
    }
  }

  private removeChannel(channelId: number, stopSource: boolean): boolean {
    for (let i = 0; i < this.activeChannels.length; i++) {
      const channel = this.activeChannels[i];
      if (channel.channelId !== channelId) continue;
      this.activeChannels.splice(i, 1);
      channel.culled = true;
      if (stopSource) {
        try {
          channel.source.stop();
        } catch {
          channel.gain.disconnect();
        }
      } else {
        try {
          channel.gain.disconnect();
        } catch {
          return true;
        }
      }
      return true;
    }
    return false;
  }
}
