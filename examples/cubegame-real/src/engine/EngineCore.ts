/**
 * EngineCore: High-Performance Game Engine
 * The foundation of the entire game - handles rendering, physics, networking, and game loop
 * Designed for maximum performance and extensibility
 */

import * as THREE from 'three';
import { EventBus } from '../core/EventBus';

export interface PerformanceMetrics {
  fps: number;
  frameTime: number;
  renderTime: number;
  updateTime: number;
  drawCalls: number;
  triangles: number;
  memoryUsage: number;
}

export interface EngineConfig {
  maxDrawDistance: number;
  renderScale: number;
  enableShadows: boolean;
  shadowResolution: number;
  enablePostProcessing: boolean;
  targetFPS: number;
  physicsTickRate: number;
  gravityScale: number;
  networkTickRate: number;
  maxPacketSize: number;
  compressionEnabled: boolean;
  chunkSize: number;
  renderDistance: number;
  maxSimultaneousChunks: number;
}

export class EngineCore {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  
  private isRunning = false;
  private animationFrameId: number | null = null;
  
  private metrics: PerformanceMetrics = {
    fps: 0,
    frameTime: 0,
    renderTime: 0,
    updateTime: 0,
    drawCalls: 0,
    triangles: 0,
    memoryUsage: 0
  };
  
  private frameCount = 0;
  private lastMetricsTime = performance.now();
  
  private updateCallbacks: Array<(deltaTime: number) => void> = [];
  private renderCallbacks: Array<() => void> = [];
  private lateUpdateCallbacks: Array<(deltaTime: number) => void> = [];
  
  private config: EngineConfig;
  private clock = new THREE.Clock();
  private lastFrameTime = 0; // Timestamp of last rendered frame for FPS throttling
  
  constructor(config: Partial<EngineConfig> = {}) {
    this.config = {
      maxDrawDistance: 500,
      renderScale: 0.75, // Lower render scale for better performance on low-end devices
      enableShadows: false, // Disable shadows to improve FPS
      shadowResolution: 1024,
      enablePostProcessing: false, // Disable post-processing effects like bloom
      targetFPS: 30, // Lower target FPS for low-end hardware
      physicsTickRate: 60,
      gravityScale: 1.0,
      networkTickRate: 30,
      maxPacketSize: 65536,
      compressionEnabled: true,
      chunkSize: 16,
      renderDistance: 4, // Reduced render distance to improve performance
      maxSimultaneousChunks: 64,
      ...config
    };
  }
  
  async initialize(container: HTMLElement): Promise<void> {
    console.log('🎮 Initializing EngineCore...');
    
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      precision: 'highp',
      stencil: false
    });
    
    this.setupRenderer(container);
    
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 100, this.config.maxDrawDistance);
    
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, this.config.maxDrawDistance);
    this.camera.position.set(0, 64, 0);
    
    window.addEventListener('resize', () => this.onWindowResize());
    
    console.log('✅ EngineCore initialized');
  }
  
  private setupRenderer(container: HTMLElement): void {
    if (!this.renderer) throw new Error('Renderer not initialized');
    
    const width = window.innerWidth * this.config.renderScale;
    const height = window.innerHeight * this.config.renderScale;
    
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    
    if (this.config.enableShadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      // Shadow resolution is configured per-light in Three.js (shadow.mapSize).
      // WebGLShadowMap has no global `resolution` property in current Three versions.
    }
    
    container.appendChild(this.renderer.domElement);
  }
  
  onUpdate(callback: (deltaTime: number) => void): void {
    this.updateCallbacks.push(callback);
  }
  
  onRender(callback: () => void): void {
    this.renderCallbacks.push(callback);
  }
  
  onLateUpdate(callback: (deltaTime: number) => void): void {
    this.lateUpdateCallbacks.push(callback);
  }
  
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();
    this.gameLoop();
  }
  
  stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
  
  private gameLoop = (): void => {
    const now = performance.now();
    const minDelta = 1000 / this.config.targetFPS;
    if (now - this.lastFrameTime < minDelta) {
      // Not enough time elapsed for next frame, schedule next loop
      this.animationFrameId = requestAnimationFrame(this.gameLoop);
      return;
    }
    this.lastFrameTime = now;
    const frameStartTime = now;
    const deltaTime = Math.min(this.clock.getDelta(), 0.016);
    
    const updateStartTime = performance.now();
    this.updateCallbacks.forEach(cb => cb(deltaTime));
    const updateTime = performance.now() - updateStartTime;
    
    const renderStartTime = performance.now();
    if (this.renderer && this.scene && this.camera) {
      this.renderCallbacks.forEach(cb => cb());
      this.renderer.render(this.scene, this.camera);
    }
    const renderTime = performance.now() - renderStartTime;
    
    this.lateUpdateCallbacks.forEach(cb => cb(deltaTime));
    
    this.updateMetrics(
      performance.now() - frameStartTime,
      renderTime,
      updateTime
    );
    
    if (this.isRunning) {
      this.animationFrameId = requestAnimationFrame(this.gameLoop);
    }
  };
  
  private updateMetrics(frameTime: number, renderTime: number, updateTime: number): void {
    this.frameCount++;
    
    const now = performance.now();
    if (now - this.lastMetricsTime > 1000) {
      const timeDiff = now - this.lastMetricsTime;
      this.metrics.fps = Math.round((this.frameCount * 1000) / timeDiff);
      this.metrics.frameTime = frameTime;
      this.metrics.renderTime = renderTime;
      this.metrics.updateTime = updateTime;
      
      if ((performance as any).memory) {
        this.metrics.memoryUsage = (performance as any).memory.usedJSHeapSize;
      }
      
      if ((this.renderer as any).info) {
        this.metrics.drawCalls = (this.renderer as any).info.render.calls;
        this.metrics.triangles = (this.renderer as any).info.render.triangles;
      }
      
      this.frameCount = 0;
      this.lastMetricsTime = now;
      
      EventBus.emit('engine:metrics', this.metrics);
    }
  }
  
  private onWindowResize(): void {
    if (!this.camera || !this.renderer) return;
    
    const width = window.innerWidth * this.config.renderScale;
    const height = window.innerHeight * this.config.renderScale;
    
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    
    this.renderer.setSize(width, height);
  }
  
  getScene(): THREE.Scene {
    if (!this.scene) throw new Error('Scene not initialized');
    return this.scene;
  }
  
  getCamera(): THREE.PerspectiveCamera {
    if (!this.camera) throw new Error('Camera not initialized');
    return this.camera;
  }
  
  getRenderer(): THREE.WebGLRenderer {
    if (!this.renderer) throw new Error('Renderer not initialized');
    return this.renderer;
  }
  
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }
  
  getConfig(): EngineConfig {
    return { ...this.config };
  }
  
  updateConfig(updates: Partial<EngineConfig>): void {
    this.config = { ...this.config, ...updates };
    EventBus.emit('engine:configUpdated', this.config);
  }
}

let engineInstance: EngineCore | null = null;

export function getEngine(): EngineCore {
  if (!engineInstance) {
    engineInstance = new EngineCore();
  }
  return engineInstance;
}

export function createEngine(config?: Partial<EngineConfig>): EngineCore {
  engineInstance = new EngineCore(config);
  return engineInstance;
}
