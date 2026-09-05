interface AmbientMusicTrack {
  key: string;
  title: string;
  url: string;
}

export class AudioManager {
  private static ctx: AudioContext | null = null;
  private static masterGain: GainNode | null = null;
  private static ambientWindGain: GainNode | null = null;
  private static backroomsMode = false;
  private static backroomsHumGain: GainNode | null = null;
  private static backroomsHumSources: Array<{ stop: () => void }> = [];
  
  private static isMuted: boolean = false;
  private static initialized: boolean = false;

  private static bufferCache: Map<string, AudioBuffer[]> = new Map();
  private static musicBufferCache: Map<string, AudioBuffer> = new Map();
  private static activeMusicSources: Array<{ stop: () => void }> = [];
  private static musicPreloadStarted = false;
  private static musicTimer: number | null = null;
  private static musicPlaying = false;

  private static ambientMusicTracks: AmbientMusicTrack[] = [
    // CC0 sources verified on OpenGameArt:
    // JRPG Piano: https://opengameart.org/content/jrpg-piano
    // JRPG2 Piano: https://opengameart.org/content/jrpg2-piano
    // Bleu: https://opengameart.org/content/bleu
    // Happy Ukelele Island Surfing Theme: https://opengameart.org/content/happy-ukelele-island-surfing-theme
    {
      key: 'jrpg_piano',
      title: 'JRPG Piano',
      url: 'https://opengameart.org/sites/default/files/JRPG%20Piano.mp3',
    },
    {
      key: 'jrpg2_piano',
      title: 'JRPG2 Piano',
      url: 'https://opengameart.org/sites/default/files/JRPG2%20Piano.mp3',
    },
    {
      key: 'bleu_ukulele',
      title: 'Bleu',
      url: 'https://opengameart.org/sites/default/files/Komiku_-_13_-_Bleu.mp3',
    },
    {
      key: 'happy_ukelele',
      title: 'Happy Ukelele Island Surfing Theme',
      url: 'https://opengameart.org/sites/default/files/ukele.mp3',
    },
  ];

  private static soundURLs: { [key: string]: string[] } = {
    'grass_step': [
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/grass1.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/grass2.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/grass3.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/grass4.ogg'
    ],
    'stone_step': [
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/stone1.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/stone2.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/stone3.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/stone4.ogg'
    ],
    'wood_step': [
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/wood1.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/wood2.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/wood3.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/wood4.ogg'
    ],
    'sand_step': [
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/sand1.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/sand2.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/sand3.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/step/sand4.ogg'
    ],
    'water_step': [
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/liquid/swim1.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/liquid/swim2.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/liquid/swim3.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/liquid/swim4.ogg'
    ],
    'grass_dig': [
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/grass1.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/grass2.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/grass3.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/grass4.ogg'
    ],
    'stone_dig': [
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/stone1.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/stone2.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/stone3.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/stone4.ogg'
    ],
    'wood_dig': [
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/wood1.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/wood2.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/wood3.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/wood4.ogg'
    ],
    'sand_dig': [
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/sand1.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/sand2.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/sand3.ogg',
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/dig/sand4.ogg'
    ],
    'pop': [
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/random/pop.ogg'
    ],
    'hurt': [
      'https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/1.19/assets/minecraft/sounds/random/classic_hurt.ogg'
    ]
  };
 
