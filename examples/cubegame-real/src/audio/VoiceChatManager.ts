import * as THREE from 'three';
import { EventBus } from '../core/EventBus';
import { EntityManager } from '../entities/EntityManager';

type VoiceSignalType = 'offer' | 'answer' | 'ice';

interface VoicePeer {
  pc: RTCPeerConnection;
  gain: GainNode | null;
  audio: HTMLAudioElement | null;
  makingOffer: boolean;
  polite: boolean;
}

export class VoiceChatManager {
  private entityManager: EntityManager;
  private peers: Map<string, VoicePeer> = new Map();
  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private enabled = false;
  private myUuid = '';
  private readonly fullVolumeDistance = 8;
  private readonly maxVoiceDistance = 34;

  constructor(entityManager: EntityManager) {
    this.entityManager = entityManager;

    EventBus.on('network:welcome', (msg: any) => {
      this.myUuid = String(msg?.uuid || '');
    });
    EventBus.on('network:disconnected', () => this.stop());
    EventBus.on('network:connectionLost', () => this.stop());
    EventBus.on('network:voice:start', () => void this.start());
    EventBus.on('network:voice:stop', () => this.stop());
    EventBus.on('network:voice:signal', (msg: any) => void this.handleSignal(msg));
  }

  public async start(): Promise<void> {
    if (this.enabled) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      EventBus.emit('network:chat', '[Voice] Microphone capture is not available in this browser.');
      return;
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      this.enabled = true;
      EventBus.emit('network:voice:state', { enabled: true });
      EventBus.emit('network:chat', '[Voice] Proximity voice chat enabled.');

      for (const uuid of this.entityManager.remotePlayers.keys()) {
        this.ensurePeer(uuid);
      }
    } catch (err) {
      console.warn('Voice chat microphone permission failed:', err);
      EventBus.emit('network:voice:state', { enabled: false, error: String(err) });
      EventBus.emit('network:chat', '[Voice] Microphone permission was blocked or unavailable.');
    }
  }

  public stop(): void {
    if (!this.enabled && !this.localStream && this.peers.size === 0) return;

    this.enabled = false;
    for (const peer of this.peers.values()) {
      peer.audio?.remove();
      peer.pc.close();
    }
    this.peers.clear();
    this.localStream?.getTracks().forEach(track => track.stop());
    this.localStream = null;
    EventBus.emit('network:voice:state', { enabled: false });
  }

  public update(): void {
    if (!this.enabled) return;

    const local = (window as any).gamePlayerController;
    const localPos = local?.position as THREE.Vector3 | undefined;
    if (!localPos) return;

    for (const [uuid, peer] of this.peers) {
      const remote = this.entityManager.remotePlayers.get(uuid);
      if (!remote) {
        this.closePeer(uuid);
        continue;
      }
      if (!peer.gain) continue;

      const distance = localPos.distanceTo(remote.entity.position);
      const volume = this.volumeForDistance(distance);
      const now = this.audioContext?.currentTime ?? 0;
      peer.gain.gain.cancelScheduledValues(now);
      peer.gain.gain.setTargetAtTime(volume, now, 0.08);
    }
  }

  public onRemotePlayerJoined(uuid: string): void {
    if (this.enabled) this.ensurePeer(uuid);
  }

  public onRemotePlayerLeft(uuid: string): void {
    this.closePeer(uuid);
  }

  private volumeForDistance(distance: number): number {
    if (distance <= this.fullVolumeDistance) return 1;
    if (distance >= this.maxVoiceDistance) return 0;
    const t = (distance - this.fullVolumeDistance) / (this.maxVoiceDistance - this.fullVolumeDistance);
    return Math.max(0, Math.min(1, 1 - t * t));
  }

  private ensurePeer(uuid: string): VoicePeer | null {
    if (!uuid || uuid === this.myUuid || !this.localStream) return null;
    const existing = this.peers.get(uuid);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    const peer: VoicePeer = {
      pc,
      gain: null,
      audio: null,
      makingOffer: false,
      polite: this.myUuid.localeCompare(uuid) > 0,
    };
    this.peers.set(uuid, peer);

    for (const track of this.localStream.getAudioTracks()) {
      pc.addTrack(track, this.localStream);
    }

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.sendSignal(uuid, 'offer', pc.localDescription);
      } catch (err) {
        console.warn('Voice offer failed:', err);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) this.sendSignal(uuid, 'ice', event.candidate);
    };

    pc.ontrack = (event) => this.attachRemoteStream(uuid, event.streams[0]);
    pc.onconnectionstatechange = () => {
      if (['closed', 'failed', 'disconnected'].includes(pc.connectionState)) {
        this.closePeer(uuid);
      }
    };

    return peer;
  }

  private async handleSignal(msg: any): Promise<void> {
    if (!this.enabled || !msg?.fromUuid || msg.fromUuid === this.myUuid) return;
    const fromUuid = String(msg.fromUuid);
    const kind = String(msg.kind || '') as VoiceSignalType;
    const payload = msg.payload;
    const peer = this.ensurePeer(fromUuid);
    if (!peer) return;

    try {
      if (kind === 'offer' || kind === 'answer') {
        const description = new RTCSessionDescription(payload);
        const offerCollision = description.type === 'offer' &&
          (peer.makingOffer || peer.pc.signalingState !== 'stable');
        if (offerCollision && !peer.polite) return;

        await peer.pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await peer.pc.setLocalDescription();
          this.sendSignal(fromUuid, 'answer', peer.pc.localDescription);
        }
      } else if (kind === 'ice' && payload) {
        await peer.pc.addIceCandidate(new RTCIceCandidate(payload));
      }
    } catch (err) {
      console.warn('Voice signal failed:', err);
    }
  }

  private attachRemoteStream(uuid: string, stream: MediaStream | undefined): void {
    if (!stream) return;
    const peer = this.peers.get(uuid);
    if (!peer) return;

    if (!this.audioContext) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass();
    }
    if (this.audioContext.state === 'suspended') void this.audioContext.resume();

    peer.audio?.remove();
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', 'true');
    audio.srcObject = stream;
    audio.muted = true;

    const source = this.audioContext.createMediaStreamSource(stream);
    const gain = this.audioContext.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.audioContext.destination);

    peer.audio = audio;
    peer.gain = gain;
    void audio.play().catch(() => {});
  }

  private closePeer(uuid: string): void {
    const peer = this.peers.get(uuid);
    if (!peer) return;
    peer.audio?.remove();
    peer.pc.close();
    this.peers.delete(uuid);
  }

  private sendSignal(toUuid: string, kind: VoiceSignalType, payload: any): void {
    EventBus.emit('network:voice:sendSignal', { toUuid, kind, payload });
  }
}
