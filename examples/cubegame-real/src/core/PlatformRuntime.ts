export type RuntimeHost = 'browser' | 'native';
export type RuntimeGraphicsBackend = 'webgpu' | 'webgl';

export interface ModManifestFile {
  name: string;
  hash?: string;
  size?: number;
}

export interface ModManifestEntry {
  name: string;
  files: string[];
  entry?: string;
  hasAssets: boolean;
  hash?: string;
  source?: string;
  fileHashes?: ModManifestFile[];
}

export interface ModManifest {
  version: number;
  generatedAt: number;
  mods: ModManifestEntry[];
}

export interface NativeModCode {
  modName: string;
  fileName: string;
  code: string;
  hash?: string;
}

export interface CubeGameNativeBridge {
  platform?: string;
  host?: RuntimeHost;
  rendererBackend?: RuntimeGraphicsBackend;
  listMods?: () => Promise<ModManifest | ModManifestEntry[]>;
  readModCode?: (modName: string, fileName: string) => Promise<string | NativeModCode>;
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, contents: string) => Promise<void>;
}

export interface PlatformInfo {
  os: string;
  host: RuntimeHost;
  graphicsBackend: RuntimeGraphicsBackend;
  webGpuAvailable: boolean;
  nativeBridgeAvailable: boolean;
}

declare global {
  interface Window {
    CubeGameNative?: CubeGameNativeBridge;
    CubeGamePlatform?: PlatformInfo;
  }

  interface Navigator {
    gpu?: unknown;
    userAgentData?: {
      platform?: string;
    };
  }
}

export class PlatformRuntime {
  private static cachedInfo: PlatformInfo | null = null;

  public static getInfo(): PlatformInfo {
    if (this.cachedInfo) return this.cachedInfo;

    const os = this.detectOS();
    const nativeBridgeAvailable = typeof window !== 'undefined' && !!window.CubeGameNative;
    const urlParams = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
    const nativeRequested = urlParams.get('native') === '1';
    const host: RuntimeHost = nativeBridgeAvailable || nativeRequested ? 'native' : 'browser';
    const webGpuAvailable = typeof navigator !== 'undefined' && !!navigator.gpu;
    const nativeBackend = window.CubeGameNative?.rendererBackend;
    const graphicsBackend: RuntimeGraphicsBackend =
      nativeBackend === 'webgpu' || (host === 'native' && webGpuAvailable)
        ? 'webgpu'
        : 'webgl';

    this.cachedInfo = {
      os,
      host,
      graphicsBackend,
      webGpuAvailable,
      nativeBridgeAvailable,
    };

    window.CubeGamePlatform = this.cachedInfo;
    return this.cachedInfo;
  }

  public static isNativeHost(): boolean {
    return this.getInfo().host === 'native';
  }

  public static getNativeBridge(): CubeGameNativeBridge | null {
    return window.CubeGameNative || null;
  }

  public static updateDebugPanel(): void {
    const info = this.getInfo();
    const gpuLabel = info.graphicsBackend === 'webgpu'
      ? 'WebGPU ready'
      : (info.webGpuAvailable ? 'WebGPU available, WebGL active' : 'WebGL');

    const legacy = document.getElementById('debug-os');
    if (legacy) legacy.textContent = `${info.os} / ${info.host} / ${gpuLabel}`;

    const host = document.getElementById('debug-host');
    const platform = document.getElementById('debug-platform');
    const renderer = document.getElementById('debug-renderer');
    if (host) host.textContent = info.host === 'native' ? 'Electron/Native Host' : 'Browser';
    if (platform) platform.textContent = info.os;
    if (renderer) renderer.textContent = gpuLabel;
  }

  public static webSocketToHttpUrl(url: string): string {
    let clean = String(url || '').trim();
    if (!clean) return '';
    if (clean.startsWith('ws://')) clean = clean.replace(/^ws:\/\//i, 'http://');
    else if (clean.startsWith('wss://')) clean = clean.replace(/^wss:\/\//i, 'https://');
    else if (!clean.startsWith('http://') && !clean.startsWith('https://')) clean = `http://${clean}`;

    try {
      const parsed = new URL(clean);
      // API/mod URLs must be built from the origin only. The WebSocket URL
      // carries ?room=... and ?token=... for the socket handshake; keeping
      // those query params here turns /api requests into root-page requests.
      return parsed.origin;
    } catch {
      return clean.replace(/[?#].*$/, '').replace(/\/+$/, '');
    }
  }

  private static detectOS(): string {
    const bridgePlatform = window.CubeGameNative?.platform;
    if (bridgePlatform) return bridgePlatform;

    const platform = navigator.userAgentData?.platform || navigator.platform || '';
    const ua = navigator.userAgent || '';
    const source = `${platform} ${ua}`.toLowerCase();

    if (source.includes('iphone') || source.includes('ipad') || source.includes('ios')) return 'iOS';
    if (source.includes('mac')) return 'macOS';
    if (source.includes('win')) return 'Windows';
    if (source.includes('linux')) return 'Linux';
    if (source.includes('android')) return 'Android';
    return platform || 'Unknown OS';
  }
}