  public static init(): void {
    if (this.initialized) return;
 
    // We defer actual context start to a user interaction to satisfy browser policies.
    // iOS WKWebView often delivers the first valid gesture as touchstart/pointerdown,
    // not click, so listen to the same first-touch path the mobile controls use.
    const unlockAudio = () => { void this.resumeContext(); };
    window.addEventListener('click', unlockAudio, { once: true, passive: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
    window.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
    window.addEventListener('cubegame-native-first-touch', unlockAudio as EventListener, { once: true });
 
    this.initialized = true;
  }
 
  private static async resumeContext(): Promise<void> {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContextClass();
      
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.3, this.ctx.currentTime); // default volume 30%
      this.masterGain.connect(this.ctx.destination);
 
      this.startAmbientWind();
      
      // Async preload audio files
      this.preloadSounds();
      this.preloadMusicTracks();
      if (this.backroomsMode) this.startBackroomsHum();
      else this.scheduleAmbientMusic(6 + Math.random() * 18);
    }
    
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  private static async preloadSounds(): Promise<void> {
    if (!this.ctx) return;
    for (const [key, urls] of Object.entries(this.soundURLs)) {
      const buffers: AudioBuffer[] = [];
      for (const url of urls) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const arrayBuffer = await res.arrayBuffer();
          // Safe decode
          const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
          buffers.push(audioBuffer);
        } catch (e) {
          console.warn(`Failed to preload audio: ${url}`, e);
        }
      }
      if (buffers.length > 0) {
        this.bufferCache.set(key, buffers);
      }
    }
  }

  private static async preloadMusicTracks(): Promise<void> {
    if (!this.ctx || this.musicPreloadStarted) return;
    this.musicPreloadStarted = true;

    for (const track of this.ambientMusicTracks) {
      try {
        const res = await fetch(track.url);
        if (!res.ok) continue;
        const arrayBuffer = await res.arrayBuffer();
        const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
        this.musicBufferCache.set(track.key, audioBuffer);
      } catch (e) {
        console.warn(`Failed to preload music: ${track.title}`, e);
      }
    }
  }

  private static scheduleAmbientMusic(delaySeconds?: number): void {
    if (this.backroomsMode) return;
    if (this.musicTimer !== null) {
      window.clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    const delay = delaySeconds ?? (45 + Math.random() * 135);
    this.musicTimer = window.setTimeout(() => {
      this.musicTimer = null;
      this.playRandomAmbientMusic();
    }, delay * 1000);
  }

  private static playRandomAmbientMusic(): void {
    if (this.backroomsMode) return;
    this.resumeContext();
    if (!this.ctx || this.isMuted || this.musicPlaying) {
      this.scheduleAmbientMusic();
      return;
    }

    const readyTracks = this.ambientMusicTracks.filter(track => this.musicBufferCache.has(track.key));
    if (readyTracks.length === 0) {
      this.playProceduralAmbientSong();
      return;
    }

    const track = readyTracks[Math.floor(Math.random() * readyTracks.length)];
    const buffer = this.musicBufferCache.get(track.key);
    if (!buffer || !this.masterGain) {
      this.playProceduralAmbientSong();
      return;
    }

    const t = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.115, t + 3.5);
    gain.gain.setValueAtTime(0.115, Math.max(t + 3.6, t + buffer.duration - 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + buffer.duration);

    source.connect(gain);
    gain.connect(this.masterGain);
    source.start(t);
    this.musicPlaying = true;

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try {
        source.stop();
      } catch {}
    };
    this.activeMusicSources.push({ stop });

    source.onended = () => {
      this.musicPlaying = false;
      this.activeMusicSources = this.activeMusicSources.filter(entry => entry.stop !== stop);
      this.scheduleAmbientMusic();
    };
  }

  private static playProceduralAmbientSong(): void {
    if (this.backroomsMode) return;
    if (!this.ctx || !this.masterGain) return;
    this.musicPlaying = true;

    const t = this.ctx.currentTime;
    const patterns = [
      { type: 'sine' as OscillatorType, notes: [261.63, 329.63, 392.00, 523.25, 392.00, 329.63], gap: 0.82 },
      { type: 'triangle' as OscillatorType, notes: [293.66, 349.23, 440.00, 587.33, 523.25, 440.00], gap: 0.72 },
      { type: 'sine' as OscillatorType, notes: [220.00, 277.18, 329.63, 415.30, 493.88, 415.30], gap: 0.92 },
    ];
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];
    const repeats = 6 + Math.floor(Math.random() * 4);
    const sources: OscillatorNode[] = [];
    let elapsed = 0;

    for (let r = 0; r < repeats; r++) {
      for (let i = 0; i < pattern.notes.length; i++) {
        const start = t + elapsed;
        const duration = pattern.gap * (0.82 + Math.random() * 0.24);
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        osc.type = pattern.type;
        osc.frequency.setValueAtTime(pattern.notes[i] * (Math.random() < 0.18 ? 2 : 1), start);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1500, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.045, start + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        osc.start(start);
        osc.stop(start + duration + 0.03);
        sources.push(osc);
        elapsed += duration;
      }
      elapsed += 0.7 + Math.random() * 1.6;
    }

    const stop = () => {
      for (const source of sources) {
        try {
          source.stop();
        } catch {}
      }
    };
    this.activeMusicSources.push({ stop });

    window.setTimeout(() => {
      this.musicPlaying = false;
      this.activeMusicSources = this.activeMusicSources.filter(entry => entry.stop !== stop);
      this.scheduleAmbientMusic();
    }, Math.max(1, elapsed + 0.5) * 1000);
  }

  private static playSound(key: string, volume = 0.5, pitchVariation = 0.15): boolean {
    if (!this.ctx || this.isMuted) return false;
    const buffers = this.bufferCache.get(key);
    if (!buffers || buffers.length === 0) return false;

    // Pick random sample
    const buffer = buffers[Math.floor(Math.random() * buffers.length)];
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    // Shift pitch slightly
    const pitch = 1.0 + (Math.random() - 0.5) * pitchVariation;
    source.playbackRate.setValueAtTime(pitch, this.ctx.currentTime);

    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(volume, this.ctx.currentTime);

    source.connect(gainNode);
    if (this.masterGain) gainNode.connect(this.masterGain);

    source.start(0);
    return true;
  }

  public static playGunshot(kind: 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun' = 'rifle'): void {
    void this.resumeContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const t = this.ctx.currentTime;
    const profile = {
      pistol: { base: 170, snap: 0.11, boom: 0.08, volume: 0.38 },
      smg: { base: 210, snap: 0.075, boom: 0.055, volume: 0.28 },
      rifle: { base: 145, snap: 0.12, boom: 0.10, volume: 0.42 },
      sniper: { base: 95, snap: 0.18, boom: 0.18, volume: 0.55 },
      shotgun: { base: 120, snap: 0.16, boom: 0.14, volume: 0.48 },
    }[kind];

    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    const noiseBuffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * profile.snap), this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const noise = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const noiseGain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(profile.base * 2.2, t);
    osc.frequency.exponentialRampToValueAtTime(profile.base, t + profile.boom);
    oscGain.gain.setValueAtTime(profile.volume, t);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + profile.boom);
    noise.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(kind === 'sniper' ? 1250 : 1900, t);
    filter.Q.setValueAtTime(0.8, t);
    noiseGain.gain.setValueAtTime(profile.volume * 0.75, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + profile.snap);

    osc.connect(oscGain);
    noise.connect(filter);
    filter.connect(noiseGain);
    oscGain.connect(this.masterGain);
    noiseGain.connect(this.masterGain);
    osc.start(t);
    noise.start(t);
    osc.stop(t + profile.boom + 0.02);
    noise.stop(t + profile.snap + 0.02);
  }

  public static playGunReload(kind: 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun' = 'rifle'): void {
    void this.resumeContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const t = this.ctx.currentTime;
    const profile = {
      pistol: { body: 680, slide: 1180, delay: 0.18, volume: 0.15 },
      smg: { body: 580, slide: 1040, delay: 0.24, volume: 0.16 },
      rifle: { body: 520, slide: 920, delay: 0.28, volume: 0.17 },
      sniper: { body: 430, slide: 780, delay: 0.42, volume: 0.18 },
      shotgun: { body: 470, slide: 850, delay: 0.34, volume: 0.18 },
    }[kind];

    const click = (time: number, freq: number, volume: number, length: number) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);
      osc.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.42), time + length);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(volume, time + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(time);
      osc.stop(time + length + 0.02);
    };

    click(t, profile.body, profile.volume, 0.085);
    click(t + profile.delay, profile.slide, profile.volume * 0.72, 0.07);
    click(t + profile.delay + 0.12, profile.body * 1.18, profile.volume * 0.55, 0.055);
  }

  public static playCaseRoll(resultRare = false): void {
    void this.resumeContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 10; i++) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = i % 2 ? 'triangle' : 'square';
      osc.frequency.setValueAtTime(320 + i * 38 + (resultRare ? i * 16 : 0), t + i * 0.055);
      gain.gain.setValueAtTime(0.0001, t + i * 0.055);
      gain.gain.linearRampToValueAtTime(0.13, t + i * 0.055 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.055 + 0.07);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t + i * 0.055);
      osc.stop(t + i * 0.055 + 0.09);
    }
  }
 
  public static setVolume(volume: number): void {
    this.resumeContext();
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(volume, this.ctx.currentTime);
    }
  }
 
  // SOUND GENERATORS
  public static playStep(blockType: string): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;

    let soundKey = '';
    switch (blockType) {
      case 'grass':
      case 'leaves':
        soundKey = 'grass_step';
        break;
      case 'stone':
      case 'ore':
      case 'brick':
        soundKey = 'stone_step';
        break;
      case 'wood':
        soundKey = 'wood_step';
        break;
      case 'sand':
        soundKey = 'sand_step';
        break;
      case 'water':
        soundKey = 'water_step';
        break;
    }

    if (soundKey && this.playSound(soundKey, 0.45, 0.15)) return;
    
    // Synthesized fallback
    switch (blockType) {
      case 'grass':
      case 'leaves':
        this.playNoiseStep(0.04, 800, 3000, 0.1, 0.05);
        break;
      case 'stone':
      case 'ore':
      case 'brick':
        this.playToneStep(120, 0.03, 0.08, 0.3);
        this.playNoiseStep(0.02, 1000, 1800, 0.05, 0.03);
        break;
      case 'wood':
        this.playToneStep(80, 0.05, 0.12, 0.5);
        break;
      case 'sand':
        this.playNoiseStep(0.06, 400, 1200, 0.12, 0.08);
        break;
      case 'water':
        this.playToneStep(55, 0.08, 0.25, 0.4);
        this.playNoiseStep(0.08, 200, 2000, 0.15, 0.15);
        break;
      default:
        this.playNoiseStep(0.03, 500, 2000, 0.08, 0.04);
        break;
    }
  }
 
  public static playHit(blockType: string): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;

    let digKey = '';
    switch (blockType) {
      case 'grass':
      case 'leaves':
        digKey = 'grass_dig';
        break;
      case 'stone':
      case 'ore':
      case 'brick':
        digKey = 'stone_dig';
        break;
      case 'wood':
        digKey = 'wood_dig';
        break;
      case 'sand':
        digKey = 'sand_dig';
        break;
    }

    if (digKey && this.playSound(digKey, 0.3, 0.15)) return;
 
    // Fallback
    this.playToneStep(150, 0.01, 0.05, 0.4);
    this.playNoiseStep(0.03, 600, 4000, 0.08, 0.08);
  }
 
  public static playBreak(blockType: string): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;

    let digKey = '';
    switch (blockType) {
      case 'grass':
      case 'leaves':
        digKey = 'grass_dig';
        break;
      case 'stone':
      case 'ore':
      case 'brick':
        digKey = 'stone_dig';
        break;
      case 'wood':
        digKey = 'wood_dig';
        break;
      case 'sand':
        digKey = 'sand_dig';
        break;
    }

    if (digKey && this.playSound(digKey, 0.75, 0.15)) return;
 
    // Fallback
    this.playToneStep(100, 0.02, 0.1, 0.6);
    this.playNoiseStep(0.12, 500, 3500, 0.25, 0.25);
    setTimeout(() => this.playNoiseStep(0.05, 800, 2500, 0.1, 0.1), 40);
    setTimeout(() => this.playNoiseStep(0.03, 900, 2000, 0.08, 0.08), 80);
  }
 
  public static playPlace(blockType: string): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;

    let digKey = '';
    switch (blockType) {
      case 'grass':
      case 'leaves':
        digKey = 'grass_dig';
        break;
      case 'stone':
      case 'ore':
      case 'brick':
        digKey = 'stone_dig';
        break;
      case 'wood':
        digKey = 'wood_dig';
        break;
      case 'sand':
        digKey = 'sand_dig';
        break;
    }

    if (digKey && this.playSound(digKey, 0.7, 0.15)) return;
 
    // Fallback with pitch variation
    const pitch = 0.85 + Math.random() * 0.3; // 0.85 to 1.15
    this.playToneStep(70 * pitch, 0.04, 0.15, 0.7);
    this.playNoiseStep(0.04, 150 * pitch, 600 * pitch, 0.1, 0.2);
  }
 
  public static playItemPickup(): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;

    if (this.playSound('pop', 0.5, 0.15)) return;
 
    // Fallback
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
    
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    
    osc.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);
    
    osc.start(t);
    osc.stop(t + 0.1);
  }
 
  public static playPlayerHit(): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;

    if (this.playSound('hurt', 0.85, 0.15)) return;
 
    // Fallback
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
 
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.linearRampToValueAtTime(80, t + 0.15);
 
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
 
    osc.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);
 
    osc.start(t);
    osc.stop(t + 0.2);
  }
 
  // CORE SYNTHESIS HELPERS
  private static playNoiseStep(duration: number, lowCut: number, highCut: number, volStart: number, volEnd: number): number {
    if (!this.ctx || !this.masterGain) return 0;
    const t = this.ctx.currentTime;
 
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
 
    const noiseNode = this.ctx.createBufferSource();
    noiseNode.buffer = buffer;
 
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = (lowCut + highCut) / 2;
    filter.Q.value = filter.frequency.value / (highCut - lowCut || 1);
 
    const gainNode = this.ctx.createGain();
    gainNode.gain.setValueAtTime(volStart, t);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(volEnd, 0.0001), t + duration);
 
    noiseNode.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.masterGain);
 
    noiseNode.start(t);
    noiseNode.stop(t + duration);
    return 1;
  }
 
  private static playToneStep(frequency: number, attack: number, decay: number, volume: number): number {
    if (!this.ctx || !this.masterGain) return 0;
    const t = this.ctx.currentTime;
 
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
 
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(frequency * 0.5, t + attack + decay);
 
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.linearRampToValueAtTime(volume, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
 
    osc.connect(gainNode);
    gainNode.connect(this.masterGain);
 
    osc.start(t);
    osc.stop(t + attack + decay);
    return 1;
  }
 
  private static startAmbientWind(): void {
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
 
    const bufferSize = this.ctx.sampleRate * 2; // 2-second loop
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
 
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
 
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 400;
    filter.Q.value = 1.5;
 
    this.ambientWindGain = this.ctx.createGain();
    this.ambientWindGain.gain.value = 0.05; // Wind ambient loop should be quiet
 
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.08; // extremely slow oscillation (12 seconds per cycle)
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 150; // modulate frequency by +/- 150Hz
 
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    
    noise.connect(filter);
    filter.connect(this.ambientWindGain);
    this.ambientWindGain.connect(this.masterGain);
 
    lfo.start(t);
    noise.start(t);
  }


  public static setBackroomsMode(enabled: boolean): void {
    if (this.backroomsMode === enabled) return;
    this.backroomsMode = enabled;
    if (enabled) {
      if (this.musicTimer !== null) {
        window.clearTimeout(this.musicTimer);
        this.musicTimer = null;
      }
      this.stopMusicDisc();
      if (this.ambientWindGain && this.ctx) {
        this.ambientWindGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08);
      }
      void this.resumeContext().then(() => this.startBackroomsHum());
    } else {
      this.stopBackroomsHum();
      if (this.ambientWindGain && this.ctx) {
        this.ambientWindGain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 0.25);
      }
      if (this.ctx && !this.isMuted) this.scheduleAmbientMusic(18 + Math.random() * 25);
    }
  }

  private static startBackroomsHum(): void {
    if (!this.ctx || !this.masterGain || this.backroomsHumGain) return;
    const t = this.ctx.currentTime;
    const humGain = this.ctx.createGain();
    humGain.gain.setValueAtTime(0.0001, t);
    humGain.gain.exponentialRampToValueAtTime(0.055, t + 0.9);
    humGain.connect(this.masterGain);
    this.backroomsHumGain = humGain;

    const makeOsc = (frequency: number, type: OscillatorType, volume: number) => {
      if (!this.ctx || !this.backroomsHumGain) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(frequency, t);
      gain.gain.setValueAtTime(volume, t);
      osc.connect(gain);
      gain.connect(this.backroomsHumGain);
      osc.start(t);
      this.backroomsHumSources.push({ stop: () => { try { osc.stop(); } catch {} } });
    };

    makeOsc(60, 'sine', 0.42);
    makeOsc(120, 'sine', 0.16);
    makeOsc(360, 'triangle', 0.035);

    const bufferSize = Math.max(1024, Math.floor(this.ctx.sampleRate * 1.5));
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.32;
    const noise = this.ctx.createBufferSource();
    const filter = this.ctx.createBiquadFilter();
    const noiseGain = this.ctx.createGain();
    noise.buffer = buffer;
    noise.loop = true;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(720, t);
    filter.Q.setValueAtTime(7.5, t);
    noiseGain.gain.setValueAtTime(0.035, t);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(humGain);
    noise.start(t);
    this.backroomsHumSources.push({ stop: () => { try { noise.stop(); } catch {} } });
  }

  private static stopBackroomsHum(): void {
    if (this.backroomsHumGain && this.ctx) {
      try { this.backroomsHumGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08); } catch {}
    }
    for (const source of this.backroomsHumSources) source.stop();
    this.backroomsHumSources = [];
    try { this.backroomsHumGain?.disconnect(); } catch {}
    this.backroomsHumGain = null;
  }


  public static playBackroomsScream(intensity: number = 1): void {
    this.resumeContext();
    if (!this.ctx || !this.masterGain || this.isMuted) return;

    const t = this.ctx.currentTime;
    const duration = 0.85 + Math.random() * 0.65;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    const trem = this.ctx.createOscillator();
    const tremGain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc2.type = 'square';
    const start = 520 + Math.random() * 280;
    const end = 95 + Math.random() * 80;
    osc.frequency.setValueAtTime(start, t);
    osc.frequency.exponentialRampToValueAtTime(end, t + duration);
    osc2.frequency.setValueAtTime(start * 0.49, t);
    osc2.frequency.exponentialRampToValueAtTime(end * 0.62, t + duration);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900 + Math.random() * 900, t);
    filter.Q.setValueAtTime(6, t);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(Math.min(0.42, 0.16 * intensity), t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    trem.frequency.setValueAtTime(18 + Math.random() * 15, t);
    tremGain.gain.setValueAtTime(0.055, t);
    trem.connect(tremGain);
    tremGain.connect(gain.gain);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    trem.start(t);
    osc.start(t);
    osc2.start(t);
    trem.stop(t + duration);
    osc.stop(t + duration);
    osc2.stop(t + duration);

    this.playNoiseStep(duration * 0.72, 300, 3200, Math.min(0.32, 0.10 * intensity), 0.001);
  }

  public static playLevelUp(): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    // Classic Minecraft arpeggio level-up chime: G4 -> C5 -> E5 -> G5 -> C6
    const notes = [392.00, 523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + idx * 0.08);

      gain.gain.setValueAtTime(0.001, t + idx * 0.08);
      gain.gain.linearRampToValueAtTime(0.15, t + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.08 + 0.22);

      osc.connect(gain);
      if (this.masterGain) gain.connect(this.masterGain);

      osc.start(t + idx * 0.08);
      osc.stop(t + idx * 0.08 + 0.25);
    });
  }

  public static playToolBreak(): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const oscGain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);

    oscGain.gain.setValueAtTime(0.25, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(oscGain);
    if (this.masterGain) oscGain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.16);

    this.playNoiseStep(0.2, 800, 4000, 0.3, 0.001);
  }

  public static playSizzle(): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;
    this.playNoiseStep(0.35, 1200, 5000, 0.4, 0.001);
    this.playNoiseStep(0.25, 800, 4000, 0.25, 0.001);
  }

  public static playVillagerSound(type: 'idle' | 'hurt'): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    osc.type = 'sawtooth';
    const baseFreq = type === 'hurt' ? 180 + Math.random() * 30 : 130 + Math.random() * 20;
    osc.frequency.setValueAtTime(baseFreq, t);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(450, t);
    filter.Q.setValueAtTime(2.5, t);

    const duration = type === 'hurt' ? 0.25 : 0.45;
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.linearRampToValueAtTime(0.2, t + 0.05);

    const tremolo = this.ctx.createOscillator();
    tremolo.frequency.value = 22;
    const tremoloGain = this.ctx.createGain();
    tremoloGain.gain.value = 0.08;

    tremolo.connect(tremoloGain);
    tremoloGain.connect(gainNode.gain);

    gainNode.gain.setValueAtTime(0.12, t + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.masterGain!);

    tremolo.start(t);
    osc.start(t);

    osc.stop(t + duration);
    tremolo.stop(t + duration);
  }

  private static playUiTone(frequency: number, duration: number, volume: number, type: OscillatorType = 'triangle', slideTo?: number): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(volume, t + Math.min(0.025, duration * 0.35));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + duration + 0.01);
  }

  public static playMenuOpen(): void {
    this.playUiTone(420, 0.08, 0.055, 'triangle', 660);
    window.setTimeout(() => this.playUiTone(840, 0.07, 0.04, 'sine'), 45);
  }

  public static playMenuClose(): void {
    this.playUiTone(520, 0.08, 0.04, 'triangle', 260);
  }

  public static playMenuHover(): void {
    this.playUiTone(760, 0.035, 0.025, 'sine');
  }

  public static playMenuSelect(): void {
    this.playUiTone(520, 0.07, 0.055, 'triangle', 1040);
    window.setTimeout(() => this.playUiTone(1320, 0.09, 0.045, 'sine'), 60);
  }

  public static playTeleport(): void {
    this.playUiTone(180, 0.16, 0.08, 'sawtooth', 720);
    window.setTimeout(() => this.playUiTone(960, 0.12, 0.045, 'triangle'), 120);
  }

  public static playBowDraw(): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const clickTime = t + i * 0.12;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120 + i * 40, clickTime);
      gain.gain.setValueAtTime(0.05, clickTime);
      gain.gain.exponentialRampToValueAtTime(0.001, clickTime + 0.04);
      osc.connect(gain);
      if (this.masterGain) gain.connect(this.masterGain);
      osc.start(clickTime);
      osc.stop(clickTime + 0.05);
    }
  }

  public static playBowRelease(): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(350, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.08);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.08);

    this.playNoiseStep(0.12, 600, 3000, 0.2, 0.001);
  }

  private static lastCrackleTime = 0;
  public static playFurnaceCrackle(): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;

    const now = performance.now();
    if (now - this.lastCrackleTime < 100) return;
    this.lastCrackleTime = now;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(60 + Math.random() * 40, t);
    gain.gain.setValueAtTime(0.04, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.16);

    if (Math.random() < 0.7) {
      this.playNoiseStep(0.04, 2000, 8000, 0.08, 0.005);
    }
  }

  public static playArrowHit(): void {
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1100, t);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
    osc.connect(gain);
    if (this.masterGain) gain.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  public static playMusicDisc(discName: string): void {
    if (this.backroomsMode) return;
    this.stopMusicDisc();
    this.resumeContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    
    let notes: number[] = [];
    let noteDurations: number[] = [];
    let waveType: OscillatorType = 'triangle';

    if (discName.includes('Sunrise')) {
      notes = [261.63, 329.63, 392.00, 523.25, 392.00, 329.63, 261.63];
      noteDurations = [0.4, 0.4, 0.4, 0.8, 0.4, 0.4, 0.8];
      waveType = 'sine';
    } else if (discName.includes('Cavern')) {
      notes = [196.00, 220.00, 233.08, 196.00, 220.00, 233.08, 164.81];
      noteDurations = [0.5, 0.5, 0.8, 0.5, 0.5, 0.8, 1.2];
      waveType = 'sawtooth';
    } else if (discName.includes('RedstoneBeat') || discName.includes('Redstone')) {
      notes = [440.00, 440.00, 392.00, 440.00, 523.25, 493.88, 440.00];
      noteDurations = [0.2, 0.2, 0.4, 0.4, 0.2, 0.2, 0.8];
      waveType = 'sawtooth';
    } else {
      notes = [293.66, 349.23, 440.00, 587.33, 523.25, 440.00, 349.23, 392.00];
      noteDurations = [0.3, 0.3, 0.3, 0.6, 0.3, 0.3, 0.3, 0.9];
      waveType = 'triangle';
    }

    let elapsed = 0;
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const duration = noteDurations[idx] || 0.4;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      
      osc.type = waveType;
      osc.frequency.setValueAtTime(freq, t + elapsed);
      
      gain.gain.setValueAtTime(0.001, t + elapsed);
      gain.gain.linearRampToValueAtTime(0.12, t + elapsed + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, t + elapsed + duration - 0.05);
      
      osc.connect(gain);
      if (this.masterGain) gain.connect(this.masterGain);
      
      osc.start(t + elapsed);
      osc.stop(t + elapsed + duration);
      
      this.activeMusicSources.push({
        stop: () => {
          try {
            osc.stop();
          } catch(e) {}
        }
      });

      elapsed += duration;
    });
  }

  public static stopMusicDisc(): void {
    this.activeMusicSources.forEach(s => {
      try {
        s.stop();
      } catch(e) {}
    });
    this.activeMusicSources = [];
    this.musicPlaying = false;
  }
}
